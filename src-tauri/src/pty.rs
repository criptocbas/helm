//! Human project shell (Desk-owned PTY).
//!
//! This is **not** ACP client terminal. Agent tools stay agent-local with
//! `clientCapabilities.terminal: false`. The UI embeds a shell for the user
//! in each session's project cwd.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

static NEXT_PTY_ID: AtomicU64 = AtomicU64::new(1);

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

struct LivePty {
    session_id: String,
    cwd: String,
    master: Box<dyn MasterPty + Send>,
    writer: Mutex<Box<dyn Write + Send>>,
    /// Set false when killed or reader ends.
    alive: Arc<AtomicBool>,
}

pub struct PtyState {
    /// pty_id → session
    by_id: Mutex<HashMap<String, LivePty>>,
    /// session_id → pty_id (one shell per Desk session in v1)
    by_session: Mutex<HashMap<String, String>>,
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            by_id: Mutex::new(HashMap::new()),
            by_session: Mutex::new(HashMap::new()),
        }
    }
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
    // e.g. ["grok", "--cwd", "/path", "--always-approve"] for full Grok Build TUI.
    command: Option<Vec<String>>,
) -> Result<PtySpawnResult, String> {
    if session_id.trim().is_empty() {
        return Err("sessionId required".into());
    }
    let cwd_path = validate_cwd(&cwd)?;
    let cols = cols.max(20);
    let rows = rows.max(5);

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
        // Login-ish interactive shell
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
    // Help fullscreen TUIs behave inside an embedded xterm
    cmd.env("COLORTERM", "truecolor");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn shell failed: {e}"))?;
    // Slave must be dropped so the child owns the controlling TTY.
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

    let session_id_r = session_id.clone();
    let pty_id_r = pty_id.clone();
    let app_r = app.clone();

    // Reader thread → emit base64 chunks
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
                        // EIO on master close is normal
                        log::debug!("pty reader end: {e}");
                        break;
                    }
                }
            }
            alive_r.store(false, Ordering::SeqCst);
        })
        .map_err(|e| format!("spawn reader thread: {e}"))?;

    // Wait for child exit on a separate thread
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
            },
        );
    }
    {
        let mut by_session = state.by_session.lock().unwrap_or_else(|e| e.into_inner());
        by_session.insert(session_id.clone(), pty_id.clone());
    }

    Ok(PtySpawnResult {
        pty_id,
        session_id,
        cwd: cwd_path.display().to_string(),
    })
}

pub fn write(state: &PtyState, pty_id: &str, data: &str) -> Result<(), String> {
    let by_id = state.by_id.lock().unwrap_or_else(|e| e.into_inner());
    let live = by_id
        .get(pty_id)
        .ok_or_else(|| format!("unknown pty: {pty_id}"))?;
    if !live.alive.load(Ordering::SeqCst) {
        return Err("shell is not running".into());
    }
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

pub fn kill_all(state: &PtyState) -> Result<(), String> {
    let ids: Vec<String> = {
        let by_id = state.by_id.lock().unwrap_or_else(|e| e.into_inner());
        by_id.keys().cloned().collect()
    };
    for id in ids {
        kill_pty_inner(state, &id);
    }
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
        .map(|(id, live)| PtyInfo {
            pty_id: id.clone(),
            session_id: live.session_id.clone(),
            cwd: live.cwd.clone(),
            alive: live.alive.load(Ordering::SeqCst),
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
    Some(PtyInfo {
        pty_id,
        session_id: live.session_id.clone(),
        cwd: live.cwd.clone(),
        alive: live.alive.load(Ordering::SeqCst),
    })
}

#[allow(dead_code)]
fn _path_is_dir(p: &Path) -> bool {
    p.is_dir()
}
