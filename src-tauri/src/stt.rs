//! Local speech-to-text for Helm (Linux / Tauri webview).
//!
//! Prefers the user's **Voxtype** install (`voxtype transcribe` → Parakeet/whisper
//! models already on disk). Falls back to openai-whisper CLI if present.
//!
//! Flow: base64 mic audio → temp file → ffmpeg 16k mono WAV → transcribe CLI.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::Serialize;
use which::which;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SttBackendStatus {
    pub available: bool,
    pub backend: String,
    pub detail: String,
    pub ffmpeg: bool,
    pub whisper: bool,
    pub voxtype: bool,
    pub whisper_bin: Option<String>,
}

fn tmp_dir() -> PathBuf {
    std::env::temp_dir().join("grok-helm-stt")
}

fn ensure_tmp() -> Result<PathBuf, String> {
    let d = tmp_dir();
    fs::create_dir_all(&d).map_err(|e| format!("stt tmp dir: {e}"))?;
    Ok(d)
}

fn stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn find_voxtype() -> Option<PathBuf> {
    which("voxtype").ok()
}

/// Find a whisper-family CLI (fallback if voxtype missing).
fn find_whisper() -> Option<PathBuf> {
    const CANDIDATES: &[&str] = &["whisper", "whisper-cpp", "whisper-cli"];
    for name in CANDIDATES {
        if let Ok(p) = which(name) {
            return Some(p);
        }
    }
    let home = std::env::var("HOME").ok()?;
    for rel in [".local/bin/whisper", ".local/bin/whisper-cpp"] {
        let p = PathBuf::from(&home).join(rel);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

pub fn stt_status() -> SttBackendStatus {
    let ffmpeg = which("ffmpeg").is_ok();
    let voxtype = find_voxtype().is_some();
    let whisper_path = find_whisper();
    let whisper = whisper_path.is_some();
    let whisper_bin = whisper_path
        .as_ref()
        .map(|p| p.display().to_string())
        .or_else(|| find_voxtype().map(|p| p.display().to_string()));

    if voxtype && ffmpeg {
        return SttBackendStatus {
            available: true,
            backend: "voxtype".into(),
            detail: "Using your Voxtype install (Parakeet) — same stack as Super+Ctrl+X"
                .into(),
            ffmpeg: true,
            whisper,
            voxtype: true,
            whisper_bin,
        };
    }
    if whisper && ffmpeg {
        return SttBackendStatus {
            available: true,
            backend: "local-whisper".into(),
            detail: format!(
                "Local whisper ready ({})",
                whisper_bin.as_deref().unwrap_or("whisper")
            ),
            ffmpeg: true,
            whisper: true,
            voxtype: false,
            whisper_bin,
        };
    }
    if !ffmpeg {
        return SttBackendStatus {
            available: false,
            backend: "none".into(),
            detail: "ffmpeg missing (needed to convert mic audio). Install: pacman -S ffmpeg"
                .into(),
            ffmpeg: false,
            whisper,
            voxtype,
            whisper_bin,
        };
    }
    // ffmpeg ok, no voxtype/whisper
    SttBackendStatus {
        available: false,
        backend: "ffmpeg-only".into(),
        detail: "ffmpeg found, but no Voxtype or whisper CLI. Install Voxtype (you already use Super+Ctrl+X) or: pip install -U openai-whisper".into(),
        ffmpeg: true,
        whisper: false,
        voxtype: false,
        whisper_bin: None,
    }
}

fn write_bytes(path: &Path, bytes: &[u8]) -> Result<(), String> {
    fs::write(path, bytes).map_err(|e| format!("write {}: {e}", path.display()))
}

fn run_ffmpeg_to_wav(input: &Path, wav: &Path) -> Result<(), String> {
    let ffmpeg = which("ffmpeg").map_err(|_| "ffmpeg not on PATH".to_string())?;
    let out = Command::new(ffmpeg)
        .args([
            "-y",
            "-i",
            input.to_str().unwrap_or(""),
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            wav.to_str().unwrap_or(""),
        ])
        .output()
        .map_err(|e| format!("ffmpeg spawn: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "ffmpeg failed: {}",
            err.chars().take(400).collect::<String>()
        ));
    }
    Ok(())
}

/// Prefer Voxtype (uses your Parakeet model). Fall back to whisper CLI.
fn run_transcribe(wav: &Path) -> Result<String, String> {
    if let Some(bin) = find_voxtype() {
        return run_voxtype(&bin, wav);
    }
    if let Some(bin) = find_whisper() {
        return run_whisper(&bin, wav);
    }
    Err("No Voxtype or whisper CLI found".into())
}

fn run_voxtype(bin: &Path, wav: &Path) -> Result<String, String> {
    let out = Command::new(bin)
        .args(["transcribe", wav.to_str().unwrap_or("")])
        .output()
        .map_err(|e| format!("voxtype spawn: {e}"))?;

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    // Voxtype prints logs to stderr and the final transcript on the last stdout lines.
    // Example success ends with a bare transcript line after logs mixed in stdout.
    let text = extract_transcript_line(&stdout);

    if !out.status.success() && text.is_empty() {
        return Err(format!(
            "voxtype failed: {}",
            stderr.chars().take(500).collect::<String>()
        ));
    }
    if text.is_empty() {
        // Sometimes only stderr has the : "text" pattern
        if let Some(t) = extract_quoted_result(&stderr) {
            return Ok(t);
        }
        return Err("voxtype produced no transcript".into());
    }
    Ok(text)
}

fn extract_transcript_line(stdout: &str) -> String {
    // Prefer last non-empty line that is not a log-looking line
    let mut candidates: Vec<&str> = Vec::new();
    for line in stdout.lines() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        if t.starts_with("Loading ") || t.starts_with("Audio format:") || t.starts_with("Processing ")
        {
            continue;
        }
        if t.contains(" INFO ") || t.contains(" WARN ") || t.contains(" ERROR ") {
            // e.g. ... transcription completed ...: "Yeah."
            if let Some(q) = extract_quoted_result(t) {
                return q;
            }
            continue;
        }
        candidates.push(t);
    }
    candidates
        .last()
        .map(|s| s.trim_matches('"').to_string())
        .unwrap_or_default()
}

