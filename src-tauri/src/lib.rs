// SPDX-License-Identifier: MIT
//
// The desktop shell — JW's pattern, constants only (the family standard: the shell is
// a THIN CLIENT; all data lives in the Python server on :8742, and the shell's whole
// job is to spawn that server on startup and tear it down on close).
//
// Ported from justwrite-app/src-tauri/src/lib.rs §"Python server sidecar" with three
// constants changed: the port, the server binary name, and the data-dir env var.
// JustVoice is the original precedent; the three shells stay in lock-step.

use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_dialog::DialogExt;

const SERVER_PORT: u16 = 8742; // JW 17495 · JV 17494 — the family port registry
const SERVER_BIN: &str = "just-ai-i18n-docgen-server";
const DATA_DIR_ENV: &str = "JUST_AI_I18N_DOCGEN_DATA_DIR";

// ─── Data root (the portable, user-settable location for ALL app data) ───────
// Resolved by the shell BEFORE the server spawns (the server owns the DB and the
// runner cache under it, via the env var). Default = a `data/` folder beside the
// app when writable (portable, like VS Code Portable Mode), else the OS app-data
// dir so a Program-Files / read-only-bundle install never fails. A tiny
// `dataroot.txt` pointer, kept OUTSIDE the relocatable root, records a user
// override; storage_relocate moves everything then flips it.

fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.to_path_buf()))
}

fn dir_is_writable(dir: &std::path::Path) -> bool {
    if fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".jaid_write_probe");
    match fs::write(&probe, b"x") {
        Ok(()) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn default_data_root(app: &AppHandle) -> PathBuf {
    if let Some(dir) = exe_dir() {
        if dir_is_writable(&dir) {
            return dir.join("data");
        }
    }
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("just-ai-i18n-docgen-data"))
}

fn pointer_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(dir) = exe_dir() {
        v.push(dir.join("dataroot.txt"));
    }
    if let Ok(cfg) = app.path().app_config_dir() {
        v.push(cfg.join("dataroot.txt"));
    }
    v
}

fn resolve_data_root(app: &AppHandle) -> PathBuf {
    for p in pointer_candidates(app) {
        if let Ok(s) = fs::read_to_string(&p) {
            let root = PathBuf::from(s.trim());
            if !root.as_os_str().is_empty() {
                return root;
            }
        }
    }
    default_data_root(app)
}

fn write_data_root_pointer(app: &AppHandle, root: &std::path::Path) -> std::io::Result<()> {
    let pointer = pointer_candidates(app)
        .into_iter()
        .find(|p| p.parent().map(dir_is_writable).unwrap_or(false))
        .unwrap_or_else(|| PathBuf::from("dataroot.txt"));
    if let Some(parent) = pointer.parent() {
        fs::create_dir_all(parent)?;
    }
    // Atomic: temp sibling + rename, so a torn write can never strand the app on a
    // half-written path.
    let tmp = pointer.with_extension("tmp");
    fs::write(&tmp, root.to_string_lossy().as_bytes())?;
    fs::rename(&tmp, &pointer)
}

fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let target = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

// ─── Python server sidecar ───────────────────────────────────────────

struct SidecarState {
    child: Mutex<Option<Child>>,
}

impl SidecarState {
    fn new(child: Option<Child>) -> Self {
        Self { child: Mutex::new(child) }
    }

    fn kill_child(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
            }
        }
    }

    // Replace the running sidecar (storage_relocate: stop → move data → respawn
    // under the new root).
    fn set_child(&self, child: Option<Child>) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut old) = guard.take() {
                let _ = old.kill();
            }
            *guard = child;
        }
    }
}

