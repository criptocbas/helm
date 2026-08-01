//! Human project shell + embedded Grok TUI (Desk-owned PTY).
//!
//! This is **not** ACP client terminal. Agent tools stay agent-local with
//! `clientCapabilities.terminal: false`. Soft concurrent cap prevents runaway
//! multi-agent process fan-out (Sprint 1).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

static NEXT_PTY_ID: AtomicU64 = AtomicU64::new(1);

/// Soft max live PTYs (agent TUIs + human shells). Override with `HELM_MAX_PTYS`.
pub const DEFAULT_MAX_LIVE_PTYS: usize = 8;

/// No PTY output for this long → one-shot `pty://stall` (host health).
const STALL_AFTER: Duration = Duration::from_secs(10 * 60);
const STALL_POLL: Duration = Duration::from_secs(30);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySpawnResult {
    pub pty_id: String,
    pub session_id: String,
    pub cwd: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyInfo {
    pub pty_id: String,
    pub session_id: String,
    pub cwd: String,
    pub alive: bool,
    /// Seconds since last stdout/stdin activity (None if never).
    pub idle_secs: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyDataEvent {
    pty_id: String,
    session_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyExitEvent {
    pty_id: String,
    session_id: String,
    code: Option<i32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyStallEvent {
    pty_id: String,
    session_id: String,
    idle_secs: u64,
    message: String,
}

struct LivePty {
    session_id: String,
    cwd: String,
    master: Box<dyn MasterPty + Send>,
    writer: Mutex<Box<dyn Write + Send>>,
    /// Set false when killed or reader ends.
    alive: Arc<AtomicBool>,
    last_activity: Arc<Mutex<Instant>>,
    stall_emitted: Arc<AtomicBool>,
}

pub struct PtyState {
    /// pty_id → session
    by_id: Mutex<HashMap<String, LivePty>>,
    /// session_id → pty_id (one shell per Desk session in v1)
    by_session: Mutex<HashMap<String, String>>,
    stall_started: AtomicBool,
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            by_id: Mutex::new(HashMap::new()),
            by_session: Mutex::new(HashMap::new()),
            stall_started: AtomicBool::new(false),
        }
    }
}

fn max_live_ptys() -> usize {
    std::env::var("HELM_MAX_PTYS")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|&n| n >= 1 && n <= 64)
        .unwrap_or(DEFAULT_MAX_LIVE_PTYS)
}

fn default_shell() -> PathBuf {
    if let Ok(shell) = std::env::var("SHELL") {
        let p = PathBuf::from(&shell);
        if p.is_file() {
            return p;
        }
    }
    PathBuf::from("/bin/bash")
}

fn validate_cwd(cwd: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(cwd);
    if !path.is_dir() {
        return Err(format!("cwd is not a directory: {cwd}"));
    }
    Ok(path)
}

fn touch_activity(last: &Arc<Mutex<Instant>>, stall_emitted: &Arc<AtomicBool>) {
    if let Ok(mut g) = last.lock() {
        *g = Instant::now();
    }
    stall_emitted.store(false, Ordering::SeqCst);
}

/// Count PTYs that still claim alive.
pub fn live_count(state: &PtyState) -> usize {
    let by_id = state.by_id.lock().unwrap_or_else(|e| e.into_inner());
    by_id
        .values()
        .filter(|l| l.alive.load(Ordering::SeqCst))
        .count()
}

/// Kill existing PTY for a session (if any), without removing map until reader exits.
fn kill_session_inner(state: &PtyState, session_id: &str) {
    let pty_id = {
        let mut map = state.by_session.lock().unwrap_or_else(|e| e.into_inner());
        map.remove(session_id)
    };
    if let Some(id) = pty_id {
        kill_pty_inner(state, &id);
    }
}

fn kill_pty_inner(state: &PtyState, pty_id: &str) {
    let mut by_id = state.by_id.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(live) = by_id.remove(pty_id) {
        live.alive.store(false, Ordering::SeqCst);
        // Dropping master/writer closes the PTY → child typically exits.
        drop(live);
    }
    let mut by_session = state.by_session.lock().unwrap_or_else(|e| e.into_inner());
    by_session.retain(|_, id| id != pty_id);
}

pub fn spawn(
    app: AppHandle,
    state: &PtyState,
    session_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    // When set, run this argv instead of an interactive shell
    // e.g. ["grok", "--cwd", "/path"] or with --always-approve when prefs say auto.
    command: Option<Vec<String>>,
) -> Result<PtySpawnResult, String> {
    if session_id.trim().is_empty() {
        return Err("sessionId required".into());
    }
    let cwd_path = validate_cwd(&cwd)?;
    let cols = cols.max(20);
    let rows = rows.max(5);

    // Soft concurrent cap (replacement for same session does not count twice).
    let replacing = {
        let by_session = state.by_session.lock().unwrap_or_else(|e| e.into_inner());
        by_session.contains_key(&session_id)
    };
    if !replacing {
        let n = live_count(state);
        let max = max_live_ptys();
        if n >= max {
            return Err(format!(
                "PTY limit reached ({n}/{max} live sessions). Stop an agent or terminal before spawning another. Override with HELM_MAX_PTYS (1–64)."
            ));
        }
    }

    // Replace any existing shell for this session.
    kill_session_inner(state, &session_id);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {e}"))?;

    let mut cmd = if let Some(argv) = command {
        if argv.is_empty() {
            return Err("command argv is empty".into());
        }
        let mut c = CommandBuilder::new(&argv[0]);
        for a in argv.iter().skip(1) {
            c.arg(a);
        }
        c
    } else {
        let shell = default_shell();
        let mut c = CommandBuilder::new(&shell);
        if shell.file_name().and_then(|s| s.to_str()) == Some("bash") {
            c.arg("-i");
        } else if shell.file_name().and_then(|s| s.to_str()) == Some("zsh") {
            c.arg("-i");
        }
        c
    };
    cmd.cwd(&cwd_path);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn shell failed: {e}"))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take writer: {e}"))?;

    let pty_id = format!("pty-{}", NEXT_PTY_ID.fetch_add(1, Ordering::SeqCst));
    let alive = Arc::new(AtomicBool::new(true));
    let alive_r = Arc::clone(&alive);
    let alive_w = Arc::clone(&alive);
    let last_activity = Arc::new(Mutex::new(Instant::now()));
    let last_r = Arc::clone(&last_activity);
    let stall_emitted = Arc::new(AtomicBool::new(false));
    let stall_r = Arc::clone(&stall_emitted);

    let session_id_r = session_id.clone();
    let pty_id_r = pty_id.clone();
    let app_r = app.clone();

    thread::Builder::new()
        .name(format!("pty-read-{pty_id}"))
        .spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                if !alive_r.load(Ordering::SeqCst) {
                    break;
                }
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        touch_activity(&last_r, &stall_r);
                        let data = B64.encode(&buf[..n]);
                        let _ = app_r.emit(
                            "pty://data",
                            PtyDataEvent {
                                pty_id: pty_id_r.clone(),
                                session_id: session_id_r.clone(),
                                data,
                            },
                        );
                    }
                    Err(e) => {
                        log::debug!("pty reader end: {e}");
                        break;
                    }
                }
            }
            alive_r.store(false, Ordering::SeqCst);
        })
        .map_err(|e| format!("spawn reader thread: {e}"))?;

    let session_id_w = session_id.clone();
    let pty_id_w = pty_id.clone();
    let app_w = app.clone();
    thread::Builder::new()
        .name(format!("pty-wait-{pty_id}"))
        .spawn(move || {
            let code = loop {
                match child.try_wait() {
                    Ok(Some(status)) => break Some(status.exit_code() as i32),
                    Ok(None) => {
                        if !alive_w.load(Ordering::SeqCst) {
                            let _ = child.kill();
                            break None;
                        }
                        thread::sleep(Duration::from_millis(50));
                    }
                    Err(_) => break None,
                }
            };
            alive_w.store(false, Ordering::SeqCst);
            let _ = app_w.emit(
                "pty://exit",
                PtyExitEvent {
                    pty_id: pty_id_w,
                    session_id: session_id_w,
                    code,
                },
            );
        })
        .map_err(|e| format!("spawn wait thread: {e}"))?;

    {
        let mut by_id = state.by_id.lock().unwrap_or_else(|e| e.into_inner());
        by_id.insert(
            pty_id.clone(),
            LivePty {
                session_id: session_id.clone(),
                cwd: cwd_path.display().to_string(),
                master: pair.master,
                writer: Mutex::new(writer),
                alive,
                last_activity,
                stall_emitted,
            },
        );
    }
    {
        let mut by_session = state.by_session.lock().unwrap_or_else(|e| e.into_inner());
        by_session.insert(session_id.clone(), pty_id.clone());
    }

    ensure_stall_watcher(app, state);

    Ok(PtySpawnResult {
        pty_id,
        session_id,
        cwd: cwd_path.display().to_string(),
    })
}

