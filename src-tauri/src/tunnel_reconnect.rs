use super::*;

pub(super) fn cancel_reconnect_task(
    manager: &TunnelManager,
    profile_id: &str,
) -> Result<(), String> {
    let mut guard = manager
        .reconnects
        .lock()
        .map_err(|_| "重连任务状态锁已损坏".to_string())?;
    guard.remove(profile_id);
    Ok(())
}

pub(super) fn cancel_reconnect_for_profile(
    manager: &TunnelManager,
    profile_id: &str,
) -> Result<(), String> {
    bump_reconnect_generation(manager, profile_id)?;
    cancel_reconnect_task(manager, profile_id)
}

pub(super) fn reconnect_generation(
    manager: &TunnelManager,
    profile_id: &str,
) -> Result<u64, String> {
    let mut guard = manager
        .reconnect_generations
        .lock()
        .map_err(|_| "重连取消状态锁已损坏".to_string())?;
    Ok(*guard.entry(profile_id.to_string()).or_insert(0))
}

pub(super) fn bump_reconnect_generation(
    manager: &TunnelManager,
    profile_id: &str,
) -> Result<u64, String> {
    let mut guard = manager
        .reconnect_generations
        .lock()
        .map_err(|_| "重连取消状态锁已损坏".to_string())?;
    let entry = guard.entry(profile_id.to_string()).or_insert(0);
    *entry = entry.saturating_add(1);
    Ok(*entry)
}

pub(super) fn cancel_all_reconnect_tasks(manager: &TunnelManager) -> Result<Vec<Profile>, String> {
    let (profile_ids, reconnect_profiles) = {
        let generation_guard = manager
            .reconnect_generations
            .lock()
            .map_err(|_| "重连取消状态锁已损坏".to_string())?;
        let reconnect_guard = manager
            .reconnects
            .lock()
            .map_err(|_| "重连任务状态锁已损坏".to_string())?;
        let children_guard = manager
            .children
            .lock()
            .map_err(|_| "隧道状态锁已损坏".to_string())?;
        let profile_ids = generation_guard
            .keys()
            .chain(reconnect_guard.keys())
            .chain(children_guard.keys())
            .cloned()
            .collect::<HashSet<_>>();
        let reconnect_profiles = reconnect_guard
            .values()
            .map(|task| task.profile.clone())
            .collect::<Vec<_>>();
        (profile_ids, reconnect_profiles)
    };

    for profile_id in profile_ids {
        bump_reconnect_generation(manager, &profile_id)?;
    }
    manager
        .reconnects
        .lock()
        .map_err(|_| "重连任务状态锁已损坏".to_string())?
        .clear();
    Ok(reconnect_profiles)
}

pub(super) fn prepare_reconnect_start(
    app: &AppHandle,
    manager: &TunnelManager,
    profile: &mut Profile,
    expected_generation: u64,
) -> Result<(), String> {
    let current_generation = reconnect_generation(manager, &profile.id)?;
    let task_profile = {
        let mut guard = manager
            .reconnects
            .lock()
            .map_err(|_| "重连任务状态锁已损坏".to_string())?;
        let Some(task) = guard.get(&profile.id) else {
            return Err("自动重连已取消。".to_string());
        };
        if task.generation != expected_generation || current_generation != expected_generation {
            return Err("自动重连已取消。".to_string());
        }
        guard.remove(&profile.id).map(|task| task.profile)
    };

    let Some(task_profile) = task_profile else {
        return Err("自动重连已取消。".to_string());
    };
    let Some(current_profile) = current_reconnect_profile(app, &task_profile.id)? else {
        return Err("自动重连已取消：配置已删除或已关闭自动重连。".to_string());
    };
    validate_profile(&current_profile)?;
    *profile = current_profile;
    Ok(())
}

pub(super) fn current_reconnect_profile(
    app: &AppHandle,
    profile_id: &str,
) -> Result<Option<Profile>, String> {
    Ok(load_profiles_inner(app)?
        .into_iter()
        .find(|profile| profile.id == profile_id && profile.reconnect_enabled))
}

pub(super) fn reconnect_status(
    manager: &TunnelManager,
    profile_id: &str,
) -> Result<Option<TunnelStatus>, String> {
    let guard = manager
        .reconnects
        .lock()
        .map_err(|_| "重连任务状态锁已损坏".to_string())?;
    let Some(task) = guard.get(profile_id) else {
        return Ok(None);
    };
    let remaining = task
        .next_attempt_at
        .saturating_duration_since(Instant::now())
        .as_secs()
        .max(1);
    Ok(Some(TunnelStatus {
        status: "reconnecting",
        detail: format!(
            "{} 已断开，将在 {remaining} 秒后第 {} 次重连。",
            task.profile.name, task.attempt
        ),
        pid: None,
        last_connected_at: task.profile.last_connected_at,
    }))
}

pub(super) fn handle_exited_tunnel(
    app: &AppHandle,
    manager: &TunnelManager,
    profile: Profile,
    detail: &str,
    attempt: u32,
) -> Result<TunnelStatus, String> {
    if current_reconnect_profile(app, &profile.id)?.is_some() {
        schedule_reconnect(app, manager, profile, attempt, detail)
    } else {
        Ok(TunnelStatus {
            status: "failed",
            detail: detail.to_string(),
            pid: None,
            last_connected_at: profile.last_connected_at,
        })
    }
}

