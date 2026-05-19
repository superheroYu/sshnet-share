use super::*;

#[tauri::command]
pub(super) fn get_tunnel_logs(state: State<TunnelManager>) -> Result<Vec<TunnelLogEntry>, String> {
    let guard = state
        .logs
        .buffer
        .lock()
        .map_err(|_| "隧道日志锁已损坏".to_string())?;
    Ok(guard
        .entries
        .iter()
        .cloned()
        .map(normalize_log_entry_level)
        .collect())
}

#[tauri::command]
pub(super) fn clear_tunnel_logs(state: State<TunnelManager>) -> Result<(), String> {
    let mut guard = state
        .logs
        .buffer
        .lock()
        .map_err(|_| "隧道日志锁已损坏".to_string())?;
    guard.entries.clear();
    Ok(())
}

#[tauri::command]
pub(super) fn append_app_log(
    app: AppHandle,
    state: State<TunnelManager>,
    level: String,
    message: String,
) -> Result<(), String> {
    push_tunnel_log_with_source(&app, &state.logs, &level, "app", None, &message);
    Ok(())
}

#[tauri::command]
pub(super) fn export_tunnel_logs(
    app: AppHandle,
    state: State<TunnelManager>,
    filter: Option<LogExportFilter>,
) -> Result<LogExportResult, String> {
    let result = export_tunnel_logs_inner(&app, state.inner(), filter.as_ref());
    match &result {
        Ok(export) => push_app_event(
            &app,
            state.inner(),
            "INFO",
            "logs",
            "日志已导出",
            &format!(
                "已导出 {} 行日志，脱敏 {} 处。",
                export.line_count, export.redaction_count
            ),
            None,
        ),
        Err(_) => push_app_event(
            &app,
            state.inner(),
            "ERROR",
            "logs",
            "日志导出失败",
            "导出失败，请查看运行日志获取详情。",
            None,
        ),
    }
    result
}

#[tauri::command]
pub(super) fn preview_tunnel_logs(
    app: AppHandle,
    state: State<TunnelManager>,
    filter: Option<LogExportFilter>,
    limit: Option<usize>,
) -> Result<LogPreviewResult, String> {
    preview_tunnel_logs_inner(&app, state.inner(), filter.as_ref(), limit.unwrap_or(40))
}

#[tauri::command]
pub(super) fn get_log_storage_info(app: AppHandle) -> Result<LogStorageInfo, String> {
    let log_dir = tunnel_log_dir(&app)?;
    let current_file = log_dir.join(CURRENT_LOG_FILE_NAME);
    let (total_bytes, file_count) = log_storage_size(&log_dir)?;

    Ok(LogStorageInfo {
        log_dir: log_dir.display().to_string(),
        current_file: current_file.display().to_string(),
        total_bytes,
        file_count,
    })
}
