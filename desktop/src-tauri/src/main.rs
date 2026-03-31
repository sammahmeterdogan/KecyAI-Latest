#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW_FLAG: u32 = 0x08000000;

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct PersistedState {
    pid: Option<u32>,
    service_url: Option<String>,
    logs_dir: Option<String>,
    started_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct FailureState {
    message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
struct ReadinessPayload {
    status: Option<String>,
    service_url: Option<String>,
    runtime_status: Option<String>,
    teleop_state: Option<String>,
    calibration_state: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct LauncherStatus {
    state: String,
    service_url: String,
    healthy: bool,
    message: String,
    logs_path: String,
}

fn sanitize_windows_command_path(path: impl AsRef<Path>) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let raw = path.as_ref().to_string_lossy();
        if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{}", stripped));
        }
        if let Some(stripped) = raw.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }

    path.as_ref().to_path_buf()
}

fn apply_windows_background_flags(command: &mut Command) -> &mut Command {
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW_FLAG);
    }
    command
}

fn which_command(name: &str) -> Result<String, String> {
    let mut command = Command::new("where");
    let output = apply_windows_background_flags(&mut command)
        .arg(name)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(stdout.lines().next().unwrap_or("").trim().to_string())
    } else {
        Err(format!("{} not found", name))
    }
}

fn find_python() -> Option<String> {
    let miniforge_paths = [
        dirs_next::home_dir().map(|h| h.join("miniforge3").join("envs").join("lerobot").join("python.exe")),
        dirs_next::home_dir().map(|h| h.join("Desktop").join("Miniforge3").join("envs").join("lerobot").join("python.exe")),
        dirs_next::home_dir().map(|h| h.join("miniforge3").join("python.exe")),
        dirs_next::home_dir().map(|h| h.join("Desktop").join("Miniforge3").join("python.exe")),
    ];
    for path in miniforge_paths.iter().flatten() {
        if path.exists() {
            return Some(path.to_string_lossy().into());
        }
    }
    which_command("python").ok()
}

fn bundled_exe_dir() -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe_path.parent().ok_or("Executable has no parent directory.")?;
    Ok(sanitize_windows_command_path(exe_dir))
}

fn bundled_runtime_sidecar_path() -> Result<PathBuf, String> {
    Ok(bundled_exe_dir()?.join("kecyai-runtime.exe"))
}

fn bundled_resource_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource dir: {}", e))?;
    Ok(sanitize_windows_command_path(path))
}

fn get_project_root() -> PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_default();

    let mut candidate = exe_dir.clone();
    for _ in 0..6 {
        if candidate.join("frontend").exists() && candidate.join("runtime").exists() {
            return sanitize_windows_command_path(candidate);
        }
        if let Some(parent) = candidate.parent() {
            candidate = parent.to_path_buf();
        } else {
            break;
        }
    }

    sanitize_windows_command_path(std::env::current_dir().unwrap_or(exe_dir))
}

fn app_home_dir() -> Result<PathBuf, String> {
    let home = dirs_next::home_dir().ok_or("Home directory not found.")?;
    Ok(sanitize_windows_command_path(home.join(".kecyai")))
}

fn state_file() -> Result<PathBuf, String> {
    Ok(app_home_dir()?.join("state").join("service.json"))
}

fn logs_dir() -> Result<PathBuf, String> {
    Ok(app_home_dir()?.join("logs"))
}

fn failure_file() -> Result<PathBuf, String> {
    Ok(app_home_dir()?.join("state").join("launcher-error.json"))
}

fn read_failure() -> FailureState {
    let path = match failure_file() {
        Ok(path) => path,
        Err(_) => return FailureState::default(),
    };
    let content = match std::fs::read_to_string(&path) {
        Ok(content) => content,
        Err(_) => return FailureState::default(),
    };
    serde_json::from_str(&content).unwrap_or_default()
}

