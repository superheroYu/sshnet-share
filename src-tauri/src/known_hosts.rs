use super::*;

static FALLBACK_KNOWN_HOSTS_COUNTER: AtomicU64 = AtomicU64::new(0);

#[tauri::command]
pub(super) fn get_known_hosts_status(
    app: AppHandle,
    profile: Profile,
) -> Result<KnownHostsStatus, String> {
    validate_profile(&profile)?;
    known_hosts_status(&app, &profile)
}

#[tauri::command]
pub(super) fn scan_host_keys(
    app: AppHandle,
    profile: Profile,
) -> Result<HostKeyScanResult, String> {
    validate_profile(&profile)?;

    let marker = known_host_marker(&profile);
    let host_keys = scan_host_key_lines(&app, &profile)?;
    let fingerprints = host_keys
        .iter()
        .filter_map(|line| parse_known_host_key(line))
        .collect::<Vec<_>>();
    let scanned_key_set_id = known_host_key_set_id(&fingerprints);
    let existing_keys = existing_known_host_keys(&app, &marker)?;
    let existing_key_set_id = known_host_key_set_id(&existing_keys);
    let trust_action =
        known_host_trust_action(&existing_keys, &existing_key_set_id, &scanned_key_set_id);
    let scanned_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default();

    Ok(HostKeyScanResult {
        profile_id: profile.id.clone(),
        marker,
        host: profile.ssh_host.trim().to_string(),
        port: profile.ssh_port,
        detail: format!("扫描到 {} 条 host key。", host_keys.len()),
        host_keys,
        fingerprints,
        existing_keys,
        existing_key_set_id,
        scanned_key_set_id,
        trust_action,
        scanned_at,
    })
}

pub(super) fn scan_host_key_lines(
    app: &AppHandle,
    profile: &Profile,
) -> Result<Vec<String>, String> {
    validate_profile(profile)?;
    let timeout = profile.connect_timeout_seconds.to_string();
    let port = profile.ssh_port.to_string();
    let ssh_host = profile.ssh_host.trim();
    let output = hidden_command("ssh-keyscan")
        .args(["-T", &timeout, "-p", &port, ssh_host])
        .output()
        .map_err(|error| format!("启动 ssh-keyscan 失败：{error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let host_keys = stdout
        .lines()
        .filter(|line| normalize_host_key_line(profile, line).is_some())
        .map(|line| line.trim().to_string())
        .collect::<Vec<_>>();

    if !host_keys.is_empty() {
        return Ok(host_keys);
    }

    let detail = stderr.trim();
    if ssh_keyscan_needs_ssh_fallback(detail) {
        if let Ok(fallback_keys) = scan_host_keys_with_ssh_fallback(app, profile) {
            if !fallback_keys.is_empty() {
                return Ok(fallback_keys);
            }
        }
    }

    Err(if detail.is_empty() {
        "ssh-keyscan 未返回 host key".to_string()
    } else if ssh_keyscan_needs_ssh_fallback(detail) {
        format!(
            "ssh-keyscan 未返回 host key，ssh.exe fallback 也未能读取临时 known_hosts。原始错误：{detail}"
        )
    } else {
        format!("ssh-keyscan 未返回 host key：{detail}")
    })
}

pub(super) fn ssh_keyscan_needs_ssh_fallback(stderr: &str) -> bool {
    let normalized = stderr.to_ascii_lowercase();
    (normalized.contains("unsupported")
        && (normalized.contains("kex") || normalized.contains("key exchange")))
        || normalized.contains("no matching key exchange method")
        || normalized.contains("no matching kex")
        || (normalized.contains("unable to negotiate") && normalized.contains("key exchange"))
}

pub(super) fn scan_host_keys_with_ssh_fallback(
    app: &AppHandle,
    profile: &Profile,
) -> Result<Vec<String>, String> {
    validate_profile(profile)?;
    let known_hosts = fallback_known_hosts_path(app)?;
    if let Some(parent) = known_hosts.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "创建临时 known_hosts 目录失败 {}：{error}",
                parent.display()
            )
        })?;
    }
    if known_hosts.exists() {
        fs::remove_file(&known_hosts).map_err(|error| {
            format!(
                "删除旧临时 known_hosts 失败 {}：{error}",
                known_hosts.display()
            )
        })?;
    }

    let null_file = platform_null_file();
    let global_known_hosts = format!("GlobalKnownHostsFile={null_file}");
    let user_known_hosts = format!("UserKnownHostsFile={}", known_hosts.display());
    let host_key_alias = format!("HostKeyAlias={}", known_host_marker(profile));
    let connect_timeout = format!("ConnectTimeout={}", profile.connect_timeout_seconds);
    let ssh_port = profile.ssh_port.to_string();
    let ssh_user = profile.ssh_user.trim();
    let ssh_host = profile.ssh_host.trim();
    let output = hidden_command("ssh")
        .args([
            "-F",
            null_file,
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            &global_known_hosts,
            "-o",
            &user_known_hosts,
            "-o",
            &host_key_alias,
            "-o",
            &connect_timeout,
            "-o",
            "PreferredAuthentications=none",
            "-o",
            "NumberOfPasswordPrompts=0",
            "-o",
            "KexAlgorithms=curve25519-sha256,curve25519-sha256@libssh.org,ecdh-sha2-nistp256,diffie-hellman-group14-sha256",
            "-p",
            &ssh_port,
            "-l",
            ssh_user,
            ssh_host,
            "exit",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map_err(|error| format!("启动 ssh.exe fallback 失败：{error}"))?;

    let raw = fs::read_to_string(&known_hosts).map_err(|error| {
        format!(
            "读取 ssh.exe fallback 临时 known_hosts 失败 {}：{error}",
            known_hosts.display()
        )
    })?;
    let _ = fs::remove_file(&known_hosts);
    let host_keys = raw
        .lines()
        .filter_map(|line| ssh_fallback_known_host_line_to_scan_line(profile, line))
        .collect::<Vec<_>>();

    if host_keys.is_empty() {
        return Err(format!(
            "ssh.exe fallback 未写入 host key，退出状态：{}",
            output.status
        ));
    }

    Ok(host_keys)
}

pub(super) fn fallback_known_hosts_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = known_hosts_path(app)?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let sequence = FALLBACK_KNOWN_HOSTS_COUNTER.fetch_add(1, Ordering::Relaxed);
    path.set_file_name(format!("known_hosts.scan.{nanos}.{sequence}.tmp"));
    Ok(path)
}