/// Start background stall detector once per process.
pub fn ensure_stall_watcher(app: AppHandle, state: &PtyState) {
    if state
        .stall_started
        .swap(true, Ordering::SeqCst)
    {
        return;
    }
    // We cannot move PtyState; poll via app-managed state in lib instead.
    // This flag only documents intent — real watcher is started from lib.rs.
    let _ = app;
    let _ = state;
}

/// Poll live PTYs and emit `pty://stall` once per quiet period.
pub fn poll_stalls(app: &AppHandle, state: &PtyState) {
    let by_id = state.by_id.lock().unwrap_or_else(|e| e.into_inner());
    for (pty_id, live) in by_id.iter() {
        if !live.alive.load(Ordering::SeqCst) {
            continue;
        }
        let idle = live
            .last_activity
            .lock()
            .map(|t| t.elapsed())
            .unwrap_or(Duration::ZERO);
        if idle < STALL_AFTER {
            continue;
        }
        if live.stall_emitted.swap(true, Ordering::SeqCst) {
            continue;
        }
        let idle_secs = idle.as_secs();
        let _ = app.emit(
            "pty://stall",
            PtyStallEvent {
                pty_id: pty_id.clone(),
                session_id: live.session_id.clone(),
                idle_secs,
                message: format!(
                    "No terminal activity for {idle_secs}s — agent may be stuck or idle"
                ),
            },
        );
    }
}

