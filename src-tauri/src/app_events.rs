use super::*;

const MAX_APP_EVENTS: usize = 100;
const MAX_APP_EVENT_TITLE_CHARS: usize = 80;
const MAX_APP_EVENT_MESSAGE_CHARS: usize = 240;
const SSHNET_EVENT_NAME: &str = "sshnet-event";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AppEvent {
    pub(super) id: u64,
    pub(super) timestamp_ms: u64,
    pub(super) level: String,
    pub(super) category: String,
    pub(super) title: String,
    pub(super) message: String,
    pub(super) profile_id: Option<String>,
}

#[derive(Default)]
pub(super) struct AppEventStore {
    buffer: Mutex<AppEventBuffer>,
}

#[derive(Default)]
struct AppEventBuffer {
    next_id: u64,
    entries: VecDeque<AppEvent>,
}

#[tauri::command]
pub(super) fn get_app_events(state: State<TunnelManager>) -> Result<Vec<AppEvent>, String> {
    app_event_snapshot(&state.events)
}

#[tauri::command]
pub(super) fn record_app_event(
    app: AppHandle,
    state: State<TunnelManager>,
    level: String,
    category: String,
    title: String,
    message: String,
    profile_id: Option<String>,
) -> Result<AppEvent, String> {
    let event = push_app_event_to_store(
        &state.events,
        &level,
        &category,
        &title,
        &message,
        profile_id.as_deref(),
    )?;
    let _ = app.emit(SSHNET_EVENT_NAME, event.clone());
    Ok(event)
}

pub(super) fn push_app_event(
    app: &AppHandle,
    manager: &TunnelManager,
    level: &str,
    category: &str,
    title: &str,
    message: &str,
    profile_id: Option<&str>,
) {
    if let Ok(event) = push_app_event_to_store(
        &manager.events,
        level,
        category,
        title,
        message,
        profile_id,
    ) {
        let _ = app.emit(SSHNET_EVENT_NAME, event);
    }
}

pub(super) fn push_app_event_to_store(
    store: &AppEventStore,
    level: &str,
    category: &str,
    title: &str,
    message: &str,
    profile_id: Option<&str>,
) -> Result<AppEvent, String> {
    let mut guard = store
        .buffer
        .lock()
        .map_err(|_| "app event lock is poisoned".to_string())?;
    guard.next_id = guard.next_id.saturating_add(1);
    let event = AppEvent {
        id: guard.next_id,
        timestamp_ms: current_time_millis(),
        level: normalize_app_event_level(level).to_string(),
        category: normalize_app_event_category(category).to_string(),
        title: normalize_app_event_text(title, MAX_APP_EVENT_TITLE_CHARS, "App event"),
        message: normalize_app_event_text(message, MAX_APP_EVENT_MESSAGE_CHARS, ""),
        profile_id: profile_id.map(ToString::to_string),
    };
    guard.entries.push_back(event.clone());
    while guard.entries.len() > MAX_APP_EVENTS {
        guard.entries.pop_front();
    }
    Ok(event)
}

pub(super) fn app_event_snapshot(store: &AppEventStore) -> Result<Vec<AppEvent>, String> {
    let guard = store
        .buffer
        .lock()
        .map_err(|_| "app event lock is poisoned".to_string())?;
    Ok(guard.entries.iter().cloned().collect())
}

fn normalize_app_event_level(level: &str) -> &'static str {
    match level {
        "ERROR" => "ERROR",
        "WARN" => "WARN",
        _ => "INFO",
    }
}

fn normalize_app_event_category(category: &str) -> &'static str {
    match category {
        "tray" => "tray",
        "tunnel" => "tunnel",
        "hostKey" => "hostKey",
        "logs" => "logs",
        "diagnostics" => "diagnostics",
        "updates" => "updates",
        _ => "app",
    }
}

fn normalize_app_event_text(value: &str, max_chars: usize, fallback: &str) -> String {
    let normalized = value
        .trim()
        .chars()
        .map(|ch| if ch.is_control() { ' ' } else { ch })
        .take(max_chars)
        .collect::<String>()
        .trim()
        .to_string();

    if normalized.is_empty() {
        fallback.to_string()
    } else {
        normalized
    }
}