pub(super) fn schedule_reconnect(
    app: &AppHandle,
    manager: &TunnelManager,
    profile: Profile,
    attempt: u32,
    reason: &str,
) -> Result<TunnelStatus, String> {
    schedule_reconnect_checked(app, manager, profile, attempt, reason, None)
}

pub(super) fn schedule_reconnect_checked(
    app: &AppHandle,
    manager: &TunnelManager,
    profile: Profile,
    attempt: u32,
    reason: &str,
    expected_generation: Option<u64>,
) -> Result<TunnelStatus, String> {
    let Some(profile) = current_reconnect_profile(app, &profile.id)? else {
        return Ok(TunnelStatus {
            status: "failed",
            detail: reason.to_string(),
            pid: None,
            last_connected_at: None,
        });
    };
    let delay = Duration::from_secs(profile.reconnect_interval_seconds as u64);
    let next_attempt_at = Instant::now() + delay;
    let generation = {
        let mut generation_guard = manager
            .reconnect_generations
            .lock()
            .map_err(|_| "重连取消状态锁已损坏".to_string())?;
        let generation = generation_guard.entry(profile.id.clone()).or_insert(0);
        if expected_generation
            .map(|expected| *generation != expected)
            .unwrap_or(false)
        {
            return Ok(TunnelStatus {
                status: "failed",
                detail: "自动重连已取消。".to_string(),
                pid: None,
                last_connected_at: profile.last_connected_at,
            });
        }

        let mut reconnect_guard = manager
            .reconnects
            .lock()
            .map_err(|_| "重连任务状态锁已损坏".to_string())?;
        reconnect_guard.insert(
            profile.id.clone(),
            ReconnectTask {
                profile: profile.clone(),
                attempt,
                generation: *generation,
                next_attempt_at,
            },
        );
        *generation
    };

    push_tunnel_log(
        app,
        &manager.logs,
        "WARN",
        Some(&profile.id),
        &format!(
            "{} 将在 {} 秒后第 {attempt} 次自动重连：{reason}",
            profile.name, profile.reconnect_interval_seconds
        ),
    );
    spawn_reconnect_worker(app.clone(), profile.id.clone(), attempt, generation, delay);

    Ok(TunnelStatus {
        status: "reconnecting",
        detail: format!(
            "{} 已断开，将在 {} 秒后第 {attempt} 次自动重连。",
            profile.name, profile.reconnect_interval_seconds
        ),
        pid: None,
        last_connected_at: profile.last_connected_at,
    })
}

pub(super) fn spawn_reconnect_worker(
    app: AppHandle,
    profile_id: String,
    attempt: u32,
    generation: u64,
    delay: Duration,
) {
    thread::spawn(move || {
        thread::sleep(delay);
        let state = app.state::<TunnelManager>();
        let profile = {
            let guard = match state.reconnects.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            let Some(task) = guard.get(&profile_id) else {
                return;
            };
            if task.attempt != attempt || task.generation != generation {
                return;
            }
            Some(task.profile.clone())
        };
        let Some(profile) = profile else {
            return;
        };
        match start_tunnel_inner(&app, state.inner(), profile.clone(), None, Some(generation)) {
            Ok(status) => {
                push_tunnel_log(
                    &app,
                    &state.logs,
                    "INFO",
                    Some(&profile.id),
                    &format!("自动重连完成：{}", status.detail),
                );
            }
            Err(error) => {
                push_tunnel_log(
                    &app,
                    &state.logs,
                    "ERROR",
                    Some(&profile.id),
                    &format!("自动重连失败：{error}"),
                );
                if profile.reconnect_enabled && !is_reconnect_cancelled_error(&error) {
                    let next_attempt = attempt.saturating_add(1);
                    if let Ok(status) = schedule_reconnect_checked(
                        &app,
                        state.inner(),
                        profile.clone(),
                        next_attempt,
                        &error,
                        Some(generation),
                    ) {
                        emit_status_changed(&app, &profile.id, &status);
                    }
                }
            }
        }
    });
}

pub(super) fn is_reconnect_cancelled_error(error: &str) -> bool {
    error.starts_with("自动重连已取消")
}

pub(super) fn start_tunnel_monitor(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(3));
        let state = app.state::<TunnelManager>();
        let profile_ids = {
            let Ok(guard) = state.children.lock() else {
                continue;
            };
            guard.keys().cloned().collect::<Vec<_>>()
        };
        for profile_id in profile_ids {
            let _ = refresh_single_tunnel_status(&app, state.inner(), &profile_id);
        }
    });
}

pub(super) fn resolve_profile_id_arg(
    manager: &TunnelManager,
    profile_id: Option<String>,
) -> Result<String, String> {
    if let Some(profile_id) = profile_id {
        if !profile_id.trim().is_empty() {
            return Ok(profile_id);
        }
    }

    let guard = manager
        .children
        .lock()
        .map_err(|_| "隧道状态锁已损坏".to_string())?;
    if guard.len() == 1 {
        if let Some(profile_id) = guard.keys().next() {
            return Ok(profile_id.clone());
        }
    }

    Ok(default_profile_id())
}
