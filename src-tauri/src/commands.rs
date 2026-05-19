use super::*;

#[tauri::command]
pub(super) fn get_environment_status(app: AppHandle) -> Vec<EnvironmentCheck> {
    vec![
        check_ssh(),
        check_ssh_keyscan(),
        // Tauri can only invoke this command after WebView2 has loaded successfully.
        EnvironmentCheck {
            key: "webview2",
            label: "WebView2 Runtime",
            status: "ready",
            detail: "由 Windows WebView2 Runtime 提供桌面 Web 渲染。".to_string(),
        },
        check_profile_store(&app),
    ]
}

#[tauri::command]
pub(super) fn load_profiles(app: AppHandle) -> Result<Vec<Profile>, String> {
    load_profiles_inner(&app)
}

pub(super) fn load_profiles_inner(app: &AppHandle) -> Result<Vec<Profile>, String> {
    let path = profiles_path(app)?;
    if path.exists() {
        let raw = fs::read_to_string(&path)
            .map_err(|error| format!("读取配置失败 {}：{error}", path.display()))?;
        let mut profiles = serde_json::from_str::<Vec<Profile>>(&raw)
            .map_err(|error| format!("解析配置失败 {}：{error}", path.display()))?;
        normalize_profiles(&mut profiles);
        return Ok(profiles);
    }

    let legacy_path = legacy_profile_path(app)?;
    if legacy_path.exists() {
        let raw = fs::read_to_string(&legacy_path)
            .map_err(|error| format!("读取旧配置失败 {}：{error}", legacy_path.display()))?;
        let mut profile = serde_json::from_str::<Profile>(&raw)
            .map_err(|error| format!("解析旧配置失败 {}：{error}", legacy_path.display()))?;
        if profile.id.trim().is_empty() {
            profile.id = default_profile_id();
        }
        return Ok(vec![profile]);
    }

    Ok(Vec::new())
}

#[tauri::command]
pub(super) fn load_profile(app: AppHandle) -> Result<Profile, String> {
    load_profiles_inner(&app)?
        .into_iter()
        .next()
        .ok_or_else(|| "No profiles configured".to_string())
}

#[tauri::command]
pub(super) fn save_profiles(
    app: AppHandle,
    state: State<TunnelManager>,
    profiles: Vec<Profile>,
) -> Result<Vec<Profile>, String> {
    let _store_guard = state
        .store_lock
        .lock()
        .map_err(|_| "配置存储锁已损坏".to_string())?;
    save_profiles_inner(&app, profiles)
}

pub(super) fn save_profiles_inner(
    app: &AppHandle,
    mut profiles: Vec<Profile>,
) -> Result<Vec<Profile>, String> {
    let previous_profiles = load_profiles_inner(app).unwrap_or_default();
    normalize_profiles(&mut profiles);
    merge_profile_server_fields(&mut profiles, &previous_profiles);
    validate_profiles(&profiles)?;

    let path = profiles_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建配置目录失败 {}：{error}", parent.display()))?;
    }

    let raw = serde_json::to_string_pretty(&profiles)
        .map_err(|error| format!("序列化配置失败：{error}"))?;
    write_file_replace(&path, &raw)?;
    cleanup_saved_passwords_after_profile_save(&previous_profiles, &profiles)?;

    Ok(profiles)
}

pub(super) fn merge_profile_server_fields(profiles: &mut [Profile], previous_profiles: &[Profile]) {
    for profile in profiles {
        let Some(previous) = previous_profiles
            .iter()
            .find(|previous| previous.id == profile.id)
        else {
            continue;
        };
        profile.last_connected_at = match (profile.last_connected_at, previous.last_connected_at) {
            (Some(current), Some(previous)) => Some(current.max(previous)),
            (Some(current), None) => Some(current),
            (None, Some(previous)) => Some(previous),
            (None, None) => None,
        };
    }
}

pub(super) fn save_profile_inner(
    app: &AppHandle,
    manager: &TunnelManager,
    profile: Profile,
) -> Result<Profile, String> {
    let _store_guard = manager
        .store_lock
        .lock()
        .map_err(|_| "配置存储锁已损坏".to_string())?;
    validate_profile(&profile)?;
    let requested_id = profile.id.clone();
    let mut profiles = load_profiles_inner(app)?;
    if let Some(existing) = profiles.iter_mut().find(|item| item.id == profile.id) {
        *existing = profile.clone();
    } else {
        profiles.push(profile.clone());
    }
    let saved = save_profiles_inner(app, profiles)?;
    Ok(saved
        .into_iter()
        .find(|item| item.id == requested_id)
        .unwrap_or(profile))
}

#[tauri::command]
pub(super) fn save_profile(
    app: AppHandle,
    state: State<TunnelManager>,
    profile: Profile,
) -> Result<Profile, String> {
    save_profile_inner(&app, state.inner(), profile)
}

#[tauri::command]
pub(super) fn list_ssh_config_hosts(app: AppHandle) -> Result<Vec<SshConfigHost>, String> {
    let path = user_ssh_config_path(&app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let home = path
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| "无法定位用户主目录".to_string())?;
    parse_ssh_config_hosts_from_file(&path, home)
}

#[allow(dead_code)]
pub(super) fn legacy_load_profile_inner(app: &AppHandle) -> Result<Profile, String> {
    let path = legacy_profile_path(app)?;
    if !path.exists() {
        return Ok(default_profile());
    }

    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("读取配置失败 {}：{error}", path.display()))?;
    serde_json::from_str(&raw).map_err(|error| format!("解析配置失败 {}：{error}", path.display()))
}

#[tauri::command]
pub(super) fn probe_local_proxy(profile: Profile) -> Result<ProxyProbeResult, String> {
    validate_profile(&profile)?;

    let preferred = probe_local_proxy_protocol(
        profile.local_proxy_port,
        &profile.local_proxy_host,
        &profile.local_proxy_protocol,
    );
    if preferred.protocol.is_some() || !preferred.reachable {
        return Ok(preferred);
    }

    Ok(probe_local_proxy_port(
        profile.local_proxy_port,
        &profile.local_proxy_host,
    ))
}

#[tauri::command]
pub(super) fn discover_local_proxies(
    profile: Profile,
) -> Result<LocalProxyDiscoveryResult, String> {
    validate_profile(&profile)?;
    Ok(discover_local_proxies_inner(&profile))
}
