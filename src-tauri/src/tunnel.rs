use super::*;

#[tauri::command]
pub(super) fn start_tunnel(
    app: AppHandle,
    state: State<TunnelManager>,
    profile: Profile,
    auth_secret: Option<String>,
) -> Result<TunnelStatus, String> {
    let profile_id = profile.id.clone();
    let result = start_tunnel_inner(&app, state.inner(), profile, auth_secret, None);
    if result.is_err() {
        push_app_event(
            &app,
            state.inner(),
            "ERROR",
            "tunnel",
            "隧道启动失败",
            "启动失败，请查看运行日志获取详情。",
            Some(&profile_id),
        );
        emit_status_changed(
            &app,
            &profile_id,
            &TunnelStatus {
                status: "failed",
                detail: "start failed; check runtime logs for details".to_string(),
                pid: None,
                last_connected_at: None,
            },
        );
    }
    result
}

pub(super) fn emit_status_changed(app: &AppHandle, profile_id: &str, status: &TunnelStatus) {
    let _ = app.emit(
        STATUS_CHANGED_EVENT,
        TunnelStatusChangedEvent {
            profile_id: profile_id.to_string(),
            status: status.clone(),
        },
    );
}

pub(super) fn start_tunnel_inner(
    app: &AppHandle,
    manager: &TunnelManager,
    profile: Profile,
    auth_secret: Option<String>,
    reconnect_generation: Option<u64>,
) -> Result<TunnelStatus, String> {
    let _lifecycle_guard = manager
        .lifecycle
        .lock()
        .map_err(|_| "隧道生命周期锁已损坏".to_string())?;
    let mut profile = profile;
    validate_profile(&profile)?;
    if let Some(expected_generation) = reconnect_generation {
        prepare_reconnect_start(app, manager, &mut profile, expected_generation)?;
    } else {
        cancel_reconnect_for_profile(manager, &profile.id)?;
    }

    if let Some(status) = current_running_tunnel_status(manager, &profile.id)? {
        emit_status_changed(app, &profile.id, &status);
        return Ok(status);
    }

    let resolved_auth_secret = resolve_auth_secret(&profile, auth_secret.as_deref())?;
    let resolved_auth_secret_ref = resolved_auth_secret.as_ref().map(|secret| secret.as_str());
    validate_auth_secret(&profile, resolved_auth_secret_ref)?;

    let known_hosts = known_hosts_path(app)?;
    let host_status = known_hosts_status(app, &profile)?;
    if host_status.status != "trusted" {
        return Err("尚未信任 SSH Host Key，请先扫描并确认服务器指纹。".to_string());
    }

    let effective_profile = resolve_local_proxy_for_tunnel(&profile)?;

    push_tunnel_log(
        app,
        &manager.logs,
        "INFO",
        Some(&profile.id),
        &format!("{} 正在启动 ssh.exe 反向隧道", profile.name),
    );
    if effective_profile.local_proxy_port != profile.local_proxy_port
        || effective_profile.local_proxy_protocol != profile.local_proxy_protocol
    {
        push_tunnel_log(
            app,
            &manager.logs,
            "INFO",
            Some(&profile.id),
            &format!(
                "{} 已自动采用本地代理 127.0.0.1:{} ({:?})",
                profile.name,
                effective_profile.local_proxy_port,
                effective_profile.local_proxy_protocol
            ),
        );
    }
    let args = build_ssh_args(&effective_profile, &known_hosts);
    let mut command = hidden_command("ssh");
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_ssh_auth(&mut command, &effective_profile, resolved_auth_secret_ref)?;
    let child = command
        .spawn()
        .map_err(|error| format!("启动 ssh.exe 失败：{error}"))?;
    let mut managed_child = ManagedChild::new(child, effective_profile.clone())?;
    let password_auth = matches!(effective_profile.auth_method, AuthMethod::Password);
    let (startup_sender, startup_receiver) = if password_auth {
        let (sender, receiver) = mpsc::channel();
        (Some(sender), Some(receiver))
    } else {
        (None, None)
    };

    if let Some(stdout) = managed_child.child.stdout.take() {
        spawn_output_reader(
            app.clone(),
            manager.logs.clone(),
            Some(profile.id.clone()),
            "INFO",
            stdout,
            startup_sender.clone(),
        );
    }
    if let Some(stderr) = managed_child.child.stderr.take() {
        spawn_output_reader(
            app.clone(),
            manager.logs.clone(),
            Some(profile.id.clone()),
            "ERROR",
            stderr,
            startup_sender.clone(),
        );
    }

    let startup_check_until = Instant::now() + ssh_startup_check_duration(&effective_profile);
    let mut startup_signal = None;
    loop {
        if let Some(exit_status) = managed_child
            .try_wait()
            .map_err(|error| format!("读取 ssh.exe 状态失败：{error}"))?
        {
            thread::sleep(SSH_OUTPUT_FLUSH_DELAY);
            let recent_logs = tunnel_log_tail(&manager.logs, Some(&profile.id), 4);
            let detail = ssh_start_failure_detail(exit_status, &recent_logs);
            forget_saved_password_after_auth_failure(
                app,
                &effective_profile,
                &recent_logs,
                manager,
            );
            push_tunnel_log(app, &manager.logs, "ERROR", Some(&profile.id), &detail);
            return Err(detail);
        }

        if let Some(receiver) = startup_receiver.as_ref() {
            if let Some(signal) = drain_ssh_startup_signals(receiver) {
                startup_signal = Some(signal);
                if signal == SshStartupSignal::RemoteForwardReady {
                    break;
                }
            }
        }

        if Instant::now() >= startup_check_until {
            if password_auth {
                let _ = managed_child.kill();
                let _ = managed_child.wait();
                thread::sleep(SSH_OUTPUT_FLUSH_DELAY);
                let recent_logs = tunnel_log_tail(&manager.logs, Some(&profile.id), 4);
                let detail = ssh_password_startup_timeout_detail(
                    &effective_profile,
                    &recent_logs,
                    startup_signal,
                );
                forget_saved_password_after_auth_failure(
                    app,
                    &effective_profile,
                    &recent_logs,
                    manager,
                );
                push_tunnel_log(app, &manager.logs, "ERROR", Some(&profile.id), &detail);
                return Err(detail);
            }
            break;
        }
        thread::sleep(SSH_STARTUP_CHECK_INTERVAL);
    }

    if let Some(exit_status) = managed_child
        .try_wait()
        .map_err(|error| format!("读取 ssh.exe 状态失败：{error}"))?
    {
        thread::sleep(SSH_OUTPUT_FLUSH_DELAY);
        let recent_logs = tunnel_log_tail(&manager.logs, Some(&profile.id), 4);
        let detail = ssh_start_failure_detail(exit_status, &recent_logs);
        forget_saved_password_after_auth_failure(app, &effective_profile, &recent_logs, manager);
        push_tunnel_log(app, &manager.logs, "ERROR", Some(&profile.id), &detail);
        return Err(detail);
    }

    let pid = managed_child.id();
    let last_connected_at = current_time_millis();
    managed_child.last_connected_at = Some(last_connected_at);
    managed_child.profile.last_connected_at = Some(last_connected_at);
    if let Err(error) =
        record_profile_last_connected_at(app, manager, &profile.id, last_connected_at)
    {
        push_tunnel_log(
            app,
            &manager.logs,
            "WARN",
            Some(&profile.id),
            &format!("记录最后一次连接时间失败：{error}"),
        );
    }
    {
        let mut guard = manager
            .children
            .lock()
            .map_err(|_| "隧道状态锁已损坏".to_string())?;
        guard.insert(profile.id.clone(), managed_child);
    }
    if matches!(effective_profile.auth_method, AuthMethod::Password)
        && effective_profile.remember_ssh_password
    {
        if let Some(password) = resolved_auth_secret_ref {
            if let Err(error) = save_saved_ssh_password(&effective_profile, password) {
                push_tunnel_log(
                    app,
                    &manager.logs,
                    "WARN",
                    Some(&profile.id),
                    &format!("SSH 密码保存失败：{error}"),
                );
            }
        }
    }
    push_tunnel_log(
        app,
        &manager.logs,
        "INFO",
        Some(&profile.id),
        &format!("{} SSH 反向隧道已启动，pid={pid}", profile.name),
    );

    let status = TunnelStatus {
        status: "running",
        detail: format!("{} SSH 反向隧道已启动。", profile.name),
        pid: Some(pid),
        last_connected_at: Some(last_connected_at),
    };
    emit_status_changed(app, &profile.id, &status);
    Ok(status)
}