fn write_failure(message: &str) {
    let path = match failure_file() {
        Ok(path) => path,
        Err(_) => return,
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let payload = FailureState {
        message: Some(message.to_string()),
    };
    if let Ok(content) = serde_json::to_string_pretty(&payload) {
        let _ = std::fs::write(path, content);
    }
}

fn clear_failure() {
    if let Ok(path) = failure_file() {
        let _ = std::fs::remove_file(path);
    }
}

fn read_runtime_error_tail() -> Option<String> {
    let stderr_path = logs_dir().ok()?.join("kecyai_service_stderr.log");
    let content = std::fs::read_to_string(stderr_path).ok()?;
    content
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.to_string())
}

fn is_pid_alive(pid: u32) -> bool {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{
            GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        const STILL_ACTIVE: u32 = 259;
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return false;
            }
            let mut exit_code: u32 = 0;
            let ok = GetExitCodeProcess(handle, &mut exit_code);
            CloseHandle(handle);
            ok != 0 && exit_code == STILL_ACTIVE
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = pid;
        true
    }
}

fn read_state() -> PersistedState {
    let path = match state_file() {
        Ok(path) => path,
        Err(_) => return PersistedState::default(),
    };
    let state: PersistedState = match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => return PersistedState::default(),
    };
    if let Some(pid) = state.pid {
        if pid > 0 && !is_pid_alive(pid) {
            let _ = std::fs::remove_file(&path);
            return PersistedState::default();
        }
    }
    state
}

async fn fetch_readiness(url: &str) -> Option<ReadinessPayload> {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
    {
        Ok(client) => client,
        Err(_) => return None,
    };

    let response = client
        .get(format!("{}/api/ready", url.trim_end_matches('/')))
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    response.json::<ReadinessPayload>().await.ok()
}

fn service_state_age() -> Option<Duration> {
    let path = state_file().ok()?;
    let metadata = std::fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?;
    modified.elapsed().ok()
}

fn readiness_is_working(snapshot: &ReadinessPayload) -> bool {
    matches!(
        snapshot.runtime_status.as_deref(),
        Some("running") | Some("calibrating")
    ) || matches!(
        snapshot.teleop_state.as_deref(),
        Some("starting") | Some("running") | Some("stopping")
    ) || matches!(
        snapshot.calibration_state.as_deref(),
        Some("starting") | Some("running") | Some("stopping")
    )
}

async fn current_status() -> LauncherStatus {
    let state = read_state();
    let url = state.service_url.unwrap_or_default();
    let logs_path = state.logs_dir.unwrap_or_else(|| {
        logs_dir()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default()
    });

    if url.is_empty() {
        let failure = read_failure();
        if let Some(message) = failure.message.filter(|value| !value.trim().is_empty()) {
            return LauncherStatus {
                state: "ERROR".into(),
                service_url: String::new(),
                healthy: false,
                message,
                logs_path,
            };
        }
        return LauncherStatus {
            state: "STOPPED".into(),
            service_url: String::new(),
            healthy: false,
            message: "KECYAI local service is not running.".into(),
            logs_path,
        };
    }

    if let Some(readiness) = fetch_readiness(&url).await {
        clear_failure();
        let service_url = readiness.service_url.clone().unwrap_or(url);
        let working = readiness_is_working(&readiness);
        return LauncherStatus {
            state: if working { "WORKING".into() } else { "READY".into() },
            service_url,
            healthy: true,
            message: if working {
                "KECYAI local service is active.".into()
            } else {
                "KECYAI local service is ready.".into()
            },
            logs_path,
        };
    }

    let pid_alive = state.pid.map(is_pid_alive).unwrap_or(false);
    let status_age = service_state_age().unwrap_or_else(|| Duration::from_secs(0));
    let starting = pid_alive && status_age <= Duration::from_secs(25);
    let failure = read_failure();
    let message = failure
        .message
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            if starting {
                "KECYAI local service is starting.".into()
            } else {
                "KECYAI local service failed or became unavailable.".into()
            }
        });

    LauncherStatus {
        state: if starting {
            "STARTING".into()
        } else {
            "ERROR".into()
        },
        service_url: url,
        healthy: false,
        message,
        logs_path,
    }
}

