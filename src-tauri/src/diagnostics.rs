use super::*;

const DIAGNOSTIC_DIR_NAME: &str = "diagnostics";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticManifest {
    schema_version: u16,
    app_name: &'static str,
    app_version: &'static str,
    created_at_ms: u64,
    files: Vec<&'static str>,
    automatic_upload: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticEnvironment {
    os: &'static str,
    arch: &'static str,
    checks: Vec<EnvironmentCheck>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DiagnosticProfilesSummary {
    profile_count: usize,
    profiles: Vec<DiagnosticProfileSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DiagnosticProfileSummary {
    index: usize,
    auth_method: AuthMethod,
    local_proxy_port: u16,
    local_proxy_protocol: ProxyProtocol,
    ssh_port: u16,
    remote_proxy_port: u16,
    reconnect_enabled: bool,
    reconnect_interval_seconds: u16,
    connect_timeout_seconds: u16,
    remember_ssh_password: bool,
    has_private_key_path: bool,
    no_proxy_count: usize,
}

#[tauri::command]
pub(super) fn export_diagnostic_bundle(
    app: AppHandle,
    state: State<TunnelManager>,
) -> Result<DiagnosticBundleResult, String> {
    let result = export_diagnostic_bundle_inner(&app, state.inner());
    match &result {
        Ok(_) => push_app_event(
            &app,
            state.inner(),
            "INFO",
            "diagnostics",
            "诊断包已导出",
            "诊断包已保存到本地，不会自动上传。",
            None,
        ),
        Err(_) => push_app_event(
            &app,
            state.inner(),
            "ERROR",
            "diagnostics",
            "诊断包导出失败",
            "导出失败，请查看运行日志获取详情。",
            None,
        ),
    }
    result
}

pub(super) fn export_diagnostic_bundle_inner(
    app: &AppHandle,
    manager: &TunnelManager,
) -> Result<DiagnosticBundleResult, String> {
    let log_dir = tunnel_log_dir(app)?;
    let diagnostics_dir = log_dir.join(DIAGNOSTIC_DIR_NAME);
    fs::create_dir_all(&diagnostics_dir).map_err(|error| {
        format!(
            "create diagnostics directory failed {}: {error}",
            diagnostics_dir.display()
        )
    })?;

    let bundle_path = unique_diagnostic_bundle_path(&diagnostics_dir);
    let contents = diagnostic_bundle_contents(app, manager)?;
    write_diagnostic_zip(&bundle_path, &contents)?;

    Ok(DiagnosticBundleResult {
        path: bundle_path.display().to_string(),
        directory: diagnostics_dir.display().to_string(),
        detail: format!("诊断包已导出：{}", bundle_path.display()),
    })
}

pub(super) fn diagnostic_bundle_contents(
    app: &AppHandle,
    manager: &TunnelManager,
) -> Result<Vec<(&'static str, String)>, String> {
    let profiles = load_profiles_inner(app)?;
    let manifest = DiagnosticManifest {
        schema_version: 1,
        app_name: "SSHNet Share",
        app_version: env!("CARGO_PKG_VERSION"),
        created_at_ms: current_time_millis(),
        files: vec![
            "manifest.json",
            "environment.json",
            "profiles-summary.json",
            "log-storage.json",
            "logs/redacted.log",
            "README.txt",
        ],
        automatic_upload: false,
    };
    let environment = DiagnosticEnvironment {
        os: env::consts::OS,
        arch: env::consts::ARCH,
        checks: get_environment_status(app.clone())
            .into_iter()
            .map(|mut check| {
                check.detail = redact_common_diagnostic_text(&check.detail);
                check
            })
            .collect(),
    };
    let (total_bytes, file_count) = log_storage_size(&tunnel_log_dir(app)?)?;
    let log_storage = serde_json::json!({
        "logDir": "<app-log-dir>",
        "currentFile": "<current-log-file>",
        "totalBytes": total_bytes,
        "fileCount": file_count,
    });
    let log_lines = collect_diagnostic_log_lines(app, manager)?;
    let redacted_log = if log_lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", log_lines.join("\n"))
    };

    Ok(vec![
        ("manifest.json", pretty_json(&manifest)?),
        ("environment.json", pretty_json(&environment)?),
        (
            "profiles-summary.json",
            pretty_json(&diagnostic_profiles_summary(&profiles))?,
        ),
        ("log-storage.json", pretty_json(&log_storage)?),
        ("logs/redacted.log", redacted_log),
        ("README.txt", diagnostic_readme()),
    ])
}

pub(super) fn diagnostic_profiles_summary(
    profiles: &[Profile],
) -> DiagnosticProfilesSummary {
    DiagnosticProfilesSummary {
        profile_count: profiles.len(),
        profiles: profiles
            .iter()
            .enumerate()
            .map(|(index, profile)| DiagnosticProfileSummary {
                index: index + 1,
                auth_method: profile.auth_method.clone(),
                local_proxy_port: profile.local_proxy_port,
                local_proxy_protocol: profile.local_proxy_protocol.clone(),
                ssh_port: profile.ssh_port,
                remote_proxy_port: profile.remote_proxy_port,
                reconnect_enabled: profile.reconnect_enabled,
                reconnect_interval_seconds: profile.reconnect_interval_seconds,
                connect_timeout_seconds: profile.connect_timeout_seconds,
                remember_ssh_password: profile.remember_ssh_password,
                has_private_key_path: !profile.private_key_path.trim().is_empty(),
                no_proxy_count: profile.no_proxy.len(),
            })
            .collect(),
    }
}

pub(super) fn collect_diagnostic_log_lines(
    app: &AppHandle,
    manager: &TunnelManager,
) -> Result<Vec<String>, String> {
    let mut lines = Vec::new();
    for path in log_files(&tunnel_log_dir(app)?)? {
        let raw = fs::read_to_string(&path)
            .map_err(|error| format!("read log file failed {}: {error}", path.display()))?;
        for line in raw.lines().filter(|line| !line.trim().is_empty()) {
            let output = serde_json::from_str::<TunnelLogEntry>(line)
                .map(normalize_log_entry_level)
                .map(|entry| format_diagnostic_log_entry(&entry))
                .unwrap_or_else(|_| format_diagnostic_legacy_log_line());
            lines.push(output);
        }
    }

    if lines.is_empty() {
        append_memory_diagnostic_log_lines(manager, &mut lines)?;
    }

    Ok(lines)
}

fn append_memory_diagnostic_log_lines(
    manager: &TunnelManager,
    lines: &mut Vec<String>,
) -> Result<(), String> {
    let guard = manager
        .logs
        .buffer
        .lock()
        .map_err(|_| "tunnel log lock is poisoned".to_string())?;
    lines.extend(
        guard
            .entries
            .iter()
            .cloned()
            .map(normalize_log_entry_level)
            .map(|entry| format_diagnostic_log_entry(&entry)),
    );
    Ok(())
}

pub(super) fn format_diagnostic_log_entry(entry: &TunnelLogEntry) -> String {
    format!(
        "{} [{}] source={} profile={} message=<omitted-for-privacy>",
        entry.timestamp_ms,
        normalized_log_level(&entry.level),
        diagnostic_source_label(&entry.source),
        if entry.profile_id.is_some() {
            "linked"
        } else {
            "none"
        }
    )
}

pub(super) fn format_diagnostic_legacy_log_line() -> String {
    "legacy [INFO] source=legacy profile=unknown message=<omitted-for-privacy>".to_string()
}

fn diagnostic_source_label(source: &str) -> &'static str {
    match source {
        "app" => "app",
        "tunnel" => "tunnel",
        "ssh_stdout" => "ssh_stdout",
        "ssh_stderr" => "ssh_stderr",
        _ => "other",
    }
}

pub(super) fn write_diagnostic_zip(
    path: &Path,
    contents: &[(&'static str, String)],
) -> Result<(), String> {
    let file = fs::File::create(path)
        .map_err(|error| format!("create diagnostic zip failed {}: {error}", path.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for (name, content) in contents {
        zip.start_file(*name, options)
            .map_err(|error| format!("write diagnostic zip entry failed {name}: {error}"))?;
        zip.write_all(content.as_bytes())
            .map_err(|error| format!("write diagnostic zip entry failed {name}: {error}"))?;
    }
    zip.finish()
        .map_err(|error| format!("finish diagnostic zip failed {}: {error}", path.display()))?;
    Ok(())
}

pub(super) fn unique_diagnostic_bundle_path(diagnostics_dir: &Path) -> PathBuf {
    let base = current_time_millis();
    for suffix in 0..1000 {
        let name = if suffix == 0 {
            format!("sshnet-diagnostic-{base}.zip")
        } else {
            format!("sshnet-diagnostic-{base}-{suffix}.zip")
        };
        let path = diagnostics_dir.join(name);
        if !path.exists() {
            return path;
        }
    }
    diagnostics_dir.join(format!("sshnet-diagnostic-{}-fallback.zip", current_time_millis()))
}

fn pretty_json<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string_pretty(value).map_err(|error| format!("serialize diagnostic json failed: {error}"))
}

pub(super) fn diagnostic_readme() -> String {
    [
        "SSHNet Share 诊断包 / diagnostic bundle",
        "",
        "此 ZIP 由 SSHNet Share 在本机创建，不会自动上传。",
        "This ZIP was created locally by SSHNet Share and is not uploaded automatically.",
        "",
        "请仅在你决定反馈问题时，手动提交到 GitHub Issue、邮件或维护者指定渠道。",
        "Send it only if you choose to attach it to a GitHub Issue, email, or maintainer-provided support channel.",
        "",
        "包含文件 / Included files:",
        "- manifest.json",
        "- environment.json",
        "- profiles-summary.json",
        "- log-storage.json",
        "- logs/redacted.log",
        "",
        "不会包含 Profile 真实名称、主机、用户、私钥路径、密码、token 或原始日志正文。",
        "Profile host, user, profile name, private key path, passwords, tokens, and raw log message bodies are intentionally excluded.",
    ]
    .join("\n")
}

fn redact_common_diagnostic_text(raw: &str) -> String {
    let mut text = raw.to_string();
    if let Ok(home) = env::var("USERPROFILE") {
        replace_sensitive_value(&mut text, &home, "C:\\Users\\<user>");
    }
    if let Ok(home) = env::var("HOME") {
        replace_sensitive_value(&mut text, &home, "<home>");
    }
    text
}
