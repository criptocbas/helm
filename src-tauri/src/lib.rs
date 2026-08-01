//! Helm — Tauri host. ACP bridge + board persistence + human PTY.

mod acp;
mod board;
mod pty;
mod stt;

use std::path::PathBuf;
use std::sync::Arc;
use std::thread;

use acp::{AgentInfo, GrokStatus, SessionInfo, SharedAgent};
use board::{BoardListItem, SavedBoard};
use parking_lot::Mutex;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

struct AppState {
    agent: Mutex<Option<Arc<SharedAgent>>>,
}

impl AppState {
    fn new() -> Self {
        Self {
            agent: Mutex::new(None),
        }
    }

    fn agent(&self) -> Result<Arc<SharedAgent>, String> {
        self.agent
            .lock()
            .clone()
            .ok_or_else(|| "Agent not running. Click Connect first.".into())
    }
}

#[tauri::command]
fn grok_status() -> GrokStatus {
    SharedAgent::grok_status()
}

#[tauri::command]
async fn agent_start(app: AppHandle, state: State<'_, AppState>) -> Result<AgentInfo, String> {
    {
        let mut g = state.agent.lock();
        if let Some(agent) = g.as_ref() {
            if agent.is_alive() {
                return Ok(agent.info());
            }
        }
        if let Some(dead) = g.take() {
            dead.kill();
        }
    }

    let app_for_exit = app.clone();
    let agent = SharedAgent::spawn(
        app.clone(),
        Box::new(move || {
            if let Some(st) = app_for_exit.try_state::<AppState>() {
                let _ = st.agent.lock().take();
            }
        }),
    )
    .map_err(|e| e.to_string())?;

    match agent.initialize_and_auth().await {
        Ok(info) => {
            *state.agent.lock() = Some(agent);
            let _ = app.emit("acp://status", serde_json::json!({ "running": true }));
            Ok(info)
        }
        Err(e) => {
            agent.kill();
            Err(e.to_string())
        }
    }
}

#[tauri::command]
fn agent_stop(
    app: AppHandle,
    state: State<'_, AppState>,
    pty_state: State<'_, pty::PtyState>,
) -> Result<(), String> {
    if let Some(agent) = state.agent.lock().take() {
        agent.kill();
    }
    // Disconnect reaps embedded TUIs / shells so we leave no zombies.
    let _ = pty::kill_all(&pty_state);
    let _ = app.emit(
        "acp://status",
        serde_json::json!({ "running": false, "reason": "stopped" }),
    );
    Ok(())
}

#[tauri::command]
fn agent_info(state: State<'_, AppState>) -> Result<Option<AgentInfo>, String> {
    Ok(state.agent.lock().as_ref().map(|a| a.info()))
}