fn extract_quoted_result(s: &str) -> Option<String> {
    // ... completed in 0.05s: "Yeah."
    let idx = s.rfind(": \"")?;
    let rest = &s[idx + 3..];
    let end = rest.rfind('"')?;
    let inner = rest[..end].trim();
    if inner.is_empty() {
        None
    } else {
        Some(inner.to_string())
    }
}

fn run_whisper(bin: &Path, wav: &Path) -> Result<String, String> {
    let bin_name = bin
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("whisper")
        .to_string();

    if bin_name.contains("whisper-cpp") || bin_name.contains("whisper-cli") {
        let out = Command::new(bin)
            .args(["-f", wav.to_str().unwrap_or(""), "-nt"])
            .output()
            .map_err(|e| format!("whisper.cpp spawn: {e}"))?;
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !out.status.success() && stdout.is_empty() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(format!(
                "whisper.cpp failed: {}",
                err.chars().take(400).collect::<String>()
            ));
        }
        return Ok(stdout
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('['))
            .last()
            .unwrap_or(&stdout)
            .to_string());
    }

    let dir = ensure_tmp()?;
    let out = Command::new(bin)
        .args([
            wav.to_str().unwrap_or(""),
            "--model",
            "tiny",
            "--language",
            "en",
            "--output_format",
            "txt",
            "--output_dir",
            dir.to_str().unwrap_or("/tmp"),
            "--fp16",
            "False",
        ])
        .output()
        .map_err(|e| format!("whisper spawn: {e}"))?;

    let stem = wav.file_stem().and_then(|s| s.to_str()).unwrap_or("audio");
    let txt = dir.join(format!("{stem}.txt"));
    if txt.is_file() {
        let s = fs::read_to_string(&txt).map_err(|e| e.to_string())?;
        return Ok(s.trim().to_string());
    }
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "whisper failed: {}",
            err.chars().take(500).collect::<String>()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn voxtype_out_path() -> Result<PathBuf, String> {
    Ok(ensure_tmp()?.join("voxtype-last.txt"))
}

fn voxtype_state_path() -> Option<PathBuf> {
    let runtime = std::env::var("XDG_RUNTIME_DIR").ok()?;
    Some(PathBuf::from(runtime).join("voxtype").join("state"))
}

