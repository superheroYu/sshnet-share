use super::*;

impl RotatingLogWriter {
    fn new(log_dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&log_dir)
            .map_err(|error| format!("创建日志目录失败 {}：{error}", log_dir.display()))?;
        let current_path = log_dir.join(CURRENT_LOG_FILE_NAME);
        let current_bytes = fs::metadata(&current_path)
            .map(|metadata| metadata.len())
            .unwrap_or_default();
        Ok(Self {
            log_dir,
            current_path,
            current_bytes,
        })
    }

    fn append(&mut self, entry: &TunnelLogEntry) -> Result<(), String> {
        let mut line =
            serde_json::to_string(entry).map_err(|error| format!("序列化日志失败：{error}"))?;
        line.push('\n');
        let bytes = line.as_bytes();
        if self.current_bytes > 0
            && self.current_bytes + bytes.len() as u64 > MAX_TUNNEL_LOG_FILE_BYTES
        {
            self.rotate()?;
        }

        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.current_path)
            .map_err(|error| {
                format!("打开日志文件失败 {}：{error}", self.current_path.display())
            })?;
        file.write_all(bytes).map_err(|error| {
            format!("写入日志文件失败 {}：{error}", self.current_path.display())
        })?;
        self.current_bytes += bytes.len() as u64;
        Ok(())
    }

    fn rotate(&mut self) -> Result<(), String> {
        if self.current_path.exists() {
            let archive_path = unique_log_archive_path(&self.log_dir);
            fs::rename(&self.current_path, &archive_path).map_err(|error| {
                format!(
                    "轮转日志文件失败 {} -> {}：{error}",
                    self.current_path.display(),
                    archive_path.display()
                )
            })?;
        }
        self.current_bytes = 0;
        prune_log_archives(&self.log_dir)?;
        Ok(())
    }
}

pub(super) fn initialize_tunnel_logs(
    app: &AppHandle,
    manager: &TunnelManager,
) -> Result<(), String> {
    let writer = RotatingLogWriter::new(tunnel_log_dir(app)?)?;
    let mut guard = manager
        .logs
        .writer
        .lock()
        .map_err(|_| "日志写入器锁已损坏".to_string())?;
    *guard = Some(writer);
    drop(guard);
    push_tunnel_log_with_source(
        app,
        &manager.logs,
        "INFO",
        "app",
        None,
        "SSHNet Share started",
    );
    Ok(())
}

pub(super) fn current_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or_default()
}

pub(super) fn normalized_log_level(level: &str) -> &'static str {
    match level.to_ascii_uppercase().as_str() {
        "ERROR" => "ERROR",
        "WARN" | "WARNING" => "WARN",
        _ => "INFO",
    }
}

pub(super) fn tunnel_log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|error| format!("定位日志目录失败：{error}"))?
        .join(LOG_DIR_NAME))
}

pub(super) fn unique_log_archive_path(log_dir: &Path) -> PathBuf {
    let base = current_time_millis();
    for suffix in 0..1000 {
        let name = if suffix == 0 {
            format!("sshnet-{base}.jsonl")
        } else {
            format!("sshnet-{base}-{suffix}.jsonl")
        };
        let path = log_dir.join(name);
        if !path.exists() {
            return path;
        }
    }
    log_dir.join(format!("sshnet-{}-fallback.jsonl", current_time_millis()))
}

pub(super) fn log_files(log_dir: &Path) -> Result<Vec<PathBuf>, String> {
    if !log_dir.exists() {
        return Ok(Vec::new());
    }
    let mut rotated = Vec::new();
    let current = log_dir.join(CURRENT_LOG_FILE_NAME);
    for entry in fs::read_dir(log_dir)
        .map_err(|error| format!("读取日志目录失败 {}：{error}", log_dir.display()))?
    {
        let path = entry
            .map_err(|error| format!("读取日志目录项失败：{error}"))?
            .path();
        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if file_name.starts_with("sshnet-") && file_name.ends_with(".jsonl") {
            rotated.push(path);
        }
    }
    rotated.sort();
    if current.exists() {
        rotated.push(current);
    }
    Ok(rotated)
}