pub(super) fn current_running_tunnel_status(
    manager: &TunnelManager,
    profile_id: &str,
) -> Result<Option<TunnelStatus>, String> {
    let mut guard = manager
        .children
        .lock()
        .map_err(|_| "隧道状态锁已损坏".to_string())?;

    if let Some(child) = guard.get_mut(profile_id) {
        if child
            .try_wait()
            .map_err(|error| format!("读取隧道状态失败：{error}"))?
            .is_none()
        {
            return Ok(Some(TunnelStatus {
                status: "running",
                detail: "隧道已经在运行。".to_string(),
                pid: Some(child.id()),
                last_connected_at: child.last_connected_at,
            }));
        }
        guard.remove(profile_id);
    }

    Ok(None)
}

#[tauri::command]
pub(super) fn stop_tunnel(
    app: AppHandle,
    state: State<TunnelManager>,
    profile_id: Option<String>,
) -> Result<TunnelStatus, String> {
    let profile_id = resolve_profile_id_arg(state.inner(), profile_id)?;
    let result = stop_tunnel_inner(&app, state.inner(), &profile_id);
    if result.is_err() {
        push_app_event(
            &app,
            state.inner(),
            "ERROR",
            "tunnel",
            "隧道停止失败",
            "停止失败，请查看运行日志获取详情。",
            Some(&profile_id),
        );
    }
    if let Ok(status) = &result {
        emit_status_changed(&app, &profile_id, status);
    }
    result
}