#[tauri::command]
async fn session_new(state: State<'_, AppState>, cwd: String) -> Result<SessionInfo, String> {
    let agent = state.agent()?;
    let path = PathBuf::from(&cwd);
    if !path.is_dir() {
        return Err(format!("Not a directory: {cwd}"));
    }
    agent.new_session(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn session_load(
    state: State<'_, AppState>,
    session_id: String,
    cwd: String,
) -> Result<SessionInfo, String> {
    let agent = state.agent()?;
    let path = PathBuf::from(&cwd);
    if !path.is_dir() {
        return Err(format!("Not a directory: {cwd}"));
    }
    agent
        .load_session(&session_id, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn session_prompt(
    state: State<'_, AppState>,
    session_id: String,
    text: String,
) -> Result<Value, String> {
    let agent = state.agent()?;
    agent
        .prompt(&session_id, &text)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn session_cancel(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let agent = state.agent()?;
    agent.cancel(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn permission_respond(
    state: State<'_, AppState>,
    request_id: u64,
    option_id: Option<String>,
) -> Result<(), String> {
    let agent = state.agent()?;
    agent
        .respond_permission(request_id, option_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn plan_approval_respond(
    state: State<'_, AppState>,
    request_id: u64,
    outcome: String,
    feedback: Option<String>,
) -> Result<(), String> {
    let agent = state.agent()?;
    // Validate outcome early so Frontend gets a clear error (no silent drop).
    let o = outcome.trim().to_lowercase();
    if !matches!(o.as_str(), "approved" | "cancelled" | "abandoned") {
        return Err(format!(
            "invalid plan outcome '{outcome}' (use approved | cancelled | abandoned)"
        ));
    }
    agent
        .respond_plan_approval(request_id, &o, feedback)
        .map_err(|e| e.to_string())
}

/// Disk hydrate: plan.md for a session (board / plan card).
#[tauri::command]
fn session_read_plan(session_id: String, cwd: String) -> Option<String> {
    SharedAgent::read_plan_doc(&session_id, &cwd)
}

/// Disk hydrate: child agents under a parent session (board graph).
#[tauri::command]
fn session_list_subagents(
    session_id: String,
    cwd: String,
) -> Vec<acp::DiskSubagentMeta> {
    SharedAgent::list_session_subagents(&session_id, &cwd)
}

/// Optional finish text for a subagent folder (capped).
#[tauri::command]
fn session_read_subagent_output(
    session_id: String,
    cwd: String,
    subagent_id: String,
    max_chars: Option<usize>,
) -> Option<String> {
    SharedAgent::read_subagent_output(
        &session_id,
        &cwd,
        &subagent_id,
        max_chars.unwrap_or(4000),
    )
}

#[tauri::command]
fn default_cwd() -> String {
    std::env::current_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "/home".into())
}

#[tauri::command]
fn show_notification(title: String, body: String) -> Result<(), String> {
    acp::show_notification(&title, &body).map_err(|e| e.to_string())
}

// --- Boards ---

#[tauri::command]
fn board_list() -> Result<Vec<BoardListItem>, String> {
    board::list_boards()
}

#[tauri::command]
fn board_load(id: String) -> Result<SavedBoard, String> {
    board::load_board(&id)
}

#[tauri::command]
fn board_save(board: SavedBoard) -> Result<SavedBoard, String> {
    board::save_board(board)
}

#[tauri::command]
fn board_delete(id: String) -> Result<(), String> {
    board::delete_board(&id)
}

#[tauri::command]
fn board_active_id() -> Result<Option<String>, String> {
    board::active_board_id()
}

#[tauri::command]
fn board_new_id() -> String {
    board::new_board_id()
}

#[tauri::command]
fn board_now() -> String {
    board::now_iso()
}

// --- Human PTY (not ACP terminal) ---

#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    state: State<'_, pty::PtyState>,
    session_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    command: Option<Vec<String>>,
) -> Result<pty::PtySpawnResult, String> {
    pty::spawn(app, &state, session_id, cwd, cols, rows, command)
}

#[tauri::command]
fn pty_write(
    state: State<'_, pty::PtyState>,
    pty_id: String,
    data: String,
) -> Result<(), String> {
    pty::write(&state, &pty_id, &data)
}

#[tauri::command]
fn pty_resize(
    state: State<'_, pty::PtyState>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty::resize(&state, &pty_id, cols, rows)
}

#[tauri::command]
fn pty_kill(state: State<'_, pty::PtyState>, pty_id: String) -> Result<(), String> {
    pty::kill(&state, &pty_id)
}

#[tauri::command]
fn pty_kill_session(
    state: State<'_, pty::PtyState>,
    session_id: String,
) -> Result<(), String> {
    pty::kill_session(&state, &session_id)
}

#[tauri::command]
fn pty_kill_all(state: State<'_, pty::PtyState>) -> Result<(), String> {
    pty::kill_all(&state)
}

#[tauri::command]
fn pty_list(
    state: State<'_, pty::PtyState>,
    session_id: Option<String>,
) -> Vec<pty::PtyInfo> {
    pty::list(&state, session_id)
}

#[tauri::command]
fn pty_live_count(state: State<'_, pty::PtyState>) -> usize {
    pty::live_count(&state)
}

// --- Local STT ---

#[tauri::command]
fn stt_status() -> stt::SttBackendStatus {
    stt::stt_status()
}

#[tauri::command]
fn stt_transcribe(audio_b64: String, mime: String) -> Result<String, String> {
    stt::transcribe_base64(&audio_b64, &mime)
}

#[tauri::command]
fn voxtype_ptt_start() -> Result<(), String> {
    stt::voxtype_ptt_start()
}

#[tauri::command]
fn voxtype_ptt_stop() -> Result<String, String> {
    stt::voxtype_ptt_stop()
}

#[tauri::command]
fn voxtype_ptt_cancel() -> Result<(), String> {
    stt::voxtype_ptt_cancel()
}

fn start_stall_watcher(app: AppHandle) {
    thread::Builder::new()
        .name("helm-pty-stall".into())
        .spawn(move || loop {
            thread::sleep(pty::stall_poll_interval());
            if let Some(pty_state) = app.try_state::<pty::PtyState>() {
                pty::poll_stalls(&app, pty_state.inner());
            }
        })
        .ok();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = env_logger::try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .manage(pty::PtyState::new())
        .invoke_handler(tauri::generate_handler![
            grok_status,
            agent_start,
            agent_stop,
            agent_info,
            session_new,
            session_load,
            session_prompt,
            session_cancel,
            permission_respond,
            plan_approval_respond,
            session_read_plan,
            session_list_subagents,
            session_read_subagent_output,
            default_cwd,
            show_notification,
            board_list,
            board_load,
            board_save,
            board_delete,
            board_active_id,
            board_new_id,
            board_now,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_kill_session,
            pty_kill_all,
            pty_list,
            pty_live_count,
            stt_status,
            stt_transcribe,
            voxtype_ptt_start,
            voxtype_ptt_stop,
            voxtype_ptt_cancel,
        ])
        .setup(|app| {
            start_stall_watcher(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Helm")
        .run(|app_handle, event| {
            // App exit: reap all PTYs so orphaned grok/shell processes die.
            if matches!(
                event,
                RunEvent::Exit | RunEvent::ExitRequested { .. }
            ) {
                if let Some(pty_state) = app_handle.try_state::<pty::PtyState>() {
                    let _ = pty::kill_all(pty_state.inner());
                }
                if let Some(st) = app_handle.try_state::<AppState>() {
                    if let Some(agent) = st.agent.lock().take() {
                        agent.kill();
                    }
                }
            }
        });
}
