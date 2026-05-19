use base64::{engine::general_purpose, Engine as _};
use glob::{glob_with, MatchOptions};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    env, fs,
    io::{BufRead, BufReader, ErrorKind, Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, State, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;
#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{CloseHandle, GetLastError, ERROR_NOT_FOUND, HANDLE},
    Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    },
    System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    },
};
use zeroize::{Zeroize, Zeroizing};
use zip::write::SimpleFileOptions;

const PROFILES_FILE_NAME: &str = "profiles.json";
const LEGACY_PROFILE_FILE_NAME: &str = "profile.json";
const STARTUP_SETTINGS_FILE_NAME: &str = "startup.json";
const STARTUP_ARG: &str = "--sshnet-startup";
const KNOWN_HOSTS_FILE_NAME: &str = "known_hosts";
const DEFAULT_CONNECT_TIMEOUT_SECONDS: u16 = 10;
const DEFAULT_RECONNECT_INTERVAL_SECONDS: u16 = 10;
const MAX_TUNNEL_LOG_ENTRIES: usize = 200;
const MAX_TUNNEL_LOG_FILE_BYTES: u64 = 1024 * 1024;
const MAX_TUNNEL_LOG_ARCHIVES: usize = 5;
const MAX_SSH_CONFIG_INCLUDE_DEPTH: usize = 8;
const MAX_SSH_CONFIG_INCLUDE_FILES: usize = 64;
const MAX_SSH_CONFIG_FILE_BYTES: u64 = 1024 * 1024;
const LOG_DIR_NAME: &str = "logs";
const CURRENT_LOG_FILE_NAME: &str = "current.jsonl";
const EXPORT_LOG_DIR_NAME: &str = "exports";
const COMMON_LOCAL_PROXY_PORTS: &[u16] = &[
    2334, 7890, 7891, 7892, 7893, 7897, 1080, 10808, 10809, 20170, 2080, 8080, 8081, 8118, 8888,
    9090, 6152, 7070, 3128,
];
const TRAY_OPEN: &str = "open";
const TRAY_START: &str = "start";
const TRAY_STOP: &str = "stop";
const TRAY_LOGS: &str = "logs";
const TRAY_QUIT: &str = "quit";
const TRAY_ICON_ID: &str = "main";
const TRAY_SHOW_LOGS_EVENT: &str = "tray-show-logs";
const STATUS_CHANGED_EVENT: &str = "sshnet-status-changed";
const LOG_ENTRY_EVENT: &str = "sshnet-log-entry";
const ASKPASS_BROKER_TIMEOUT: Duration = Duration::from_secs(90);
const ASKPASS_IO_TIMEOUT: Duration = Duration::from_secs(5);
const SSH_STARTUP_CHECK_DEFAULT: Duration = Duration::from_millis(450);
const SSH_STARTUP_CHECK_PASSWORD_EXTRA: Duration = Duration::from_secs(5);
const SSH_STARTUP_CHECK_INTERVAL: Duration = Duration::from_millis(100);
const SSH_OUTPUT_FLUSH_DELAY: Duration = Duration::from_millis(80);