fn spawn_sidecar(data_root: &std::path::Path) -> std::io::Result<Option<Child>> {
    // Escape hatch: run the server yourself (`npm run server`) and set this so the
    // shell doesn't spawn a duplicate / evict your manual one.
    if std::env::var("JAID_DEV_NO_SIDECAR").is_ok() {
        return Ok(None);
    }

    if port_in_use(SERVER_PORT) {
        eprintln!(
            "[sidecar] port {SERVER_PORT} already in use — evicting the stale \
             listener before spawning a fresh server"
        );
        kill_listeners_on_port(SERVER_PORT);
        if !wait_for_port_free(SERVER_PORT, Duration::from_secs(5)) {
            eprintln!(
                "[sidecar] port {SERVER_PORT} still occupied after eviction; reusing \
                 the existing server — kill it manually if the UI shows stale data"
            );
            return Ok(None);
        }
        eprintln!("[sidecar] port {SERVER_PORT} freed");
    }

    // IMPORTANT: spawn the `-server` binary, never an unqualified app name — the
    // Tauri binary shares the app name, and Windows CreateProcessW searches the
    // running binary's directory first, so that name resolves to OUR binary,
    // spawning a new desktop window in an infinite loop. (JW's lesson, kept.)
    let child = if cfg!(debug_assertions) {
        // Prefer the repo's OWN venv entry point, resolved from the compile-time
        // crate path (repo root = CARGO_MANIFEST_DIR/..) — `npm run dev` must work
        // from ANY shell, not only one with the venv activated. PATH binary, then
        // `python -m`, stay as the fallbacks.
        let venv_server = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|repo| {
                if cfg!(windows) {
                    repo.join("server").join(".venv").join("Scripts").join(format!("{SERVER_BIN}.exe"))
                } else {
                    repo.join("server").join(".venv").join("bin").join(SERVER_BIN)
                }
            })
            .filter(|p| p.exists());
        let venv_child = venv_server.and_then(|p| {
            Command::new(p)
                .arg("serve")
                .env(DATA_DIR_ENV, data_root)
                .spawn()
                .ok()
        });
        match venv_child {
            Some(child) => child,
            None => match Command::new(SERVER_BIN)
                .arg("serve")
                .env(DATA_DIR_ENV, data_root)
                .spawn()
            {
                Ok(child) => child,
                Err(_) => Command::new("python")
                    .args(["-m", "just_ai_i18n_docgen.serve", "serve"])
                    .env(DATA_DIR_ENV, data_root)
                    .spawn()?,
            },
        }
    } else {
        let exe = std::env::current_exe()?;
        let dir = exe.parent().unwrap_or_else(|| std::path::Path::new("."));
        let bin = if cfg!(windows) {
            dir.join(format!("{SERVER_BIN}.exe"))
        } else {
            dir.join(SERVER_BIN)
        };
        Command::new(bin)
            .arg("serve")
            .env(DATA_DIR_ENV, data_root)
            .spawn()?
    };

    std::thread::spawn(|| {
        if wait_for_port_up(SERVER_PORT, Duration::from_secs(15)) {
            eprintln!("[sidecar] server listening on {SERVER_PORT}");
        } else {
            eprintln!(
                "[sidecar] warning: server is not listening on {SERVER_PORT} after \
                 15s — the UI may show the connection-error screen. Check the server log."
            );
        }
    });

    Ok(Some(child))
}

fn port_in_use(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

fn wait_for_port_free(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if !port_in_use(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    !port_in_use(port)
}

fn wait_for_port_up(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if port_in_use(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    port_in_use(port)
}

#[cfg(windows)]
fn kill_listeners_on_port(port: u16) {
    let output = match Command::new("netstat").args(["-ano"]).output() {
        Ok(o) => o,
        Err(e) => {
            eprintln!("[sidecar] netstat failed, cannot evict stale server: {e}");
            return;
        }
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let needle = format!(":{port}");
    let mut pids = std::collections::HashSet::new();
    for line in text.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 5 || cols[0] != "TCP" || !cols.contains(&"LISTENING") {
            continue;
        }
        if !cols[1].ends_with(&needle) {
            continue;
        }
        if let Ok(pid) = cols[cols.len() - 1].parse::<u32>() {
            if pid != 0 {
                pids.insert(pid);
            }
        }
    }
    for pid in pids {
        eprintln!("[sidecar] killing stale listener on :{port} (PID {pid})");
        let _ = Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string()])
            .output();
    }
}

#[cfg(not(windows))]
fn kill_listeners_on_port(port: u16) {
    let output = match Command::new("lsof")
        .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-t"])
        .output()
    {
        Ok(o) => o,
        Err(e) => {
            eprintln!("[sidecar] lsof failed, cannot evict stale server: {e}");
            return;
        }
    };
    for pid in String::from_utf8_lossy(&output.stdout).split_whitespace() {
        eprintln!("[sidecar] killing stale listener on :{port} (PID {pid})");
        let _ = Command::new("kill").args(["-9", pid]).output();
    }
}

// ─── Storage commands (the portable data root, user-relocatable) ─────

// JW parity (2026-08-03): the panel needs {root, default, portable} — the first port
// silently simplified this to a bare String, which is exactly the deviation class the
// standard forbids. camelCase off the wire like every family payload.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageRoot {
    root: String,
    default: String,
    portable: bool,
}

