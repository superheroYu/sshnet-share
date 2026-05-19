use super::*;

pub(super) fn known_hosts_status(
    app: &AppHandle,
    profile: &Profile,
) -> Result<KnownHostsStatus, String> {
    let path = known_hosts_path(app)?;
    let marker = known_host_marker(profile);
    if !path.exists() {
        return Ok(KnownHostsStatus {
            status: "missing",
            detail: "尚未信任该服务器 Host Key。".to_string(),
            marker,
            path: path.display().to_string(),
            trusted_keys: Vec::new(),
            trusted_key_set_id: known_host_key_set_id(&[]),
        });
    }

    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("读取 known_hosts 失败 {}：{error}", path.display()))?;
    let trusted_keys = known_host_keys_for_marker(&raw, &marker);
    let trusted_key_set_id = known_host_key_set_id(&trusted_keys);

    Ok(KnownHostsStatus {
        status: if trusted_keys.is_empty() {
            "missing"
        } else {
            "trusted"
        },
        detail: if trusted_keys.is_empty() {
            "known_hosts 存在，但未找到当前服务器记录。".to_string()
        } else {
            format!("已信任 {} 条当前服务器 Host Key。", trusted_keys.len())
        },
        marker,
        path: path.display().to_string(),
        trusted_keys,
        trusted_key_set_id,
    })
}

pub(super) fn default_profile() -> Profile {
    Profile {
        id: default_profile_id(),
        schema_version: 1,
        name: "默认配置".to_string(),
        local_proxy_host: "127.0.0.1".to_string(),
        local_proxy_port: 2334,
        local_proxy_protocol: ProxyProtocol::Http,
        ssh_host: "example.com".to_string(),
        ssh_port: 22,
        ssh_user: "appuser".to_string(),
        auth_method: AuthMethod::Key,
        private_key_path: String::new(),
        connect_timeout_seconds: DEFAULT_CONNECT_TIMEOUT_SECONDS,
        reconnect_enabled: false,
        reconnect_interval_seconds: DEFAULT_RECONNECT_INTERVAL_SECONDS,
        remember_ssh_password: false,
        last_connected_at: None,
        remote_bind_host: "127.0.0.1".to_string(),
        remote_proxy_port: 27890,
        no_proxy: vec![
            "localhost".to_string(),
            "127.0.0.1".to_string(),
            "::1".to_string(),
        ],
    }
}

pub(super) fn default_profile_id() -> String {
    "default".to_string()
}

pub(super) fn host_key_alias(profile: &Profile) -> String {
    format!("sshnet-{}", sanitize_host_key_alias(&profile.id))
}

pub(super) fn sanitize_host_key_alias(raw: &str) -> String {
    let alias = raw
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();

    if alias.is_empty() {
        default_profile_id()
    } else {
        alias
    }
}

pub(super) fn normalize_profiles(profiles: &mut [Profile]) {
    if profiles.is_empty() {
        return;
    }

    let mut used = HashSet::<String>::new();
    for (index, profile) in profiles.iter_mut().enumerate() {
        if profile.id.trim().is_empty() {
            profile.id = format!("profile-{}", index + 1);
        }

        let base_id = profile.id.trim().to_string();
        let mut candidate = base_id.clone();
        let mut suffix = 2;
        while used.contains(&candidate) {
            candidate = format!("{base_id}-{suffix}");
            suffix += 1;
        }
        profile.id = candidate.clone();
        used.insert(candidate);
    }
}

pub(super) fn validate_profile(profile: &Profile) -> Result<(), String> {
    if profile.id.trim().is_empty() {
        return Err("Profile ID 不能为空".to_string());
    }
    if profile.local_proxy_host != "127.0.0.1" {
        return Err("0.1.0 仅允许本地代理地址为 127.0.0.1".to_string());
    }
    if profile.remote_bind_host != "127.0.0.1" {
        return Err("0.1.0 仅允许远端绑定地址为 127.0.0.1".to_string());
    }
    if profile.ssh_host.trim().is_empty() {
        return Err("SSH Host 不能为空".to_string());
    }
    if profile.ssh_user.trim().is_empty() {
        return Err("SSH 用户不能为空".to_string());
    }
    if matches!(profile.auth_method, AuthMethod::Pageant) {
        return Err(
            "Pageant authentication is not supported in 0.1.0. Use an SSH key, OpenSSH ssh-agent, or password authentication.".to_string(),
        );
    }
    validate_ssh_target_field("SSH Host", &profile.ssh_host)?;
    validate_ssh_target_field("SSH user", &profile.ssh_user)?;
    validate_private_key_path(&profile.private_key_path)?;
    if profile.local_proxy_port == 0 || profile.ssh_port == 0 || profile.remote_proxy_port == 0 {
        return Err("端口必须在 1-65535 范围内".to_string());
    }
    if profile.remote_proxy_port < 1024 {
        return Err("远端代理端口必须在 1024-65535 范围内".to_string());
    }
    if !(3..=60).contains(&profile.connect_timeout_seconds) {
        return Err("连接超时必须在 3-60 秒范围内".to_string());
    }
    if !(3..=3600).contains(&profile.reconnect_interval_seconds) {
        return Err("重连间隔必须在 3-3600 秒范围内".to_string());
    }
    Ok(())
}

