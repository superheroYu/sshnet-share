use super::*;

pub(super) fn known_host_marker(profile: &Profile) -> String {
    host_key_alias(profile)
}

pub(super) fn normalize_host_key_line(profile: &Profile, line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }

    let mut parts = trimmed.split_whitespace();
    let host = parts.next()?;
    if !ssh_keyscan_host_matches_profile(host, profile) {
        return None;
    }
    let algorithm = parts.next()?;
    let key = parts.next()?;
    if !algorithm.starts_with("ssh-") && !algorithm.starts_with("ecdsa-") {
        return None;
    }

    Some(format!(
        "{} {} {}",
        known_host_marker(profile),
        algorithm,
        key
    ))
}

pub(super) fn ssh_keyscan_host_matches_profile(hosts: &str, profile: &Profile) -> bool {
    hosts
        .split(',')
        .any(|host| ssh_keyscan_single_host_matches_profile(host, profile))
}

pub(super) fn ssh_keyscan_single_host_matches_profile(host: &str, profile: &Profile) -> bool {
    host.eq_ignore_ascii_case(&ssh_keyscan_profile_host_token(profile))
}

pub(super) fn ssh_keyscan_profile_host_token(profile: &Profile) -> String {
    let expected_host = profile.ssh_host.trim();
    if profile.ssh_port == 22 {
        expected_host.to_string()
    } else {
        format!("[{expected_host}]:{}", profile.ssh_port)
    }
}

pub(super) fn ssh_fallback_known_host_line_to_scan_line(
    profile: &Profile,
    line: &str,
) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }

    let mut parts = trimmed.split_whitespace();
    let host = parts.next()?;
    if host != known_host_marker(profile) {
        return None;
    }
    let algorithm = parts.next()?;
    let key = parts.next()?;
    if !algorithm.starts_with("ssh-") && !algorithm.starts_with("ecdsa-") {
        return None;
    }

    Some(format!(
        "{} {} {}",
        ssh_keyscan_profile_host_token(profile),
        algorithm,
        key
    ))
}

pub(super) fn known_host_line_matches_marker(line: &str, marker: &str) -> bool {
    line.split_whitespace()
        .next()
        .map(|hosts| hosts.split(',').any(|host| host == marker))
        .unwrap_or(false)
}

pub(super) fn existing_known_host_keys(
    app: &AppHandle,
    marker: &str,
) -> Result<Vec<KnownHostKeyInfo>, String> {
    let path = known_hosts_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("读取 known_hosts 失败 {}：{error}", path.display()))?;
    Ok(known_host_keys_for_marker(&raw, marker))
}

pub(super) fn known_host_keys_for_marker(raw: &str, marker: &str) -> Vec<KnownHostKeyInfo> {
    raw.lines()
        .filter(|line| known_host_line_matches_marker(line, marker))
        .filter_map(parse_known_host_key)
        .collect()
}

pub(super) fn known_host_key_set_id(keys: &[KnownHostKeyInfo]) -> String {
    if keys.is_empty() {
        return "empty".to_string();
    }

    let mut key_ids = keys
        .iter()
        .map(|key| key.key_id.as_str())
        .collect::<Vec<_>>();
    key_ids.sort_unstable();
    key_ids.dedup();

    let digest = Sha256::digest(key_ids.join("\n").as_bytes());
    format!("SHA256:{}", general_purpose::STANDARD_NO_PAD.encode(digest))
}

pub(super) fn known_host_trust_action(
    existing_keys: &[KnownHostKeyInfo],
    existing_key_set_id: &str,
    scanned_key_set_id: &str,
) -> &'static str {
    if existing_keys.is_empty() {
        "new"
    } else if existing_key_set_id == scanned_key_set_id {
        "unchanged"
    } else {
        "replace"
    }
}

pub(super) fn parse_known_host_key(line: &str) -> Option<KnownHostKeyInfo> {
    let mut parts = line.split_whitespace();
    let host = parts.next()?.to_string();
    let algorithm = parts.next()?.to_string();
    let key = parts.next()?;
    let decoded = general_purpose::STANDARD
        .decode(key)
        .or_else(|_| general_purpose::STANDARD_NO_PAD.decode(key))
        .ok()?;
    let digest = Sha256::digest(decoded);
    let fingerprint = format!("SHA256:{}", general_purpose::STANDARD_NO_PAD.encode(digest));
    let key_id = format!("{algorithm}:{fingerprint}");

    Some(KnownHostKeyInfo {
        host,
        algorithm,
        fingerprint,
        key_id,
    })
}

pub(super) fn write_file_replace(path: &Path, raw: &str) -> Result<(), String> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("sshnet-store");
    let tmp_path = path.with_file_name(format!("{file_name}.tmp"));
    let backup_path = path.with_file_name(format!("{file_name}.bak"));

    fs::write(&tmp_path, raw)
        .map_err(|error| format!("写入临时文件失败 {}：{error}", tmp_path.display()))?;

    if path.exists() {
        if backup_path.exists() {
            fs::remove_file(&backup_path)
                .map_err(|error| format!("删除旧备份失败 {}：{error}", backup_path.display()))?;
        }
        fs::rename(path, &backup_path).map_err(|error| {
            format!(
                "备份旧文件失败 {} -> {}：{error}",
                path.display(),
                backup_path.display()
            )
        })?;
    }

    if let Err(error) = fs::rename(&tmp_path, path) {
        if backup_path.exists() {
            let _ = fs::rename(&backup_path, path);
        }
        return Err(format!(
            "保存文件失败 {} -> {}：{error}",
            tmp_path.display(),
            path.display()
        ));
    }

    if backup_path.exists() {
        let _ = fs::remove_file(&backup_path);
    }

    Ok(())
}