pub(super) fn stop_tunnel_inner(
    app: &AppHandle,
    manager: &TunnelManager,
    profile_id: &str,
) -> Result<TunnelStatus, String> {
    let _lifecycle_guard = manager
        .lifecycle
        .lock()
        .map_err(|_| "隧道生命周期锁已损坏".to_string())?;
    stop_tunnel_without_lifecycle(app, manager, profile_id)
}

pub(super) fn stop_tunnel_without_lifecycle(
    app: &AppHandle,
    manager: &TunnelManager,
    profile_id: &str,
) -> Result<TunnelStatus, String> {
    cancel_reconnect_for_profile(manager, profile_id)?;
    let mut guard = manager
        .children
        .lock()
        .map_err(|_| "隧道状态锁已损坏".to_string())?;

    let Some(mut child) = guard.remove(profile_id) else {
        drop(guard);
        return Ok(TunnelStatus {
            status: "stopped",
            detail: "没有正在运行的隧道。".to_string(),
            pid: None,
            last_connected_at: profile_last_connected_at(app, profile_id),
        });
    };
    drop(guard);

    let pid = child.id();
    if child
        .try_wait()
        .map_err(|error| format!("读取隧道状态失败：{error}"))?
        .is_none()
    {
        if let Err(error) = child.kill() {
            manager
                .children
                .lock()
                .map_err(|_| "隧道状态锁已损坏".to_string())?
                .insert(profile_id.to_string(), child);
            return Err(format!("停止 ssh.exe 失败：{error}"));
        }
    }
    let _ = child.wait();
    push_tunnel_log(
        app,
        &manager.logs,
        "INFO",
        Some(profile_id),
        &format!("SSH 反向隧道已停止，pid={pid}"),
    );

    Ok(TunnelStatus {
        status: "stopped",
        detail: "SSH 反向隧道已停止。".to_string(),
        pid: Some(pid),
        last_connected_at: child
            .last_connected_at
            .or_else(|| profile_last_connected_at(app, profile_id)),
    })
}

