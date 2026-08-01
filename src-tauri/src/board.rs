//! Board persistence for Helm.
//!
//! Boards live under `~/.config/grok-helm/boards/<id>.json`.
//! Active board id in `~/.config/grok-helm/active.json`.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedBoard {
    pub id: String,
    pub name: String,
    pub project_cwd: String,
    pub viewport: Viewport,
    pub nodes: Vec<SavedNode>,
    pub edges: Vec<SavedEdge>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Viewport {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedNode {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub position: Pos,
    #[serde(default)]
    pub size: Option<Size>,
    #[serde(default)]
    pub data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pos {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Size {
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedEdge {
    pub id: String,
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardListItem {
    pub id: String,
    pub name: String,
    pub project_cwd: String,
    pub updated_at: String,
    pub node_count: usize,
}

fn config_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    Ok(PathBuf::from(home).join(".config").join("grok-helm"))
}

fn boards_dir() -> Result<PathBuf, String> {
    let dir = config_dir()?.join("boards");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn active_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("active.json"))
}

fn board_path(id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.contains('/') || id.contains("..") {
        return Err("invalid board id".into());
    }
    Ok(boards_dir()?.join(format!("{id}.json")))
}

pub fn list_boards() -> Result<Vec<BoardListItem>, String> {
    let dir = boards_dir()?;
    let mut out = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for ent in entries.flatten() {
        let path = ent.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let text = match fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let board: SavedBoard = match serde_json::from_str(&text) {
            Ok(b) => b,
            Err(_) => continue,
        };
        out.push(BoardListItem {
            id: board.id,
            name: board.name,
            project_cwd: board.project_cwd,
            updated_at: board.updated_at,
            node_count: board.nodes.len(),
        });
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(out)
}

pub fn load_board(id: &str) -> Result<SavedBoard, String> {
    let path = board_path(id)?;
    let text = fs::read_to_string(&path).map_err(|e| format!("load board: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("parse board: {e}"))
}

pub fn save_board(board: SavedBoard) -> Result<SavedBoard, String> {
    let path = board_path(&board.id)?;
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(&board).map_err(|e| e.to_string())?;
    fs::write(&tmp, &text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;

    // Remember last active board
    let active = serde_json::json!({ "boardId": board.id });
    let active_file = active_path()?;
    if let Some(parent) = active_file.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(active_file, active.to_string());

    Ok(board)
}

pub fn delete_board(id: &str) -> Result<(), String> {
    let path = board_path(id)?;
    if path.is_file() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn active_board_id() -> Result<Option<String>, String> {
    let path = active_path()?;
    if !path.is_file() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok(v.get("boardId")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string()))
}

pub fn new_board_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("board-{ms:x}")
}

pub fn now_iso() -> String {
    // Simple RFC3339-ish UTC without chrono dependency
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Not full ISO without a time crate — store unix seconds as string + note
    format!("{secs}")
}