pub(super) fn prune_log_archives(log_dir: &Path) -> Result<(), String> {
    let mut archives = fs::read_dir(log_dir)
        .map_err(|error| format!("读取日志目录失败 {}：{error}", log_dir.display()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|name| name.starts_with("sshnet-") && name.ends_with(".jsonl"))
        })
        .collect::<Vec<_>>();
    archives.sort();
    let delete_count = archives.len().saturating_sub(MAX_TUNNEL_LOG_ARCHIVES);
    for path in archives.into_iter().take(delete_count) {
        fs::remove_file(&path)
            .map_err(|error| format!("删除旧日志文件失败 {}：{error}", path.display()))?;
    }
    Ok(())
}

pub(super) fn export_tunnel_logs_inner(
    app: &AppHandle,
    manager: &TunnelManager,
    filter: Option<&LogExportFilter>,
) -> Result<LogExportResult, String> {
    let log_dir = tunnel_log_dir(app)?;
    fs::create_dir_all(&log_dir)
        .map_err(|error| format!("创建日志目录失败 {}：{error}", log_dir.display()))?;
    let exports_dir = log_dir.join(EXPORT_LOG_DIR_NAME);
    fs::create_dir_all(&exports_dir)
        .map_err(|error| format!("创建日志导出目录失败 {}：{error}", exports_dir.display()))?;

    let (exported_lines, redaction_count) = collect_redacted_log_lines(app, manager, filter)?;

    let export_path = exports_dir.join(format!(
        "sshnet-logs-redacted-{}.log",
        current_time_millis()
    ));
    let raw = if exported_lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", exported_lines.join("\n"))
    };
    fs::write(&export_path, raw)
        .map_err(|error| format!("写入日志导出文件失败 {}：{error}", export_path.display()))?;

    Ok(LogExportResult {
        path: export_path.display().to_string(),
        directory: exports_dir.display().to_string(),
        line_count: exported_lines.len(),
        redaction_count,
        detail: format!(
            "已导出 {} 行日志，脱敏 {} 处。",
            exported_lines.len(),
            redaction_count
        ),
    })
}

pub(super) fn preview_tunnel_logs_inner(
    app: &AppHandle,
    manager: &TunnelManager,
    filter: Option<&LogExportFilter>,
    limit: usize,
) -> Result<LogPreviewResult, String> {
    let (exported_lines, redaction_count) = collect_redacted_log_lines(app, manager, filter)?;
    let limit = limit.clamp(1, 200);
    let skip_count = exported_lines.len().saturating_sub(limit);
    Ok(LogPreviewResult {
        line_count: exported_lines.len(),
        redaction_count,
        preview_lines: exported_lines.into_iter().skip(skip_count).collect(),
    })
}

pub(super) fn collect_redacted_log_lines(
    app: &AppHandle,
    manager: &TunnelManager,
    filter: Option<&LogExportFilter>,
) -> Result<(Vec<String>, usize), String> {
    let log_dir = tunnel_log_dir(app)?;
    let profiles = load_profiles_inner(app)?;
    let mut exported_lines = Vec::new();
    let mut redaction_count = 0_usize;

    for path in log_files(&log_dir)? {
        let raw = fs::read_to_string(&path)
            .map_err(|error| format!("读取日志文件失败 {}：{error}", path.display()))?;
        for line in raw.lines().filter(|line| !line.trim().is_empty()) {
            let Some(formatted) = format_log_export_line(line, filter) else {
                continue;
            };
            let (redacted, count) = redact_log_line(&formatted, &profiles);
            exported_lines.push(redacted);
            redaction_count += count;
        }
    }

    if exported_lines.is_empty() {
        append_memory_logs_for_export(
            manager,
            filter,
            &profiles,
            &mut exported_lines,
            &mut redaction_count,
        )?;
    }

    Ok((exported_lines, redaction_count))
}

pub(super) fn append_memory_logs_for_export(
    manager: &TunnelManager,
    filter: Option<&LogExportFilter>,
    profiles: &[Profile],
    exported_lines: &mut Vec<String>,
    redaction_count: &mut usize,
) -> Result<(), String> {
    let guard = manager
        .logs
        .buffer
        .lock()
        .map_err(|_| "隧道日志锁已损坏".to_string())?;
    for entry in &guard.entries {
        let entry = normalize_log_entry_level(entry.clone());
        if !log_entry_matches_filter(&entry, filter) {
            continue;
        }
        let formatted = format_log_entry_for_export(&entry);
        let (redacted, count) = redact_log_line(&formatted, profiles);
        exported_lines.push(redacted);
        *redaction_count += count;
    }
    Ok(())
}

