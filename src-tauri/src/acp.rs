//! ACP (Agent Client Protocol) bridge to `grok agent stdio`.
//!
//! Spawns the official Grok Build binary, speaks JSON-RPC over pipes,
//! emits Tauri events for session updates, and surfaces permission
//! requests to the UI.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::sync::oneshot;

#[derive(Debug, Error)]
pub enum AcpError {
    #[error("{0}")]
    Msg(String),
    #[error("request timed out")]
    Timeout,
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

impl Serialize for AcpError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

type Result<T> = std::result::Result<T, AcpError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokStatus {
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EffortOption {
    pub id: String,
    pub value: String,
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    pub model_id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub supports_reasoning_effort: bool,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub reasoning_efforts: Vec<EffortOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub agent_version: Option<String>,
    pub model_id: Option<String>,
    pub subscription_tier: Option<String>,
    pub auth_email: Option<String>,
    /// Models advertised at initialize (`_meta.modelState`).
    #[serde(default)]
    pub available_models: Vec<ModelOption>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub session_id: String,
    pub cwd: String,
    pub model_id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub from_disk: bool,
    /// Current reasoning effort when the model supports it.
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    /// Models available for this session (from `session/new` or `session/load`).
    #[serde(default)]
    pub available_models: Vec<ModelOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskSession {
    pub session_id: String,
    pub cwd: String,
    pub title: Option<String>,
    pub model_id: Option<String>,
    pub updated_at: Option<String>,
    pub num_chat_messages: Option<u64>,
}

/// Child agent row from `~/.grok/sessions/.../subagents/*/meta.json` (Tier 2b hydrate).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiskSubagentMeta {
    pub subagent_id: String,
    #[serde(default)]
    pub child_session_id: Option<String>,
    #[serde(default)]
    pub parent_session_id: Option<String>,
    #[serde(default)]
    pub subagent_type: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub tool_calls: Option<u64>,
    #[serde(default)]
    pub turns: Option<u64>,
    #[serde(default)]
    pub context_source: Option<String>,
    #[serde(default)]
    pub has_output: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOption {
    pub option_id: String,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest {
    pub request_id: u64,
    pub session_id: Option<String>,
    /// Raw toolCall object from ACP (may be null for non-tool permissions).
    pub tool_call: Option<Value>,
    /// Derived short title for UI (tool name / kind).
    pub tool_title: Option<String>,
    /// Derived kind e.g. read/edit/execute when present.
    pub tool_kind: Option<String>,
    /// One-line summary for PermissionCard (path, command, or title).
    pub tool_summary: Option<String>,
    pub options: Vec<PermissionOption>,
    pub raw: Value,
}

/// Pending `x.ai/exit_plan_mode` reverse-request (plan ready for approval).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanApprovalRequest {
    pub request_id: u64,
    pub session_id: String,
    pub tool_call_id: Option<String>,
    /// Full plan markdown when agent included it (may be large).
    pub plan_content: Option<String>,
    /// Truncated preview for cards (~2k chars). Prefer this for dock UI.
    pub plan_excerpt: Option<String>,
}

pub struct SharedAgent {
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
    next_id: AtomicU64,
    session_id: Mutex<Option<String>>,
    cwd: Mutex<Option<String>>,
    info: Mutex<AgentInfo>,
    child: Mutex<Child>,
    /// OS pid of the agent process (also Unix process-group id when grouped).
    child_pid: AtomicU32,
    /// True after kill/exit — `is_alive()` short-circuits.
    killed: AtomicBool,
    /// One-shot: clear `AppState.agent` when the process dies (stdout EOF).
    on_exit: Mutex<Option<Box<dyn FnOnce() + Send>>>,
}

impl Drop for SharedAgent {
    fn drop(&mut self) {
        // Always reap the child if we still own it (init-fail, forgotten stop, etc.).
        self.kill();
    }
}

impl SharedAgent {
    pub fn grok_status() -> GrokStatus {
        match which::which("grok") {
            Ok(path) => {
                let version = Command::new(&path)
                    .arg("--version")
                    .output()
                    .ok()
                    .and_then(|o| String::from_utf8(o.stdout).ok())
                    .map(|s| s.trim().to_string());
                GrokStatus {
                    available: true,
                    path: Some(path.display().to_string()),
                    version,
                }
            }
            Err(_) => GrokStatus {
                available: false,
                path: None,
                version: None,
            },
        }
    }

    /// Spawn `grok agent stdio`.
    ///
    /// `on_exit` runs once when stdout closes (process death) so the host can
    /// clear managed state — without this, Connect would reuse a dead Arc.
    pub fn spawn(app: AppHandle, on_exit: Box<dyn FnOnce() + Send>) -> Result<Arc<Self>> {
        let grok = which::which("grok").map_err(|_| {
            AcpError::Msg(
                "grok binary not found on PATH. Install: curl -fsSL https://x.ai/cli/install.sh | bash"
                    .into(),
            )
        })?;

        let mut cmd = Command::new(&grok);
        cmd.args(["agent", "stdio"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Put the agent in its own process group so stop/kill can reap tool
        // shells and other children that would otherwise outlive the parent.
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }

        let mut child = cmd.spawn()?;
        let child_pid = child.id();

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AcpError::Msg("no stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AcpError::Msg("no stdout".into()))?;

        if let Some(stderr) = child.stderr.take() {
            let app2 = app.clone();
            thread::spawn(move || {
                for line in BufReader::new(stderr).lines().flatten() {
                    let _ = app2.emit("acp://stderr", line);
                }
            });
        }

        let agent = Arc::new(SharedAgent {
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            session_id: Mutex::new(None),
            cwd: Mutex::new(None),
            info: Mutex::new(AgentInfo {
                agent_version: None,
                model_id: None,
                subscription_tier: None,
                auth_email: None,
                available_models: Vec::new(),
                reasoning_effort: None,
            }),
            child: Mutex::new(child),
            child_pid: AtomicU32::new(child_pid),
            killed: AtomicBool::new(false),
            on_exit: Mutex::new(Some(on_exit)),
        });

        {
            let agent_r = agent.clone();
            let app_r = app.clone();
            thread::spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    let Ok(line) = line else { break };
                    if line.trim().is_empty() {
                        continue;
                    }
                    handle_line(&agent_r, &app_r, &line);
                }
                // Process gone (or pipe closed): fail waiters, kill tree, clear AppState.
                agent_r.shutdown_after_stdout_closed(&app_r);
            });
        }

        Ok(agent)
    }

    /// True if the OS process is still running and we have not marked kill.
    ///
    /// Observation only: do **not** set `killed` here. If `try_wait` reaps an
    /// already-exited parent and we flip `killed`, a later `kill_process_only`
    /// returns immediately and never SIGTERM/SIGKILL's the process group —
    /// orphaning tool shells that outlived the agent.
    pub fn is_alive(&self) -> bool {
        if self.killed.load(Ordering::SeqCst) {
            return false;
        }
        let mut child = self.child.lock();
        match child.try_wait() {
            Ok(None) => true,
            Ok(Some(_)) | Err(_) => false,
        }
    }

    fn drain_pending(&self, message: &str) {
        for (_, tx) in self.pending.lock().drain() {
            let _ = tx.send(json!({ "error": { "message": message } }));
        }
    }

    /// Signal the agent process (and Unix process group) then wait. Idempotent.
    fn kill_process_only(&self) {
        if self.killed.swap(true, Ordering::SeqCst) {
            return;
        }

        let pid = self.child_pid.load(Ordering::SeqCst);

        #[cfg(unix)]
        {
            if pid > 0 {
                // Negative pid = process group (we spawned with process_group(0)).
                let pgid = pid as i32;
                unsafe {
                    libc::kill(-pgid, libc::SIGTERM);
                }
                thread::sleep(Duration::from_millis(150));
                // If still running, escalate.
                let mut child = self.child.lock();
                match child.try_wait() {
                    Ok(None) => {
                        unsafe {
                            libc::kill(-pgid, libc::SIGKILL);
                        }
                        let _ = child.wait();
                    }
                    Ok(Some(_)) => {}
                    Err(_) => {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
                return;
            }
        }

        let mut child = self.child.lock();
        let _ = child.kill();
        let _ = child.wait();
        let _ = pid; // silence unused on non-unix when pid always set
    }

    /// Drain pending RPCs, kill process tree. Does **not** run `on_exit`
    /// (caller / stdout path owns AppState clearing to avoid re-entrancy).
    pub fn kill(&self) {
        self.drain_pending("agent stopped");
        self.kill_process_only();
        // Drop the exit callback without running it when the host already
        // took the agent out of AppState (agent_stop / init-fail).
        let _ = self.on_exit.lock().take();
    }

    /// Stdout closed: fail in-flight RPCs immediately, kill, clear host state, notify UI.
    ///
    /// Status is emitted only when we still own `on_exit`. If the host already
    /// called `kill()` (Disconnect / replace / init-fail), `on_exit` is gone —
    /// emitting `running: false` here would race a newer Connect and leave the
    /// UI disconnected while `AppState` holds a live agent.
    fn shutdown_after_stdout_closed(&self, app: &AppHandle) {
        self.drain_pending("agent process exited (stdout closed)");
        self.kill_process_only();
        if let Some(cb) = self.on_exit.lock().take() {
            cb();
            let _ = app.emit(
                "acp://status",
                json!({ "running": false, "reason": "stdout closed" }),
            );
        }
    }

    fn write_line(&self, msg: &Value) -> Result<()> {
        let line = serde_json::to_string(msg)?;
        let mut stdin = self.stdin.lock();
        stdin.write_all(line.as_bytes())?;
        stdin.write_all(b"\n")?;
        stdin.flush()?;
        Ok(())
    }

    /// Default timeout for short control-plane RPCs (init, auth, session/new).
    pub async fn request(&self, method: &str, params: Value) -> Result<Value> {
        self.request_with_timeout(method, params, Duration::from_secs(120))
            .await
    }

    /// Long-running agent turns (session/prompt) need hours, not minutes.
    /// SuperGrok Heavy multi-file plans routinely exceed 5–30+ minutes.
    pub async fn request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().insert(id, tx);

        let msg = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        if let Err(e) = self.write_line(&msg) {
            self.pending.lock().remove(&id);
            return Err(e);
        }

        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(v)) => {
                if let Some(err) = v.get("error") {
                    return Err(AcpError::Msg(err.to_string()));
                }
                Ok(v.get("result").cloned().unwrap_or(Value::Null))
            }
            Ok(Err(_)) => Err(AcpError::Msg("response channel closed".into())),
            Err(_) => {
                self.pending.lock().remove(&id);
                Err(AcpError::Timeout)
            }
        }
    }

    pub async fn initialize_and_auth(&self) -> Result<AgentInfo> {
        // IMPORTANT: Do NOT advertise client `fs` / `terminal` capabilities.
        // When those are true, Grok routes read_file / shell through ACP
        // methods on the *client* (us). Our Phase-0 stubs returned the wrong
        // JSON shape (`text` instead of `content`) and left terminal/*
        // unimplemented, so tools failed with deserialize / method-not-found
        // even though the agent was healthy.
        //
        // With fs/terminal off, the agent uses its own local filesystem and
        // shell — same path as the normal TUI, and the right default for a
        // desktop shell that co-resides with the project files.
        let init = self
            .request(
                "initialize",
                json!({
                    "protocolVersion": 1,
                    "clientCapabilities": {
                        "fs": { "readTextFile": false, "writeTextFile": false },
                        "terminal": false
                    },
                    "clientInfo": {
                        "name": "grok-desk",
                        "version": env!("CARGO_PKG_VERSION")
                    },
                    "_meta": {
                        "clientType": "grok-desk",
                        "clientVersion": env!("CARGO_PKG_VERSION")
                    }
                }),
            )
            .await?;

        let agent_version = init
            .get("_meta")
            .and_then(|m| m.get("agentVersion"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let model_state = parse_model_state(init.pointer("/_meta/modelState"));
        let default_auth = init
            .pointer("/_meta/defaultAuthMethodId")
            .and_then(|v| v.as_str())
            .unwrap_or("cached_token")
            .to_string();

        {
            let mut info = self.info.lock();
            info.agent_version = agent_version;
            info.model_id = model_state.current_model_id.clone();
            info.available_models = model_state.available_models.clone();
            info.reasoning_effort = model_state.reasoning_effort.clone();
        }

        let auth = self
            .request("authenticate", json!({ "methodId": default_auth }))
            .await?;

        let email = auth
            .pointer("/_meta/email")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let tier = auth
            .pointer("/_meta/subscription_tier")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        {
            let mut info = self.info.lock();
            info.auth_email = email;
            info.subscription_tier = tier;
        }

        Ok(self.info.lock().clone())
    }

    pub async fn new_session(&self, cwd: &Path) -> Result<SessionInfo> {
        let cwd_str = cwd
            .canonicalize()
            .unwrap_or_else(|_| cwd.to_path_buf())
            .display()
            .to_string();

        let result = self
            .request(
                "session/new",
                json!({
                    "cwd": cwd_str,
                    "mcpServers": []
                }),
            )
            .await?;

        let session_id = result
            .get("sessionId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AcpError::Msg(format!("no sessionId in response: {result}")))?
            .to_string();

        let model_state = parse_model_state(result.get("models"));

        // Track last-used for convenience; multi-session uses explicit ids.
        *self.session_id.lock() = Some(session_id.clone());
        *self.cwd.lock() = Some(cwd_str.clone());
        {
            let mut info = self.info.lock();
            if model_state.current_model_id.is_some() {
                info.model_id = model_state.current_model_id.clone();
            }
            if !model_state.available_models.is_empty() {
                info.available_models = model_state.available_models.clone();
            }
            if model_state.reasoning_effort.is_some() {
                info.reasoning_effort = model_state.reasoning_effort.clone();
            }
        }

        let title = folder_title(&cwd_str);
        Ok(SessionInfo {
            session_id,
            cwd: cwd_str,
            model_id: model_state.current_model_id,
            title: Some(title),
            updated_at: None,
            from_disk: false,
            reasoning_effort: model_state.reasoning_effort,
            available_models: model_state.available_models,
        })
    }

    /// Load an existing on-disk session (replays history via session/update).
    pub async fn load_session(&self, session_id: &str, cwd: &Path) -> Result<SessionInfo> {
        let cwd_str = cwd
            .canonicalize()
            .unwrap_or_else(|_| cwd.to_path_buf())
            .display()
            .to_string();

        // Replay streams as session/update notifications before this returns.
        let result = self
            .request(
                "session/load",
                json!({
                    "sessionId": session_id,
                    "cwd": cwd_str,
                    "mcpServers": []
                }),
            )
            .await?;

        *self.session_id.lock() = Some(session_id.to_string());
        *self.cwd.lock() = Some(cwd_str.clone());

        let model_state = parse_model_state(result.get("models"));
        {
            let mut info = self.info.lock();
            if model_state.current_model_id.is_some() {
                info.model_id = model_state.current_model_id.clone();
            }
            if !model_state.available_models.is_empty() {
                info.available_models = model_state.available_models.clone();
            }
            if model_state.reasoning_effort.is_some() {
                info.reasoning_effort = model_state.reasoning_effort.clone();
            }
        }

        let info = self.info.lock().clone();
        Ok(SessionInfo {
            session_id: session_id.to_string(),
            cwd: cwd_str.clone(),
            model_id: model_state
                .current_model_id
                .or(info.model_id.clone()),
            title: Some(folder_title(&cwd_str)),
            updated_at: None,
            from_disk: true,
            reasoning_effort: model_state
                .reasoning_effort
                .or(info.reasoning_effort.clone()),
            available_models: if model_state.available_models.is_empty() {
                info.available_models
            } else {
                model_state.available_models
            },
        })
    }

    /// Switch model / reasoning effort for a session (`session/set_model`).
    ///
    /// Grok accepts optional `_meta.reasoningEffort` (`low` | `medium` | `high` | …).
    pub async fn set_model(
        &self,
        session_id: &str,
        model_id: &str,
        reasoning_effort: Option<&str>,
    ) -> Result<SessionInfo> {
        if session_id.trim().is_empty() {
            return Err(AcpError::Msg("session_id required".into()));
        }
        if model_id.trim().is_empty() {
            return Err(AcpError::Msg("model_id required".into()));
        }

        let mut params = json!({
            "sessionId": session_id,
            "modelId": model_id,
        });
        if let Some(effort) = reasoning_effort {
            if !effort.trim().is_empty() {
                params["_meta"] = json!({ "reasoningEffort": effort });
            }
        }

        let result = self.request("session/set_model", params).await?;

        // Surface errors embedded in result if any.
        if let Some(err) = result.pointer("/_meta/model/Err").and_then(|v| v.as_str()) {
            return Err(AcpError::Msg(format!("set_model failed: {err}")));
        }

        let applied_model = result
            .pointer("/_meta/model/Ok")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| Some(model_id.to_string()));

        {
            let mut info = self.info.lock();
            info.model_id = applied_model.clone();
            if let Some(effort) = reasoning_effort {
                if !effort.trim().is_empty() {
                    info.reasoning_effort = Some(effort.to_string());
                    // Keep available model entries in sync for UI.
                    for m in &mut info.available_models {
                        if applied_model
                            .as_ref()
                            .map(|id| id == &m.model_id)
                            .unwrap_or(false)
                        {
                            m.reasoning_effort = Some(effort.to_string());
                        }
                    }
                }
            }
        }

        let cwd = self.cwd.lock().clone().unwrap_or_default();
        let info = self.info.lock().clone();
        Ok(SessionInfo {
            session_id: session_id.to_string(),
            cwd,
            model_id: applied_model,
            title: None,
            updated_at: None,
            from_disk: false,
            reasoning_effort: reasoning_effort
                .filter(|e| !e.trim().is_empty())
                .map(|e| e.to_string())
                .or(info.reasoning_effort),
            available_models: info.available_models,
        })
    }

    pub async fn prompt(&self, session_id: &str, text: &str) -> Result<Value> {
        self.prompt_blocks(session_id, vec![json!({ "type": "text", "text": text })])
            .await
    }

    /// Prompt with mixed content blocks (text, image, embedded resources).
    pub async fn prompt_blocks(&self, session_id: &str, blocks: Vec<Value>) -> Result<Value> {
        if session_id.trim().is_empty() {
            return Err(AcpError::Msg("session_id required".into()));
        }
        if blocks.is_empty() {
            return Err(AcpError::Msg("empty prompt".into()));
        }
        *self.session_id.lock() = Some(session_id.to_string());

        // No practical wall-clock limit for a single turn — cancel via session/cancel.
        // Previously 300s caused "freeze then timeout" on long Heavy runs while the
        // agent was still healthy (writes keep streaming; UI just looked stuck).
        self.request_with_timeout(
            "session/prompt",
            json!({
                "sessionId": session_id,
                "prompt": blocks
            }),
            Duration::from_secs(6 * 60 * 60), // 6h hard ceiling
        )
        .await
    }

    pub fn cancel(&self, session_id: &str) -> Result<()> {
        if session_id.trim().is_empty() {
            return Err(AcpError::Msg("session_id required".into()));
        }
        let msg = json!({
            "jsonrpc": "2.0",
            "method": "session/cancel",
            "params": { "sessionId": session_id }
        });
        self.write_line(&msg)
    }

    /// Read plan.md for a session if present (session root or goal/).
    pub fn read_plan_doc(session_id: &str, cwd: &str) -> Option<String> {
        let home = dirs_home()?;
        let encoded = urlencoding_path(cwd);
        let base = Path::new(&home)
            .join(".grok")
            .join("sessions")
            .join(&encoded)
            .join(session_id);
        for rel in ["plan.md", "goal/plan.md"] {
            let p = base.join(rel);
            if let Ok(text) = std::fs::read_to_string(&p) {
                if !text.trim().is_empty() {
                    return Some(text);
                }
            }
        }
        None
    }

    /// List child agents under a parent session's disk folder (meta only).
    /// Missing dir → empty list (never fails resume).
    pub fn list_session_subagents(session_id: &str, cwd: &str) -> Vec<DiskSubagentMeta> {
        let Some(home) = dirs_home() else {
            return vec![];
        };
        if session_id.trim().is_empty() || cwd.trim().is_empty() {
            return vec![];
        }
        let encoded = urlencoding_path(cwd);
        let sub_root = Path::new(&home)
            .join(".grok")
            .join("sessions")
            .join(&encoded)
            .join(session_id)
            .join("subagents");
        if !sub_root.is_dir() {
            return vec![];
        }
        let mut out: Vec<DiskSubagentMeta> = Vec::new();
        let Ok(entries) = std::fs::read_dir(&sub_root) else {
            return vec![];
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let meta_path = path.join("meta.json");
            if !meta_path.is_file() {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&meta_path) else {
                continue;
            };
            let Ok(v) = serde_json::from_str::<Value>(&text) else {
                continue;
            };
            let folder_id = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let subagent_id = v
                .get("subagent_id")
                .or_else(|| v.get("subagentId"))
                .and_then(|x| x.as_str())
                .unwrap_or(&folder_id)
                .to_string();
            if subagent_id.is_empty() {
                continue;
            }
            let has_output = path.join("output.json").is_file();
            out.push(DiskSubagentMeta {
                subagent_id,
                child_session_id: json_str(&v, &["child_session_id", "childSessionId"]),
                parent_session_id: json_str(&v, &["parent_session_id", "parentSessionId"]),
                subagent_type: json_str(&v, &["subagent_type", "subagentType"]),
                description: json_str(&v, &["description"]),
                status: json_str(&v, &["status"]),
                model: json_str(&v, &["effective_model_id", "effectiveModelId", "model"]),
                started_at: json_str(&v, &["started_at", "startedAt"]),
                completed_at: json_str(&v, &["completed_at", "completedAt"]),
                duration_ms: json_u64(&v, &["duration_ms", "durationMs"]),
                tool_calls: json_u64(&v, &["tool_calls", "toolCalls"]),
                turns: json_u64(&v, &["turns"]),
                context_source: json_str(
                    &v,
                    &["effective_context_source", "effectiveContextSource", "context_source"],
                ),
                has_output,
            });
        }
        // Newest first (started_at / completed_at ISO strings sort lexicographically)
        out.sort_by(|a, b| {
            let ka = a
                .completed_at
                .as_deref()
                .or(a.started_at.as_deref())
                .unwrap_or("");
            let kb = b
                .completed_at
                .as_deref()
                .or(b.started_at.as_deref())
                .unwrap_or("");
            kb.cmp(ka)
        });
        // Cap — UI also caps; keep IO bounded
        if out.len() > 40 {
            out.truncate(40);
        }
        out
    }

    /// Read capped finish text from `subagents/<id>/output.json` (Tier 2a/2b detail).
    /// Returns None if missing; never loads full child chat_history.
    pub fn read_subagent_output(
        session_id: &str,
        cwd: &str,
        subagent_id: &str,
        max_chars: usize,
    ) -> Option<String> {
        let home = dirs_home()?;
        if session_id.trim().is_empty()
            || cwd.trim().is_empty()
            || subagent_id.trim().is_empty()
        {
            return None;
        }
        // Prevent path traversal
        if subagent_id.contains('/') || subagent_id.contains('\\') || subagent_id.contains("..") {
            return None;
        }
        let encoded = urlencoding_path(cwd);
        let path = Path::new(&home)
            .join(".grok")
            .join("sessions")
            .join(&encoded)
            .join(session_id)
            .join("subagents")
            .join(subagent_id)
            .join("output.json");
        if !path.is_file() {
            return None;
        }
        // Bound read size (UTF-8 chars ≈ bytes for ASCII-heavy logs)
        let max_bytes = max_chars.saturating_mul(4).min(256 * 1024);
        let Ok(file) = std::fs::File::open(&path) else {
            return None;
        };
        use std::io::Read;
        let mut buf = Vec::new();
        let mut limited = file.take(max_bytes as u64);
        if limited.read_to_end(&mut buf).is_err() {
            return None;
        }
        let text = String::from_utf8_lossy(&buf);
        // Prefer {"output": "..."} field; fall back to raw text
        let body = if let Ok(v) = serde_json::from_str::<Value>(&text) {
            v.get("output")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string())
                .or_else(|| {
                    // Sometimes nested
                    v.pointer("/result/output")
                        .and_then(|x| x.as_str())
                        .map(|s| s.to_string())
                })
                .unwrap_or_else(|| text.to_string())
        } else {
            text.to_string()
        };
        let mut out = body;
        if out.chars().count() > max_chars {
            out = out.chars().take(max_chars).collect::<String>() + "…";
        }
        if out.trim().is_empty() {
            None
        } else {
            Some(out)
        }
    }

    /// List recent sessions from ~/.grok/sessions (newest first).
    pub fn list_disk_sessions(limit: usize) -> Result<Vec<DiskSession>> {
        let home = dirs_home().ok_or_else(|| AcpError::Msg("HOME not set".into()))?;
        let root = Path::new(&home).join(".grok").join("sessions");
        if !root.is_dir() {
            return Ok(vec![]);
        }

        let mut out: Vec<DiskSession> = Vec::new();
        let mut stack = vec![root];
        while let Some(dir) = stack.pop() {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let summary = path.join("summary.json");
                    if summary.is_file() {
                        if let Ok(text) = std::fs::read_to_string(&summary) {
                            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                                let sid = v
                                    .pointer("/info/id")
                                    .and_then(|x| x.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                let cwd = v
                                    .pointer("/info/cwd")
                                    .and_then(|x| x.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                if sid.is_empty() || cwd.is_empty() {
                                    continue;
                                }
                                let auto_title = v
                                    .get("session_summary")
                                    .and_then(|x| x.as_str())
                                    .filter(|s| !s.is_empty())
                                    .map(|s| s.to_string())
                                    .or_else(|| {
                                        v.get("generated_title")
                                            .and_then(|x| x.as_str())
                                            .filter(|s| !s.is_empty())
                                            .map(|s| s.to_string())
                                    })
                                    .or_else(|| Some(folder_title(&cwd)));
                                let title = auto_title;
                                out.push(DiskSession {
                                    session_id: sid,
                                    cwd,
                                    title,
                                    model_id: v
                                        .get("current_model_id")
                                        .and_then(|x| x.as_str())
                                        .map(|s| s.to_string()),
                                    updated_at: v
                                        .get("updated_at")
                                        .and_then(|x| x.as_str())
                                        .map(|s| s.to_string()),
                                    num_chat_messages: v
                                        .get("num_chat_messages")
                                        .and_then(|x| x.as_u64()),
                                });
                            }
                        }
                    } else {
                        stack.push(path);
                    }
                }
            }
        }

        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        out.truncate(limit.max(1));
        Ok(out)
    }

    pub fn respond_permission(&self, request_id: u64, option_id: Option<String>) -> Result<()> {
        let result = if let Some(id) = option_id {
            json!({ "outcome": { "outcome": "selected", "optionId": id } })
        } else {
            json!({ "outcome": { "outcome": "cancelled" } })
        };

        let msg = json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": result
        });
        self.write_line(&msg)
    }

    /// Answer `x.ai/exit_plan_mode`: outcome = approved | cancelled | abandoned.
    pub fn respond_plan_approval(
        &self,
        request_id: u64,
        outcome: &str,
        feedback: Option<String>,
    ) -> Result<()> {
        let mut result = json!({ "outcome": outcome });
        if let Some(fb) = feedback {
            if !fb.trim().is_empty() {
                result["feedback"] = json!(fb);
            }
        }
        let msg = json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": result
        });
        self.write_line(&msg)
    }

    pub fn info(&self) -> AgentInfo {
        self.info.lock().clone()
    }

    pub fn session(&self) -> Option<SessionInfo> {
        let sid = self.session_id.lock().clone()?;
        let cwd = self.cwd.lock().clone().unwrap_or_default();
        let info = self.info.lock().clone();
        Some(SessionInfo {
            session_id: sid,
            title: Some(folder_title(&cwd)),
            cwd,
            model_id: info.model_id.clone(),
            updated_at: None,
            from_disk: false,
            reasoning_effort: info.reasoning_effort.clone(),
            available_models: info.available_models,
        })
    }
}