#[tauri::command]
fn storage_get_root(app: AppHandle) -> StorageRoot {
    let root = resolve_data_root(&app);
    let portable = exe_dir().map(|d| root.starts_with(&d)).unwrap_or(false);
    StorageRoot {
        default: default_data_root(&app).to_string_lossy().into_owned(),
        portable,
        root: root.to_string_lossy().into_owned(),
    }
}

// JW's folder picker, verbatim: the Settings -> Storage "Change folder..." control.
#[tauri::command]
async fn pick_directory(
    app: AppHandle,
    title: Option<String>,
    default_path: Option<String>,
) -> Option<String> {
    let mut dlg = app
        .dialog()
        .file()
        .set_title(&title.unwrap_or_else(|| "Choose a folder".to_string()));
    if let Some(p) = default_path.as_deref().filter(|s| !s.is_empty()) {
        dlg = dlg.set_directory(p);
    }
    let picked = dlg.blocking_pick_folder()?;
    picked.into_path().ok().map(|p| p.display().to_string())
}

#[tauri::command]
fn storage_relocate(app: AppHandle, new_root: String) -> Result<(), String> {
    let old_root = resolve_data_root(&app);
    let new_root = PathBuf::from(new_root.trim());
    if new_root == old_root {
        return Ok(());
    }
    if !dir_is_writable(new_root.parent().unwrap_or(&new_root)) {
        return Err(format!("cannot write to {}", new_root.display()));
    }
    // Stop the server so nothing holds the DB open during the move.
    if let Some(state) = app.try_state::<SidecarState>() {
        state.kill_child();
    }
    wait_for_port_free(SERVER_PORT, Duration::from_secs(5));

    let outcome = relocate_data(&app, &old_root, &new_root);

    // ALWAYS bring a server back up — under the new root on success, the old root
    // on failure — so a failed move never leaves the app serverless.
    let serve_root = if outcome.is_ok() { &new_root } else { &old_root };
    if let Some(state) = app.try_state::<SidecarState>() {
        state.set_child(spawn_sidecar(serve_root).ok().flatten());
    }
    outcome
}

// Crash-safe move. Data is never lost: old_root is deleted only AFTER the pointer
// commit, so a crash before the commit leaves the old root intact + resolvable.
fn relocate_data(
    app: &AppHandle,
    old_root: &std::path::Path,
    new_root: &std::path::Path,
) -> Result<(), String> {
    let name = new_root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "data".to_string());
    let staging = new_root.with_file_name(format!("{name}.jaid_moving"));
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    copy_dir_all(old_root, &staging).map_err(|e| format!("copy failed: {e}"))?;
    fs::rename(&staging, new_root).map_err(|e| format!("finalize failed: {e}"))?;
    // THE commit point — atomic pointer write (tmp + rename inside).
    write_data_root_pointer(app, new_root).map_err(|e| format!("pointer write failed: {e}"))?;
    let _ = fs::remove_dir_all(old_root);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Remember the window size + position across launches (JW parity).
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            // Resolve the (portable, user-settable) data root with Tauri's OWN path
            // resolver, then bring the server up UNDER that root before the webview's
            // first probe. Lock the choice into the pointer on first run.
            let handle = app.handle().clone();
            let root = resolve_data_root(&handle);
            if pointer_candidates(&handle).iter().all(|p| !p.exists()) {
                let _ = write_data_root_pointer(&handle, &root);
            }
            let sidecar = match spawn_sidecar(&root) {
                Ok(child) => SidecarState::new(child),
                Err(e) => {
                    eprintln!("Failed to spawn Python sidecar: {e}");
                    SidecarState::new(None)
                }
            };
            app.manage(sidecar);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![storage_get_root, storage_relocate, pick_directory])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                // Single window, no tray: closing it quits the app, so tear the
                // sidecar down with it instead of leaking a Python process.
                if let Some(state) = window.app_handle().try_state::<SidecarState>() {
                    state.kill_child();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