pub(super) fn format_log_export_line(
    raw: &str,
    filter: Option<&LogExportFilter>,
) -> Option<String> {
    serde_json::from_str::<TunnelLogEntry>(raw)
        .map(|entry| {
            let entry = normalize_log_entry_level(entry);
            log_entry_matches_filter(&entry, filter).then(|| format_log_entry_for_export(&entry))
        })
        .unwrap_or_else(|_| legacy_log_line_matches_filter(filter).then(|| raw.to_string()))
}

pub(super) fn legacy_log_line_matches_filter(filter: Option<&LogExportFilter>) -> bool {
    let Some(filter) = filter else {
        return true;
    };
    let has_profile = filter
        .profile_id
        .as_deref()
        .is_some_and(|profile_id| !profile_id.trim().is_empty());
    let has_source = filter
        .source
        .as_deref()
        .is_some_and(|source| !source.trim().is_empty());
    let has_date_range = filter.from_timestamp_ms.is_some() || filter.to_timestamp_ms.is_some();
    if has_profile || has_source || has_date_range {
        return false;
    }

    let levels = filter
        .levels
        .iter()
        .map(|level| normalized_log_level(level))
        .collect::<HashSet<_>>();
    levels.is_empty()
        || ["INFO", "WARN", "ERROR"]
            .iter()
            .all(|level| levels.contains(level))
}

pub(super) fn log_entry_matches_filter(
    entry: &TunnelLogEntry,
    filter: Option<&LogExportFilter>,
) -> bool {
    let Some(filter) = filter else {
        return true;
    };
    let levels = filter
        .levels
        .iter()
        .map(|level| normalized_log_level(level))
        .collect::<HashSet<_>>();
    let level_matches = levels.is_empty() || levels.contains(normalized_log_level(&entry.level));
    let profile_matches = filter
        .profile_id
        .as_deref()
        .filter(|profile_id| !profile_id.trim().is_empty())
        .map(|profile_id| entry.profile_id.as_deref() == Some(profile_id))
        .unwrap_or(true);
    let source_matches = filter
        .source
        .as_deref()
        .filter(|source| !source.trim().is_empty())
        .map(|source| entry.source == source)
        .unwrap_or(true);
    let from_matches = filter
        .from_timestamp_ms
        .map(|from| entry.timestamp_ms >= from)
        .unwrap_or(true);
    let to_matches = filter
        .to_timestamp_ms
        .map(|to| entry.timestamp_ms <= to)
        .unwrap_or(true);
    level_matches && profile_matches && source_matches && from_matches && to_matches
}

pub(super) fn format_log_entry_for_export(entry: &TunnelLogEntry) -> String {
    let profile = entry
        .profile_id
        .as_deref()
        .map(|profile_id| format!(" profile={profile_id}"))
        .unwrap_or_default();
    format!(
        "{} [{}] {}{} {}",
        entry.timestamp_ms, entry.level, entry.source, profile, entry.message
    )
}

pub(super) fn normalize_log_entry_level(mut entry: TunnelLogEntry) -> TunnelLogEntry {
    if entry.source == "ssh_stderr"
        && entry.level == "ERROR"
        && is_ssh_stderr_info_line(&entry.message)
    {
        entry.level = "INFO".to_string();
    }
    entry
}