pub(super) fn validate_ssh_target_field(label: &str, value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} cannot be empty"));
    }
    if trimmed != value
        || value
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err(format!(
            "{label} cannot contain whitespace or control characters"
        ));
    }
    if value.starts_with('-') {
        return Err(format!("{label} cannot start with '-'"));
    }
    Ok(())
}

pub(super) fn validate_private_key_path(value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    if trimmed != value
        || value
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err("Private key path cannot contain whitespace or control characters".to_string());
    }
    if value.starts_with('-') {
        return Err("Private key path cannot start with '-'".to_string());
    }
    if is_disallowed_private_key_path(Path::new(trimmed)) {
        return Err("Private key path must be a local filesystem path".to_string());
    }
    Ok(())
}

#[cfg(windows)]
pub(super) fn is_disallowed_private_key_path(path: &Path) -> bool {
    let Some(std::path::Component::Prefix(prefix)) = path.components().next() else {
        return false;
    };
    match prefix.kind() {
        std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_) => false,
        std::path::Prefix::UNC(..)
        | std::path::Prefix::VerbatimUNC(..)
        | std::path::Prefix::DeviceNS(..)
        | std::path::Prefix::Verbatim(_) => true,
    }
}

#[cfg(not(windows))]
pub(super) fn is_disallowed_private_key_path(_path: &Path) -> bool {
    false
}

pub(super) fn validate_profiles(profiles: &[Profile]) -> Result<(), String> {
    let mut remote_ports = HashMap::<(String, u16, String, u16), &Profile>::new();

    for profile in profiles {
        validate_profile(profile)?;
        let key = (
            normalized_conflict_field(&profile.ssh_host),
            profile.ssh_port,
            normalized_conflict_field(&profile.remote_bind_host),
            profile.remote_proxy_port,
        );
        if let Some(existing) = remote_ports.get(&key) {
            if existing.id != profile.id {
                return Err(format!("该服务器的远端端口已被 {} 使用。", existing.name));
            }
        } else {
            remote_ports.insert(key, profile);
        }
    }

    Ok(())
}

pub(super) fn normalized_conflict_field(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

pub(super) fn record_profile_last_connected_at(
    app: &AppHandle,
    manager: &TunnelManager,
    profile_id: &str,
    timestamp_ms: u64,
) -> Result<(), String> {
    let _store_guard = manager
        .store_lock
        .lock()
        .map_err(|_| "配置存储锁已损坏".to_string())?;
    let mut profiles = load_profiles_inner(app)?;
    let Some(profile) = profiles.iter_mut().find(|profile| profile.id == profile_id) else {
        return Ok(());
    };
    profile.last_connected_at = Some(timestamp_ms);

    let path = profiles_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "create profile directory failed {}: {error}",
                parent.display()
            )
        })?;
    }
    let raw = serde_json::to_string_pretty(&profiles)
        .map_err(|error| format!("序列化配置失败：{error}"))?;
    write_file_replace(&path, &raw)
}

pub(super) fn profile_last_connected_at(app: &AppHandle, profile_id: &str) -> Option<u64> {
    load_profiles_inner(app)
        .ok()?
        .into_iter()
        .find(|profile| profile.id == profile_id)
        .and_then(|profile| profile.last_connected_at)
}

pub(super) fn default_connect_timeout_seconds() -> u16 {
    DEFAULT_CONNECT_TIMEOUT_SECONDS
}

pub(super) fn default_reconnect_interval_seconds() -> u16 {
    DEFAULT_RECONNECT_INTERVAL_SECONDS
}

pub(super) fn default_schema_version() -> u16 {
    1
}

pub(super) fn default_profile_name() -> String {
    default_profile().name
}

pub(super) fn default_local_proxy_host() -> String {
    "127.0.0.1".to_string()
}

pub(super) fn default_local_proxy_port() -> u16 {
    2334
}

pub(super) fn default_local_proxy_protocol() -> ProxyProtocol {
    ProxyProtocol::Http
}

pub(super) fn default_ssh_host() -> String {
    "example.com".to_string()
}

pub(super) fn default_ssh_port() -> u16 {
    22
}

pub(super) fn default_ssh_user() -> String {
    "appuser".to_string()
}

pub(super) fn default_auth_method() -> AuthMethod {
    AuthMethod::Key
}

pub(super) fn default_remote_bind_host() -> String {
    "127.0.0.1".to_string()
}

pub(super) fn default_remote_proxy_port() -> u16 {
    27890
}

pub(super) fn default_no_proxy() -> Vec<String> {
    vec![
        "localhost".to_string(),
        "127.0.0.1".to_string(),
        "::1".to_string(),
    ]
}
