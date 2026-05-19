use super::*;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct StartupPreferences {
    #[serde(default = "default_silent_start_on_boot")]
    pub(super) silent_start_on_boot: bool,
}

impl Default for StartupPreferences {
    fn default() -> Self {
        Self {
            silent_start_on_boot: default_silent_start_on_boot(),
        }
    }
}

fn default_silent_start_on_boot() -> bool {
    true
}

#[tauri::command]
pub(super) fn get_startup_preferences(app: AppHandle) -> Result<StartupPreferences, String> {
    load_startup_preferences(&app)
}

#[tauri::command]
pub(super) fn set_startup_preferences(
    app: AppHandle,
    preferences: StartupPreferences,
) -> Result<StartupPreferences, String> {
    save_startup_preferences(&app, preferences)?;
    load_startup_preferences(&app)
}

pub(super) fn startup_visibility_decision(app: &AppHandle) -> (bool, Option<String>) {
    if !startup_args_request_silent(env::args()) {
        return (false, None);
    }

    match load_startup_preferences(app) {
        Ok(preferences) => (preferences.silent_start_on_boot, None),
        Err(error) => (default_silent_start_on_boot(), Some(error)),
    }
}

pub(super) fn startup_args_request_silent<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().any(|arg| arg.as_ref() == STARTUP_ARG)
}

fn load_startup_preferences(app: &AppHandle) -> Result<StartupPreferences, String> {
    let path = startup_preferences_path(app)?;
    if !path.exists() {
        return Ok(StartupPreferences::default());
    }

    let raw = fs::read_to_string(&path).map_err(|error| {
        format!(
            "Failed to read startup preferences {}: {error}",
            path.display()
        )
    })?;
    serde_json::from_str::<StartupPreferences>(&raw).map_err(|error| {
        format!(
            "Failed to parse startup preferences {}: {error}",
            path.display()
        )
    })
}

fn save_startup_preferences(
    app: &AppHandle,
    preferences: StartupPreferences,
) -> Result<(), String> {
    let path = startup_preferences_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create startup preferences directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let raw = serde_json::to_string_pretty(&preferences)
        .map_err(|error| format!("Failed to serialize startup preferences: {error}"))?;
    write_file_replace(&path, &raw)
}

fn startup_preferences_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Failed to locate startup preferences directory: {error}"))?
        .join(STARTUP_SETTINGS_FILE_NAME))
}