#[derive(Debug, Clone, Default)]
struct ParsedModelState {
    current_model_id: Option<String>,
    reasoning_effort: Option<String>,
    available_models: Vec<ModelOption>,
}

fn parse_model_state(models: Option<&Value>) -> ParsedModelState {
    let Some(models) = models else {
        return ParsedModelState::default();
    };

    let current_model_id = models
        .get("currentModelId")
        .or_else(|| models.get("current_model_id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mut available_models = Vec::new();
    let mut reasoning_effort: Option<String> = None;

    if let Some(arr) = models
        .get("availableModels")
        .or_else(|| models.get("available_models"))
        .and_then(|v| v.as_array())
    {
        for m in arr {
            let model_id = m
                .get("modelId")
                .or_else(|| m.get("model_id"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if model_id.is_empty() {
                continue;
            }
            let name = m
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(&model_id)
                .to_string();
            let description = m
                .get("description")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let meta = m.get("_meta").cloned().unwrap_or(Value::Null);
            let supports = meta
                .get("supportsReasoningEffort")
                .or_else(|| meta.get("supports_reasoning_effort"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let effort = meta
                .get("reasoningEffort")
                .or_else(|| meta.get("reasoning_effort"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            if current_model_id
                .as_ref()
                .map(|id| id == &model_id)
                .unwrap_or(false)
            {
                reasoning_effort = effort.clone();
            }
            let mut efforts = Vec::new();
            if let Some(list) = meta
                .get("reasoningEfforts")
                .or_else(|| meta.get("reasoning_efforts"))
                .and_then(|v| v.as_array())
            {
                for e in list {
                    let id = e
                        .get("id")
                        .or_else(|| e.get("value"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if id.is_empty() {
                        continue;
                    }
                    let value = e
                        .get("value")
                        .and_then(|v| v.as_str())
                        .unwrap_or(&id)
                        .to_string();
                    let label = e
                        .get("label")
                        .or_else(|| e.get("name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or(&value)
                        .to_string();
                    let description = e
                        .get("description")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    efforts.push(EffortOption {
                        id,
                        value,
                        label,
                        description,
                    });
                }
            }
            available_models.push(ModelOption {
                model_id,
                name,
                description,
                supports_reasoning_effort: supports || !efforts.is_empty(),
                reasoning_effort: effort,
                reasoning_efforts: efforts,
            });
        }
    }

    // Fallback: only currentModelId present
    if available_models.is_empty() {
        if let Some(id) = &current_model_id {
            available_models.push(ModelOption {
                model_id: id.clone(),
                name: id.clone(),
                description: None,
                supports_reasoning_effort: false,
                reasoning_effort: None,
                reasoning_efforts: vec![],
            });
        }
    }

    ParsedModelState {
        current_model_id,
        reasoning_effort,
        available_models,
    }
}

/// Best-effort desktop notification (Linux: notify-send).
pub fn show_notification(title: &str, body: &str) -> Result<()> {
    match Command::new("notify-send")
        .args([
            "--app-name=Helm",
            "--urgency=normal",
            title,
            body,
        ])
        .status()
    {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(AcpError::Msg(format!(
            "notify-send exited with {status}"
        ))),
        Err(e) => Err(AcpError::Msg(format!(
            "notify-send unavailable ({e}). Install libnotify."
        ))),
    }
}



fn dirs_home() -> Option<String> {
    std::env::var("HOME").ok()
}

fn folder_title(cwd: &str) -> String {
    Path::new(cwd)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(cwd)
        .to_string()
}

/// Match Grok's session dir encoding (`/` → `%2F`).
fn urlencoding_path(cwd: &str) -> String {
    cwd.replace('%', "%25").replace('/', "%2F")
}

fn json_str(v: &Value, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(s) = v.get(*k).and_then(|x| x.as_str()).filter(|s| !s.is_empty()) {
            return Some(s.to_string());
        }
    }
    None
}

fn json_u64(v: &Value, keys: &[&str]) -> Option<u64> {
    for k in keys {
        if let Some(n) = v.get(*k).and_then(|x| x.as_u64()) {
            return Some(n);
        }
        if let Some(n) = v.get(*k).and_then(|x| x.as_i64()).filter(|n| *n >= 0) {
            return Some(n as u64);
        }
        if let Some(s) = v.get(*k).and_then(|x| x.as_str()) {
            if let Ok(n) = s.parse::<u64>() {
                return Some(n);
            }
        }
    }
    None
}

fn handle_line(agent: &SharedAgent, app: &AppHandle, line: &str) {
    let Ok(msg) = serde_json::from_str::<Value>(line) else {
        let _ = app.emit("acp://raw", line);
        return;
    };

    if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
        if msg.get("method").is_some() {
            handle_agent_request(agent, app, id, &msg);
            return;
        }
        if let Some(tx) = agent.pending.lock().remove(&id) {
            let _ = tx.send(msg);
        }
        return;
    }

    if let Some(method) = msg.get("method").and_then(|v| v.as_str()) {
        // Standard ACP + Grok extension form. Subagent lifecycle
        // (`subagent_spawned` / `subagent_finished`) is emitted as
        // `_x.ai/session/update` with the same params shape as `session/update`.
        // Dropping the extension method made Desk only show spawn *tools*
        // (12ms "completed") while real child work was invisible.
        let is_session_update = matches!(
            method,
            "session/update" | "_x.ai/session/update" | "x.ai/session/update"
        );
        if is_session_update {
            let params = msg.get("params").cloned().unwrap_or(Value::Null);
            let _ = app.emit("acp://session-update", params);
        } else {
            let _ = app.emit(
                "acp://notification",
                json!({ "method": method, "params": msg.get("params") }),
            );
        }
    }
}

/// Unwrap gateway ext form: `_x.ai/foo` + nested method/params → (`x.ai/foo`, inner params).
fn normalize_agent_method(method: &str, params: Value) -> (String, Value) {
    if let Some(stripped) = method.strip_prefix('_') {
        if let Some(inner_m) = params.get("method").and_then(|m| m.as_str()) {
            let inner_p = params
                .get("params")
                .cloned()
                .unwrap_or(Value::Null);
            return (inner_m.to_string(), inner_p);
        }
        return (stripped.to_string(), params);
    }
    (method.to_string(), params)
}

/// Derive UI-friendly fields from an ACP toolCall value.
fn summarize_tool_call(tool: Option<&Value>) -> (Option<String>, Option<String>, Option<String>) {
    let Some(tool) = tool else {
        return (None, None, None);
    };
    let title = tool
        .get("title")
        .or_else(|| tool.get("name"))
        .or_else(|| tool.get("toolName"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let kind = tool
        .get("kind")
        .or_else(|| tool.get("toolKind"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let path = tool
        .get("path")
        .or_else(|| tool.get("filePath"))
        .or_else(|| tool.pointer("/locations/0/path"))
        .and_then(|v| v.as_str());
    let cmd = tool
        .get("command")
        .or_else(|| tool.pointer("/input/command"))
        .and_then(|v| v.as_str());
    let summary = path
        .or(cmd)
        .map(|s| s.to_string())
        .or_else(|| title.clone())
        .map(|s| {
            if s.chars().count() > 160 {
                let t: String = s.chars().take(157).collect();
                format!("{t}…")
            } else {
                s
            }
        });
    (title, kind, summary)
}

fn handle_agent_request(agent: &SharedAgent, app: &AppHandle, id: u64, msg: &Value) {
    let raw_method = msg.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let raw_params = msg.get("params").cloned().unwrap_or(Value::Null);
    let (method, params) = normalize_agent_method(raw_method, raw_params);

    match method.as_str() {
        "session/request_permission" => {
            let options = params
                .get("options")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|o| {
                            Some(PermissionOption {
                                option_id: o
                                    .get("optionId")
                                    .or_else(|| o.get("option_id"))
                                    .and_then(|v| v.as_str())?
                                    .to_string(),
                                name: o
                                    .get("name")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("option")
                                    .to_string(),
                                kind: o
                                    .get("kind")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string(),
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();

            let mut session_id = params
                .get("sessionId")
                .or_else(|| params.get("session_id"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            // Fallback: last-used session on the shared agent (avoids unmapped cards).
            if session_id.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
                session_id = agent.session_id.lock().clone();
            }

            let tool_call = params
                .get("toolCall")
                .or_else(|| params.get("tool_call"))
                .cloned();
            let (tool_title, tool_kind, tool_summary) = summarize_tool_call(tool_call.as_ref());

            let req = PermissionRequest {
                request_id: id,
                session_id,
                tool_call,
                tool_title,
                tool_kind,
                tool_summary,
                options,
                raw: params,
            };
            // Host never auto-responds — Frontend ask/auto decides.
            let _ = app.emit("acp://permission", req);
        }
        // Plan ready — client must respond with approved / cancelled / abandoned
        "x.ai/exit_plan_mode" => {
            let mut session_id = params
                .get("sessionId")
                .or_else(|| params.get("session_id"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if session_id.is_empty() {
                if let Some(sid) = agent.session_id.lock().clone() {
                    session_id = sid;
                }
            }
            let tool_call_id = params
                .get("toolCallId")
                .or_else(|| params.get("tool_call_id"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let plan_content = params
                .get("planContent")
                .or_else(|| params.get("plan_content"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let plan_excerpt = plan_content.as_ref().map(|c| {
                let max = 2000usize;
                if c.chars().count() <= max {
                    c.clone()
                } else {
                    let truncated: String = c.chars().take(max).collect();
                    format!("{truncated}\n…")
                }
            });

            let req = PlanApprovalRequest {
                request_id: id,
                session_id: session_id.clone(),
                tool_call_id,
                plan_content: plan_content.clone(),
                plan_excerpt: plan_excerpt.clone(),
            };
            // Host never auto-approves plans — Frontend ask/auto decides.
            let _ = app.emit("acp://plan-approval", req);

            // Also surface content on the plan pane via session-update-like event
            if let Some(content) = plan_content {
                let _ = app.emit(
                    "acp://session-update",
                    json!({
                        "sessionId": session_id,
                        "update": {
                            "sessionUpdate": "plan_doc",
                            "content": content
                        }
                    }),
                );
            }
        }
        // Client FS is intentionally not advertised (clientCapabilities.fs = false).
        // Hard-deny even if a buggy agent routes here — unrestricted path R/W is a
        // landmine until a cwd-confined design exists.
        "fs/read_text_file" | "fs/write_text_file" => {
            let _ = agent.write_line(&json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32601,
                    "message": "Client fs methods are disabled in grok-desk (agent-local tools only)"
                }
            }));
        }
        other => {
            let _ = app.emit(
                "acp://agent-request",
                json!({ "id": id, "method": other, "params": params }),
            );
            let _ = agent.write_line(&json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32601,
                    "message": format!("Method not implemented by grok-desk: {other}")
                }
            }));
        }
    }
}