fn read_voxtype_state() -> String {
    voxtype_state_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn wait_voxtype_idle(timeout_ms: u64) -> Result<(), String> {
    let start = stamp();
    loop {
        let s = read_voxtype_state();
        if s == "idle" || s.is_empty() {
            // empty can mean daemon not writing — still proceed after stop
            if s == "idle" || stamp().saturating_sub(start) > 200 {
                return Ok(());
            }
        }
        if stamp().saturating_sub(start) > timeout_ms as u128 {
            return Err(format!(
                "Voxtype still busy (state={s}). Is `voxtype daemon` running?"
            ));
        }
        std::thread::sleep(std::time::Duration::from_millis(80));
    }
}

/// Push-to-talk via the Voxtype daemon (system mic — no webview permission).
/// Call start on mic-down, stop_and_read on mic-up.
pub fn voxtype_ptt_start() -> Result<(), String> {
    let bin = find_voxtype().ok_or_else(|| "voxtype not found".to_string())?;
    let out = voxtype_out_path()?;
    let _ = fs::remove_file(&out);
    let _ = fs::write(&out, "");

    // Ensure daemon is up — `record start` signals it; if inactive, user sees error.
    let status = Command::new(&bin)
        .args(["status"])
        .output()
        .map_err(|e| format!("voxtype status: {e}"))?;
    let st = String::from_utf8_lossy(&status.stdout);
    // status prints "idle" / "recording" / etc.

    let out_s = out.to_str().unwrap_or("/tmp/helm-voxtype-last.txt");
    let res = Command::new(&bin)
        .args(["record", "start", "--file", out_s])
        .output()
        .map_err(|e| format!("voxtype record start: {e}"))?;
    if !res.status.success() {
        let err = String::from_utf8_lossy(&res.stderr);
        let outb = String::from_utf8_lossy(&res.stdout);
        return Err(format!(
            "voxtype record start failed (is daemon running? systemctl --user status voxtype): {} {}",
            err.chars().take(200).collect::<String>(),
            outb.chars().take(100).collect::<String>()
        ));
    }
    let _ = st;
    Ok(())
}

pub fn voxtype_ptt_stop() -> Result<String, String> {
    let bin = find_voxtype().ok_or_else(|| "voxtype not found".to_string())?;
    let out = voxtype_out_path()?;

    let res = Command::new(&bin)
        .args(["record", "stop", "--clipboard"])
        .output()
        .map_err(|e| format!("voxtype record stop: {e}"))?;
    if !res.status.success() {
        let err = String::from_utf8_lossy(&res.stderr);
        // still try to wait and read file
        let _ = err;
    }

    // Wait for transcription to finish
    let _ = wait_voxtype_idle(60_000);

    // Prefer file written by --file on start
    if out.is_file() {
        let text = fs::read_to_string(&out).map_err(|e| e.to_string())?;
        let t = text.trim().to_string();
        if !t.is_empty() {
            return Ok(t);
        }
    }

    // Fallback: clipboard (wl-paste)
    if let Ok(paste) = which("wl-paste") {
        let clip = Command::new(paste)
            .output()
            .map_err(|e| format!("wl-paste: {e}"))?;
        let t = String::from_utf8_lossy(&clip.stdout).trim().to_string();
        if !t.is_empty() {
            return Ok(t);
        }
    }

    Err("No speech detected (Voxtype returned empty).".into())
}

pub fn voxtype_ptt_cancel() -> Result<(), String> {
    let bin = find_voxtype().ok_or_else(|| "voxtype not found".to_string())?;
    let _ = Command::new(bin).args(["record", "cancel"]).output();
    Ok(())
}

/// Transcribe base64-encoded audio (webm/ogg/wav from MediaRecorder).
pub fn transcribe_base64(audio_b64: &str, mime: &str) -> Result<String, String> {
    let status = stt_status();
    if !status.available {
        return Err(status.detail);
    }

    let bytes = B64
        .decode(audio_b64.trim())
        .map_err(|e| format!("base64 decode: {e}"))?;
    if bytes.len() < 256 {
        return Err("Recording too short — hold the mic a bit longer.".into());
    }

    let dir = ensure_tmp()?;
    let id = stamp();
    let ext = if mime.contains("wav") {
        "wav"
    } else if mime.contains("ogg") {
        "ogg"
    } else if mime.contains("mp4") {
        "mp4"
    } else {
        "webm"
    };
    let raw = dir.join(format!("rec-{id}.{ext}"));
    let wav = dir.join(format!("rec-{id}.wav"));

    write_bytes(&raw, &bytes)?;
    run_ffmpeg_to_wav(&raw, &wav)?;

    let text = run_transcribe(&wav)?;
    let _ = fs::remove_file(&raw);
    let _ = fs::remove_file(&wav);
    let stem = format!("rec-{id}");
    let _ = fs::remove_file(dir.join(format!("{stem}.txt")));

    if text.trim().is_empty() {
        return Err("No speech detected in recording.".into());
    }
    Ok(text.trim().to_string())
}