#[tauri::command]
pub(super) fn stop_all_tunnels(
    app: AppHandle,
    state: State<TunnelManager>,
) -> Result<Vec<TunnelStatus>, String> {
    stop_all_tunnels_inner(&app, state.inner())
}

pub(super) fn stop_all_tunnels_inner(
    app: &AppHandle,
    manager: &TunnelManager,
) -> Result<Vec<TunnelStatus>, String> {
    let _lifecycle_guard = manager
        .lifecycle
        .lock()
        .map_err(|_| "隧道生命周期锁已损坏".to_string())?;
    let cancelled_reconnect_profiles = cancel_all_reconnect_tasks(manager)?;
    let mut profile_ids = {
        let guard = manager
            .children
            .lock()
            .map_err(|_| "隧道状态锁已损坏".to_string())?;
        guard.keys().cloned().collect::<Vec<_>>()
    };
    let mut seen_profile_ids = profile_ids.iter().cloned().collect::<HashSet<_>>();
    for profile in cancelled_reconnect_profiles {
        if seen_profile_ids.insert(profile.id.clone()) {
            profile_ids.push(profile.id);
        }
    }

    let mut statuses = Vec::new();
    for profile_id in profile_ids {
        let status = stop_tunnel_without_lifecycle(app, manager, &profile_id)?;
        emit_status_changed(app, &profile_id, &status);
        statuses.push(status);
    }
    Ok(statuses)
}

#[tauri::command]
pub(super) fn get_tunnel_status(
    app: AppHandle,
    state: State<TunnelManager>,
    profile_id: Option<String>,
) -> Result<TunnelStatus, String> {
    let profile_id = resolve_profile_id_arg(state.inner(), profile_id)?;
    refresh_single_tunnel_status(&app, state.inner(), &profile_id)
}

pub(super) fn refresh_single_tunnel_status(
    app: &AppHandle,
    manager: &TunnelManager,
    profile_id: &str,
) -> Result<TunnelStatus, String> {
    let _lifecycle_guard = manager
        .lifecycle
        .lock()
        .map_err(|_| "隧道生命周期锁已损坏".to_string())?;
    let mut exited = None;
    let mut guard = manager
        .children
        .lock()
        .map_err(|_| "隧道状态锁已损坏".to_string())?;

    if let Some(child) = guard.get_mut(profile_id) {
        if let Some(exit_status) = child
            .try_wait()
            .map_err(|error| format!("读取隧道状态失败：{error}"))?
        {
            let profile = child.profile.clone();
            let detail = format!("ssh.exe 已退出：{exit_status}");
            guard.remove(profile_id);
            exited = Some((profile, detail));
        } else {
            return Ok(TunnelStatus {
                status: "running",
                detail: "SSH 反向隧道正在运行。".to_string(),
                pid: Some(child.id()),
                last_connected_at: child.last_connected_at,
            });
        }
    }
    drop(guard);

    if let Some((profile, detail)) = exited {
        push_tunnel_log(app, &manager.logs, "ERROR", Some(profile_id), &detail);
        let status = handle_exited_tunnel(app, manager, profile, &detail, 1)?;
        emit_status_changed(app, profile_id, &status);
        let is_reconnecting = status.status == "reconnecting";
        push_app_event(
            app,
            manager,
            if is_reconnecting { "WARN" } else { "ERROR" },
            "tunnel",
            if is_reconnecting {
                "隧道已断开，正在重连"
            } else {
                "隧道已断开"
            },
            if is_reconnecting {
                "连接意外断开，已进入自动重连。"
            } else {
                "连接意外断开，请查看运行日志获取详情。"
            },
            Some(profile_id),
        );
        return Ok(status);
    }

    if let Some(status) = reconnect_status(manager, profile_id)? {
        emit_status_changed(app, profile_id, &status);
        return Ok(status);
    }
    Ok(TunnelStatus {
        status: "stopped",
        detail: "隧道未启动。".to_string(),
        pid: None,
        last_connected_at: profile_last_connected_at(app, profile_id),
    })
}