fn spawn_runtime_command(app: &AppHandle, args: &[&str]) -> Result<(), String> {
    let root = get_project_root();
    let runtime_entry = root.join("runtime").join("app").join("runtime_entry.py");
    if runtime_entry.exists() {
        let python = find_python().ok_or("Python not found.")?;
        let mut command = Command::new(python);
        apply_windows_background_flags(&mut command);
        command
            .current_dir(root)
            .arg(runtime_entry)
            .args(args)
            .env("KECYAI_FRONTEND_DEV_URL", "http://127.0.0.1:3000");
        command.spawn().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let bundled_sidecar = bundled_runtime_sidecar_path().ok();
    if let Some(sidecar) = bundled_sidecar {
        if sidecar.exists() {
            let mut command = Command::new(sidecar);
            apply_windows_background_flags(&mut command);
            if let Ok(resource_dir) = bundled_resource_dir(app) {
                let frontend_dir = resource_dir.join("frontend");
                if frontend_dir.exists() {
                    command.env("KECYAI_FRONTEND_DIST", frontend_dir);
                }
                command.current_dir(resource_dir);
            }
            command.args(args);
            command.spawn().map_err(|e| e.to_string())?;
            return Ok(());
        }
    }

    Err("KECYAI runtime entrypoint was not found.".into())
}

fn open_external(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("cmd");
        apply_windows_background_flags(&mut command)
            .args(["/C", "start", "", url])
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("External open is only configured for Windows.".into())
}

#[tauri::command]
async fn launcher_status() -> Result<LauncherStatus, String> {
    Ok(current_status().await)
}

#[tauri::command]
async fn start_local_service(app: AppHandle) -> Result<LauncherStatus, String> {
    let status = current_status().await;
    if status.healthy {
        return Ok(status);
    }

    clear_failure();
    if let Err(error) = spawn_runtime_command(&app, &["run", "--detach", "--host", "127.0.0.1", "--port", "8040", "--port-fallback-end", "8059"]) {
        let message = format!("Failed to launch KECYAI local service: {}", error);
        write_failure(&message);
        return Err(message);
    }

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(25);
    while std::time::Instant::now() < deadline {
        let status = current_status().await;
        if status.healthy {
            return Ok(status);
        }
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    }

    let status = current_status().await;
    let message = if let Some(detail) = read_runtime_error_tail() {
        format!(
            "KECYAI local service did not become ready within 25 seconds. {}",
            detail
        )
    } else {
        format!(
        "KECYAI local service did not become ready within 25 seconds. state={}, url={}",
        status.state, status.service_url
        )
    };
    write_failure(&message);
    Err(message)
}

#[tauri::command]
async fn stop_local_service(app: AppHandle) -> Result<LauncherStatus, String> {
    clear_failure();
    if let Err(error) = spawn_runtime_command(&app, &["stop"]) {
        let message = format!("Failed to stop KECYAI local service: {}", error);
        write_failure(&message);
        return Err(message);
    }

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(12);
    while std::time::Instant::now() < deadline {
        let status = current_status().await;
        if !status.healthy && status.service_url.is_empty() {
            clear_failure();
            return Ok(status);
        }
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }

    let status = current_status().await;
    let message = format!(
        "KECYAI local service did not stop within 12 seconds. state={}, url={}",
        status.state, status.service_url
    );
    write_failure(&message);
    Err(message)
}

#[tauri::command]
async fn open_dashboard() -> Result<(), String> {
    let status = current_status().await;
    let base = if status.service_url.is_empty() {
        "http://127.0.0.1:8040".to_string()
    } else {
        status.service_url
    };
    open_external(&format!("{}/kecy/platform", base.trim_end_matches('/')))
}

#[tauri::command]
fn open_logs() -> Result<(), String> {
    let path = logs_dir()?;
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    open_external(path.to_string_lossy().as_ref())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            launcher_status,
            start_local_service,
            stop_local_service,
            open_dashboard,
            open_logs,
        ])
        .build(tauri::generate_context!())
        .expect("error while building KECY AI Desktop")
        .run(|_, _| {});
}