pub(super) fn hidden_command(program: &str) -> Command {
    let mut command = Command::new(program);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvironmentCheck {
    key: &'static str,
    label: &'static str,
    status: &'static str,
    detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Profile {
    #[serde(default = "default_profile_id")]
    id: String,
    #[serde(default = "default_schema_version")]
    schema_version: u16,
    #[serde(default = "default_profile_name")]
    name: String,
    #[serde(default = "default_local_proxy_host")]
    local_proxy_host: String,
    #[serde(default = "default_local_proxy_port")]
    local_proxy_port: u16,
    #[serde(default = "default_local_proxy_protocol")]
    local_proxy_protocol: ProxyProtocol,
    #[serde(default = "default_ssh_host")]
    ssh_host: String,
    #[serde(default = "default_ssh_port")]
    ssh_port: u16,
    #[serde(default = "default_ssh_user")]
    ssh_user: String,
    #[serde(default = "default_auth_method")]
    auth_method: AuthMethod,
    #[serde(default)]
    private_key_path: String,
    #[serde(default = "default_connect_timeout_seconds")]
    connect_timeout_seconds: u16,
    #[serde(default)]
    reconnect_enabled: bool,
    #[serde(default = "default_reconnect_interval_seconds")]
    reconnect_interval_seconds: u16,
    #[serde(default)]
    remember_ssh_password: bool,
    #[serde(default)]
    last_connected_at: Option<u64>,
    #[serde(default = "default_remote_bind_host")]
    remote_bind_host: String,
    #[serde(default = "default_remote_proxy_port")]
    remote_proxy_port: u16,
    #[serde(default = "default_no_proxy")]
    no_proxy: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProxyProbeResult {
    reachable: bool,
    protocol: Option<ProxyProtocol>,
    detail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalProxyCandidate {
    host: String,
    port: u16,
    protocol: ProxyProtocol,
    source: String,
    detail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalProxyDiscoveryResult {
    candidates: Vec<LocalProxyCandidate>,
    scanned_ports: Vec<u16>,
    detail: String,
}

#[derive(Debug, Clone)]
struct ProxyPortCandidate {
    port: u16,
    source: String,
}

#[derive(Default)]
struct TunnelManager {
    lifecycle: Mutex<()>,
    children: Mutex<HashMap<String, ManagedChild>>,
    reconnects: Mutex<HashMap<String, ReconnectTask>>,
    reconnect_generations: Mutex<HashMap<String, u64>>,
    store_lock: Mutex<()>,
    tray_task: Mutex<Option<&'static str>>,
    logs: Arc<TunnelLogStore>,
    events: Arc<AppEventStore>,
}

struct ManagedChild {
    child: Child,
    profile: Profile,
    last_connected_at: Option<u64>,
    #[cfg(windows)]
    _job: WindowsJob,
}

impl ManagedChild {
    fn new(child: Child, profile: Profile) -> Result<Self, String> {
        #[cfg(windows)]
        {
            let mut child = child;
            match WindowsJob::for_child(&child) {
                Ok(job) => Ok(Self {
                    child,
                    profile,
                    last_connected_at: None,
                    _job: job,
                }),
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    Err(error)
                }
            }
        }

        #[cfg(not(windows))]
        {
            Ok(Self {
                child,
                profile,
                last_connected_at: None,
            })
        }
    }

    fn id(&self) -> u32 {
        self.child.id()
    }

    fn try_wait(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
        self.child.try_wait()
    }

    fn kill(&mut self) -> std::io::Result<()> {
        self.child.kill()
    }

    fn wait(&mut self) -> std::io::Result<std::process::ExitStatus> {
        self.child.wait()
    }
}

#[derive(Clone)]
struct ReconnectTask {
    profile: Profile,
    attempt: u32,
    generation: u64,
    next_attempt_at: Instant,
}

#[cfg(windows)]
struct WindowsJob {
    handle: HANDLE,
}

#[cfg(windows)]
unsafe impl Send for WindowsJob {}

#[cfg(windows)]
impl WindowsJob {
    fn for_child(child: &Child) -> Result<Self, String> {
        let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if job.is_null() {
            return Err(format!("创建 Windows Job Object 失败：{}", unsafe {
                GetLastError()
            }));
        }

        let job = Self { handle: job };
        let mut limits = unsafe { std::mem::zeroed::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        let set_result = unsafe {
            SetInformationJobObject(
                job.handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if set_result == 0 {
            return Err(format!("配置 Windows Job Object 失败：{}", unsafe {
                GetLastError()
            }));
        }

        let process = child.as_raw_handle() as HANDLE;
        let assign_result = unsafe { AssignProcessToJobObject(job.handle, process) };
        if assign_result == 0 {
            return Err(format!("加入 Windows Job Object 失败：{}", unsafe {
                GetLastError()
            }));
        }

        Ok(job)
    }
}

#[cfg(windows)]
impl Drop for WindowsJob {
    fn drop(&mut self) {
        if !self.handle.is_null() {
            unsafe {
                CloseHandle(self.handle);
            }
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TunnelStatus {
    status: &'static str,
    detail: String,
    pid: Option<u32>,
    last_connected_at: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TunnelStatusChangedEvent {
    profile_id: String,
    status: TunnelStatus,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TunnelLogEntry {
    id: u64,
    timestamp_ms: u64,
    level: String,
    source: String,
    profile_id: Option<String>,
    message: String,
}

#[derive(Default)]
struct TunnelLogStore {
    buffer: Mutex<TunnelLogBuffer>,
    writer: Mutex<Option<RotatingLogWriter>>,
}

#[derive(Default)]
struct TunnelLogBuffer {
    next_id: u64,
    entries: VecDeque<TunnelLogEntry>,
}

struct RotatingLogWriter {
    log_dir: PathBuf,
    current_path: PathBuf,
    current_bytes: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct KnownHostKeyInfo {
    host: String,
    algorithm: String,
    fingerprint: String,
    key_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KnownHostsStatus {
    status: &'static str,
    detail: String,
    marker: String,
    path: String,
    trusted_keys: Vec<KnownHostKeyInfo>,
    trusted_key_set_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HostKeyScanResult {
    profile_id: String,
    marker: String,
    host: String,
    port: u16,
    host_keys: Vec<String>,
    fingerprints: Vec<KnownHostKeyInfo>,
    existing_keys: Vec<KnownHostKeyInfo>,
    existing_key_set_id: String,
    scanned_key_set_id: String,
    trust_action: &'static str,
    scanned_at: u64,
    detail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LogExportResult {
    path: String,
    directory: String,
    line_count: usize,
    redaction_count: usize,
    detail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LogPreviewResult {
    line_count: usize,
    redaction_count: usize,
    preview_lines: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LogExportFilter {
    levels: Vec<String>,
    profile_id: Option<String>,
    source: Option<String>,
    from_timestamp_ms: Option<u64>,
    to_timestamp_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LogStorageInfo {
    log_dir: String,
    current_file: String,
    total_bytes: u64,
    file_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticBundleResult {
    path: String,
    directory: String,
    detail: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrustHostKeysRequest {
    profile_id: String,
    host: String,
    port: u16,
    host_keys: Vec<String>,
    expected_marker: String,
    expected_existing_key_set_id: String,
    scanned_key_set_id: String,
    allow_replace: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SshConfigHost {
    alias: String,
    host_name: Option<String>,
    user: Option<String>,
    port: Option<u16>,
    identity_file: Option<String>,
}

#[derive(Default)]
struct SshConfigHostBlock {
    patterns: Vec<String>,
    host_name: Option<String>,
    user: Option<String>,
    port: Option<u16>,
    identity_file: Option<SshConfigIdentityFile>,
}

#[derive(Clone)]
enum SshConfigIdentityFile {
    Disabled,
    File(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ProxyProtocol {
    Http,
    Socks5,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum AuthMethod {
    Key,
    Agent,
    Pageant,
    Password,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SshStartupSignal {
    Authenticated,
    RemoteForwardReady,
}

#[path = "commands.rs"]
mod commands;
use commands::*;
#[path = "app_events.rs"]
mod app_events;
use app_events::*;
#[path = "credentials.rs"]
mod credentials;
use credentials::*;
#[path = "known_hosts.rs"]
mod known_hosts;
use known_hosts::*;
#[path = "log_commands.rs"]
mod log_commands;
use log_commands::*;
#[path = "tunnel.rs"]
mod tunnel;
use tunnel::*;
#[path = "tunnel_output.rs"]
mod tunnel_output;
use tunnel_output::*;
#[path = "tunnel_reconnect.rs"]
mod tunnel_reconnect;
use tunnel_reconnect::*;
#[path = "paths_ssh_config.rs"]
mod paths_ssh_config;
use paths_ssh_config::*;
#[path = "profiles.rs"]
mod profiles;
use profiles::*;
#[path = "ssh_auth.rs"]
mod ssh_auth;
use ssh_auth::*;
#[path = "known_hosts_helpers.rs"]
mod known_hosts_helpers;
use known_hosts_helpers::*;
#[path = "startup.rs"]
mod startup;
use startup::*;
#[path = "logs.rs"]
mod logs;
use logs::*;
#[path = "diagnostics.rs"]
mod diagnostics;
use diagnostics::*;
#[path = "proxy.rs"]
mod proxy;
use proxy::*;
#[path = "environment.rs"]
mod environment;
use environment::*;
#[path = "tray.rs"]
mod tray;
use tray::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }));
        builder = builder.plugin(
            tauri_plugin_autostart::Builder::new()
                .args([STARTUP_ARG])
                .app_name("SSHNet Share")
                .build(),
        );
        builder = builder.plugin(tauri_plugin_process::init());
    }

    builder
        .manage(TunnelManager::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let (start_hidden, startup_preference_error) = startup_visibility_decision(&handle);
            #[cfg(desktop)]
            handle.plugin(tauri_plugin_updater::Builder::new().build())?;
            let logs = {
                let manager = app.state::<TunnelManager>();
                initialize_tunnel_logs(&handle, manager.inner())?;
                Arc::clone(&manager.logs)
            };
            start_tunnel_monitor(&handle);
            setup_tray(app)?;
            if let Some(error) = startup_preference_error {
                push_tunnel_log_with_source(
                    &handle,
                    &logs,
                    "WARN",
                    "app",
                    None,
                    &format!(
                        "Startup preferences could not be read; using silent startup default: {error}"
                    ),
                );
            }
            if start_hidden {
                push_tunnel_log_with_source(
                    &handle,
                    &logs,
                    "INFO",
                    "app",
                    None,
                    "Started silently from Windows sign-in",
                );
            } else {
                show_main_window(&handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_environment_status,
            load_profiles,
            load_profile,
            save_profiles,
            save_profile,
            list_ssh_config_hosts,
            probe_local_proxy,
            discover_local_proxies,
            get_known_hosts_status,
            scan_host_keys,
            trust_host_keys,
            get_tunnel_logs,
            clear_tunnel_logs,
            append_app_log,
            preview_tunnel_logs,
            export_tunnel_logs,
            get_log_storage_info,
            get_app_events,
            record_app_event,
            get_startup_preferences,
            set_startup_preferences,
            set_tray_language,
            export_diagnostic_bundle,
            has_saved_ssh_password,
            forget_saved_ssh_password,
            start_tunnel,
            stop_tunnel,
            stop_all_tunnels,
            get_tunnel_status
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                let state = app.state::<TunnelManager>();
                let _ = stop_all_tunnels_inner(app, state.inner());
            }
        });
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