pub(super) fn redact_log_line(raw: &str, profiles: &[Profile]) -> (String, usize) {
    let mut line = raw.to_string();
    let mut count = 0_usize;

    for profile in profiles {
        count += replace_sensitive_value(&mut line, &profile.private_key_path, "<ssh-key-path>");
        count += replace_sensitive_value(&mut line, &profile.ssh_host, "<ssh-host>");
        count += replace_sensitive_value(&mut line, &profile.ssh_user, "<ssh-user>");
        count += replace_sensitive_value(&mut line, &profile.name, "<profile-name>");
    }
    if let Ok(home) = env::var("USERPROFILE") {
        count += replace_sensitive_value(&mut line, &home, "C:\\Users\\<user>");
    }
    if let Ok(home) = env::var("HOME") {
        count += replace_sensitive_value(&mut line, &home, "<home>");
    }
    count += redact_prefixed_token(&mut line, "SHA256:", "<host-key-fingerprint>");
    count += redact_header_value(&mut line, "Authorization: ", "Authorization: <secret>");
    count += redact_prefixed_token(&mut line, "Bearer ", "Bearer <token>");
    count += redact_after_prefix_to_eol(&mut line, "Password:", " <redacted>");
    count += redact_after_prefix_to_eol(&mut line, "password:", " <redacted>");
    count += redact_after_prefix_to_eol(&mut line, "Enter passphrase", " <redacted>");

    (line, count)
}

pub(super) fn redact_after_prefix_to_eol(
    line: &mut String,
    prefix: &str,
    replacement: &str,
) -> usize {
    let mut output = String::with_capacity(line.len());
    let mut remaining = line.as_str();
    let mut count = 0_usize;

    while let Some(index) = remaining.find(prefix) {
        output.push_str(&remaining[..index]);
        output.push_str(prefix);
        output.push_str(replacement);
        let after_prefix = &remaining[index + prefix.len()..];
        let stop = after_prefix.find('\n').unwrap_or(after_prefix.len());
        remaining = &after_prefix[stop..];
        count += 1;
    }

    if count > 0 {
        output.push_str(remaining);
        *line = output;
    }
    count
}

pub(super) fn replace_sensitive_value(line: &mut String, value: &str, replacement: &str) -> usize {
    let value = value.trim();
    if value.len() < 3
        || matches!(
            value.to_ascii_lowercase().as_str(),
            "localhost" | "127.0.0.1" | "::1" | "http" | "socks5"
        )
    {
        return 0;
    }
    let count = line.matches(value).count();
    if count > 0 {
        *line = line.replace(value, replacement);
    }
    count
}

pub(super) fn redact_prefixed_token(line: &mut String, prefix: &str, replacement: &str) -> usize {
    let mut output = String::with_capacity(line.len());
    let mut remaining = line.as_str();
    let mut count = 0_usize;

    while let Some(index) = remaining.find(prefix) {
        output.push_str(&remaining[..index]);
        output.push_str(replacement);
        let after_prefix = &remaining[index + prefix.len()..];
        let token_end = after_prefix
            .find(|ch: char| ch.is_whitespace() || matches!(ch, '"' | '\'' | ',' | ';' | ')'))
            .unwrap_or(after_prefix.len());
        remaining = &after_prefix[token_end..];
        count += 1;
    }

    if count > 0 {
        output.push_str(remaining);
        *line = output;
    }
    count
}

pub(super) fn redact_header_value(line: &mut String, prefix: &str, replacement: &str) -> usize {
    let mut output = String::with_capacity(line.len());
    let mut remaining = line.as_str();
    let mut count = 0_usize;

    while let Some(index) = remaining.find(prefix) {
        output.push_str(&remaining[..index]);
        output.push_str(replacement);
        let after_prefix = &remaining[index + prefix.len()..];
        let value_end = after_prefix
            .find(['"', '\'', ',', ';', ')'])
            .unwrap_or(after_prefix.len());
        remaining = &after_prefix[value_end..];
        count += 1;
    }

    if count > 0 {
        output.push_str(remaining);
        *line = output;
    }
    count
}

pub(super) fn push_tunnel_log(
    app: &AppHandle,
    logs: &Arc<TunnelLogStore>,
    level: &str,
    profile_id: Option<&str>,
    message: &str,
) {
    push_tunnel_log_with_source(app, logs, level, "tunnel", profile_id, message);
}

pub(super) fn push_tunnel_log_with_source(
    app: &AppHandle,
    logs: &Arc<TunnelLogStore>,
    level: &str,
    source: &str,
    profile_id: Option<&str>,
    message: &str,
) {
    let Some(entry) = push_tunnel_log_with_source_to_store(logs, level, source, profile_id, message)
    else {
        return;
    };
    let _ = app.emit(LOG_ENTRY_EVENT, entry);
}