#[cfg(windows)]
pub(super) fn platform_null_file() -> &'static str {
    "NUL"
}

#[cfg(not(windows))]
pub(super) fn platform_null_file() -> &'static str {
    "/dev/null"
}

#[tauri::command]
pub(super) fn trust_host_keys(
    app: AppHandle,
    state: State<TunnelManager>,
    profile: Profile,
    request: TrustHostKeysRequest,
) -> Result<KnownHostsStatus, String> {
    validate_profile(&profile)?;
    if request.host_keys.is_empty() {
        return Err("没有可写入的 host key".to_string());
    }
    if request.profile_id != profile.id
        || request.host.trim() != profile.ssh_host.trim()
        || request.port != profile.ssh_port
    {
        return Err(
            "Host Key scan result does not match the current profile. Scan again.".to_string(),
        );
    }

    let _store_guard = state
        .store_lock
        .lock()
        .map_err(|_| "known_hosts 存储锁已损坏".to_string())?;
    let marker = known_host_marker(&profile);
    if marker != request.expected_marker {
        return Err(
            "Host Key scan result does not match the current profile. Scan again.".to_string(),
        );
    }
    let normalized_keys = request
        .host_keys
        .iter()
        .filter_map(|line| normalize_host_key_line(&profile, line))
        .collect::<Vec<_>>();
    if normalized_keys.is_empty() {
        return Err("host key 格式不正确".to_string());
    }
    let scanned_keys = normalized_keys
        .iter()
        .filter_map(|line| parse_known_host_key(line))
        .collect::<Vec<_>>();
    let actual_scanned_key_set_id = known_host_key_set_id(&scanned_keys);
    if actual_scanned_key_set_id != request.scanned_key_set_id {
        return Err("Host Key scan result is stale. Scan again.".to_string());
    }

    let path = known_hosts_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建 known_hosts 目录失败 {}：{error}", parent.display()))?;
    }

    let existing_raw = if path.exists() {
        fs::read_to_string(&path)
            .map_err(|error| format!("读取 known_hosts 失败 {}：{error}", path.display()))?
    } else {
        String::new()
    };
    let existing_keys = known_host_keys_for_marker(&existing_raw, &marker);
    let current_existing_key_set_id = known_host_key_set_id(&existing_keys);
    if current_existing_key_set_id != request.expected_existing_key_set_id {
        return Err("known_hosts changed. Scan the host key again.".to_string());
    }
    if !existing_keys.is_empty()
        && current_existing_key_set_id != request.scanned_key_set_id
        && !request.allow_replace
    {
        return Err(
            "This operation would replace a trusted Host Key. Confirm and retry.".to_string(),
        );
    }

    let mut retained_lines = existing_raw
        .lines()
        .filter(|line| !known_host_line_matches_marker(line, &marker))
        .map(ToString::to_string)
        .collect::<Vec<_>>();

    retained_lines.extend(normalized_keys);
    let raw = if retained_lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", retained_lines.join("\n"))
    };
    write_file_replace(&path, &raw)?;

    let status = known_hosts_status(&app, &profile)?;
    push_app_event(
        &app,
        state.inner(),
        if request.allow_replace {
            "WARN"
        } else {
            "INFO"
        },
        "hostKey",
        if request.allow_replace {
            "Host Key 已替换"
        } else {
            "Host Key 已信任"
        },
        if request.allow_replace {
            "已替换该配置的受信任 Host Key。"
        } else {
            "已信任该配置的 Host Key。"
        },
        Some(&profile.id),
    );
    Ok(status)
}