pub fn write(state: &PtyState, pty_id: &str, data: &str) -> Result<(), String> {
    let by_id = state.by_id.lock().unwrap_or_else(|e| e.into_inner());
    let live = by_id
        .get(pty_id)
        .ok_or_else(|| format!("unknown pty: {pty_id}"))?;
    if !live.alive.load(Ordering::SeqCst) {
        return Err("shell is not running".into());
    }
    touch_activity(&live.last_activity, &live.stall_emitted);
    let mut w = live
        .writer
        .lock()
        .map_err(|_| "writer lock poisoned".to_string())?;
    w.write_all(data.as_bytes())
        .map_err(|e| format!("pty write: {e}"))?;
    w.flush().map_err(|e| format!("pty flush: {e}"))?;
    Ok(())
}

pub fn resize(state: &PtyState, pty_id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let by_id = state.by_id.lock().unwrap_or_else(|e| e.into_inner());
    let live = by_id
        .get(pty_id)
        .ok_or_else(|| format!("unknown pty: {pty_id}"))?;
    let cols = cols.max(20);
    let rows = rows.max(5);
    live.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("pty resize: {e}"))
}

pub fn kill(state: &PtyState, pty_id: &str) -> Result<(), String> {
    kill_pty_inner(state, pty_id);
    Ok(())
}

pub fn kill_session(state: &PtyState, session_id: &str) -> Result<(), String> {
    kill_session_inner(state, session_id);
    Ok(())
}

/// Reap every live PTY (disconnect / app exit). Idempotent.
pub fn kill_all(state: &PtyState) -> Result<(), String> {
    let ids: Vec<String> = {
        let by_id = state.by_id.lock().unwrap_or_else(|e| e.into_inner());
        by_id.keys().cloned().collect()
    };
    for id in ids {
        kill_pty_inner(state, &id);
    }
    // Brief grace so wait threads can kill children after master drop.
    thread::sleep(Duration::from_millis(80));
    Ok(())
}

pub fn list(state: &PtyState, session_id: Option<String>) -> Vec<PtyInfo> {
    let by_id = state.by_id.lock().unwrap_or_else(|e| e.into_inner());
    by_id
        .iter()
        .filter(|(_, live)| {
            session_id
                .as_ref()
                .map(|s| s == &live.session_id)
                .unwrap_or(true)
        })
        .map(|(id, live)| {
            let idle_secs = live
                .last_activity
                .lock()
                .ok()
                .map(|t| t.elapsed().as_secs());
            PtyInfo {
                pty_id: id.clone(),
                session_id: live.session_id.clone(),
                cwd: live.cwd.clone(),
                alive: live.alive.load(Ordering::SeqCst),
                idle_secs,
            }
        })
        .collect()
}

/// Resolve existing pty for session if still alive.
pub fn for_session(state: &PtyState, session_id: &str) -> Option<PtyInfo> {
    let by_session = state.by_session.lock().unwrap_or_else(|e| e.into_inner());
    let pty_id = by_session.get(session_id)?.clone();
    drop(by_session);
    let by_id = state.by_id.lock().unwrap_or_else(|e| e.into_inner());
    let live = by_id.get(&pty_id)?;
    let idle_secs = live
        .last_activity
        .lock()
        .ok()
        .map(|t| t.elapsed().as_secs());
    Some(PtyInfo {
        pty_id,
        session_id: live.session_id.clone(),
        cwd: live.cwd.clone(),
        alive: live.alive.load(Ordering::SeqCst),
        idle_secs,
    })
}

pub fn stall_poll_interval() -> Duration {
    STALL_POLL
}

#[allow(dead_code)]
fn _path_is_dir(p: &Path) -> bool {
    p.is_dir()
}