pub(super) fn push_tunnel_log_with_source_to_store(
    logs: &Arc<TunnelLogStore>,
    level: &str,
    source: &str,
    profile_id: Option<&str>,
    message: &str,
) -> Option<TunnelLogEntry> {
    let Ok(mut guard) = logs.buffer.lock() else {
        return None;
    };
    let id = guard.next_id;
    guard.next_id += 1;
    let entry = TunnelLogEntry {
        id,
        timestamp_ms: current_time_millis(),
        level: normalized_log_level(level).to_string(),
        source: source.to_string(),
        profile_id: profile_id.map(ToString::to_string),
        message: message.trim().to_string(),
    };
    guard.entries.push_back(entry.clone());
    while guard.entries.len() > MAX_TUNNEL_LOG_ENTRIES {
        guard.entries.pop_front();
    }
    drop(guard);

    let Ok(mut writer_guard) = logs.writer.lock() else {
        return Some(entry);
    };
    if let Some(writer) = writer_guard.as_mut() {
        let _ = writer.append(&entry);
    }
    Some(entry)
}

pub(super) fn spawn_output_reader<R>(
    app: AppHandle,
    logs: Arc<TunnelLogStore>,
    profile_id: Option<String>,
    level: &'static str,
    stream: R,
    startup_sender: Option<mpsc::Sender<String>>,
) where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines().map_while(Result::ok) {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                if let Some(sender) = startup_sender.as_ref() {
                    let _ = sender.send(trimmed.to_string());
                }
                if is_ssh_verbose_noise(trimmed) {
                    continue;
                }
                let source = if level == "ERROR" {
                    "ssh_stderr"
                } else {
                    "ssh_stdout"
                };
                push_tunnel_log_with_source(
                    &app,
                    &logs,
                    ssh_output_log_level(level, trimmed),
                    source,
                    profile_id.as_deref(),
                    trimmed,
                );
            }
        }
    });
}

pub(super) fn ssh_output_log_level(default_level: &'static str, line: &str) -> &'static str {
    if default_level != "ERROR" {
        return default_level;
    }

    if ssh_startup_signal(line).is_some() || is_ssh_stderr_info_line(line) {
        "INFO"
    } else {
        default_level
    }
}

pub(super) fn is_ssh_verbose_noise(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.starts_with("debug1:") || lower.starts_with("debug2:") || lower.starts_with("debug3:")
}

pub(super) fn is_ssh_stderr_info_line(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed.starts_with("OpenSSH_") || trimmed.starts_with("OpenSSH-for")
}

pub(super) fn tunnel_log_tail(
    logs: &Arc<TunnelLogStore>,
    profile_id: Option<&str>,
    max_lines: usize,
) -> Vec<String> {
    let Ok(guard) = logs.buffer.lock() else {
        return Vec::new();
    };
    let mut lines = guard
        .entries
        .iter()
        .rev()
        .filter(|entry| {
            profile_id
                .map(|profile_id| entry.profile_id.as_deref() == Some(profile_id))
                .unwrap_or(true)
        })
        .take(max_lines)
        .map(|entry| format!("[{}] {}", entry.level, entry.message))
        .collect::<Vec<_>>();
    lines.reverse();
    lines
}

pub(super) fn log_storage_size(log_dir: &Path) -> Result<(u64, usize), String> {
    if !log_dir.exists() {
        return Ok((0, 0));
    }

    fn visit(path: &Path, total_bytes: &mut u64, file_count: &mut usize) -> Result<(), String> {
        for entry in fs::read_dir(path)
            .map_err(|error| format!("读取日志目录失败 {}：{error}", path.display()))?
        {
            let path = entry
                .map_err(|error| format!("读取日志目录项失败：{error}"))?
                .path();
            let metadata =
                fs::metadata(&path).map_err(|error| format!("读取日志文件信息失败：{error}"))?;
            if metadata.is_dir() {
                visit(&path, total_bytes, file_count)?;
            } else if metadata.is_file() {
                *total_bytes += metadata.len();
                *file_count += 1;
            }
        }
        Ok(())
    }

    let mut total_bytes = 0;
    let mut file_count = 0;
    visit(log_dir, &mut total_bytes, &mut file_count)?;
    Ok((total_bytes, file_count))
}
