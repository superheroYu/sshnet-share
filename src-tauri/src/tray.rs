use super::*;

pub(super) fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        // Windows can deny set_focus() when another app owns the foreground.
        // Briefly toggling always-on-top forces the window to come to front.
        #[cfg(target_os = "windows")]
        {
            let _ = window.set_always_on_top(true);
            let _ = window.set_always_on_top(false);
        }
    }
}

pub(super) fn show_logs_window(app: &AppHandle) {
    show_main_window(app);
    let _ = app.emit(TRAY_SHOW_LOGS_EVENT, ());
}

pub(super) fn notify_tray_result(app: &AppHandle, title: &str, body: &str) {
    notify_tray_result_with_level(app, "INFO", title, body);
}

pub(super) fn notify_tray_result_with_level(
    app: &AppHandle,
    level: &str,
    title: &str,
    body: &str,
) {
    let manager = app.state::<TunnelManager>();
    push_app_event(app, manager.inner(), level, "tray", title, body, None);
    let _ = app.notification().builder().title(title).body(body).show();
}

pub(super) fn concise_tray_error(error: &str) -> String {
    let first_line = error.lines().next().unwrap_or(error).trim();
    if first_line.chars().count() > 120 {
        format!("{}...", first_line.chars().take(117).collect::<String>())
    } else {
        first_line.to_string()
    }
}

#[derive(Clone, Copy)]
enum TrayLanguage {
    ZhCn,
    EnUs,
}

impl TrayLanguage {
    fn from_code(language: &str) -> Result<Self, String> {
        match language {
            "zh-CN" => Ok(Self::ZhCn),
            "en-US" => Ok(Self::EnUs),
            _ => Err(format!("Unsupported tray language: {language}")),
        }
    }

    fn open_label(self) -> &'static str {
        match self {
            Self::ZhCn => "\u{6253}\u{5f00}\u{4e3b}\u{7a97}\u{53e3}",
            Self::EnUs => "Open Main Window",
        }
    }

    fn start_label(self) -> &'static str {
        match self {
            Self::ZhCn => "\u{542f}\u{52a8}\u{5168}\u{90e8}\u{914d}\u{7f6e}",
            Self::EnUs => "Start All Profiles",
        }
    }

    fn stop_label(self) -> &'static str {
        match self {
            Self::ZhCn => "\u{505c}\u{6b62}\u{5168}\u{90e8}\u{96a7}\u{9053}",
            Self::EnUs => "Stop All Tunnels",
        }
    }

    fn logs_label(self) -> &'static str {
        match self {
            Self::ZhCn => "\u{67e5}\u{770b}\u{65e5}\u{5fd7}",
            Self::EnUs => "View Logs",
        }
    }

    fn floating_label(self) -> &'static str {
        match self {
            // 显示状态浮窗
            Self::ZhCn => "\u{663e}\u{793a}\u{72b6}\u{6001}\u{6d6e}\u{7a97}",
            Self::EnUs => "Toggle Status Overlay",
        }
    }

    fn quit_label(self) -> &'static str {
        match self {
            Self::ZhCn => "\u{9000}\u{51fa}",
            Self::EnUs => "Quit",
        }
    }
}

fn build_tray_menu<R: tauri::Runtime, M: Manager<R>>(
    app: &M,
    language: TrayLanguage,
) -> tauri::Result<Menu<R>> {
    let open_item = MenuItem::with_id(app, TRAY_OPEN, language.open_label(), true, None::<&str>)?;
    let start_item =
        MenuItem::with_id(app, TRAY_START, language.start_label(), true, None::<&str>)?;
    let stop_item = MenuItem::with_id(app, TRAY_STOP, language.stop_label(), true, None::<&str>)?;
    let logs_item = MenuItem::with_id(app, TRAY_LOGS, language.logs_label(), true, None::<&str>)?;
    let floating_item =
        MenuItem::with_id(app, TRAY_FLOATING, language.floating_label(), true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, TRAY_QUIT, language.quit_label(), true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    Menu::with_items(
        app,
        &[
            &open_item,
            &start_item,
            &stop_item,
            &logs_item,
            &floating_item,
            &separator,
            &quit_item,
        ],
    )
}

#[tauri::command]
pub(super) fn set_tray_language(app: AppHandle, language: String) -> Result<(), String> {
    let language = TrayLanguage::from_code(&language)?;
    let menu = build_tray_menu(&app, language).map_err(|error| error.to_string())?;
    let tray = app
        .tray_by_id(TRAY_ICON_ID)
        .ok_or_else(|| "Tray icon is not available.".to_string())?;
    tray.set_menu(Some(menu)).map_err(|error| error.to_string())
}

pub(super) struct TrayTaskGuard {
    app: AppHandle,
}

impl Drop for TrayTaskGuard {
    fn drop(&mut self) {
        let manager = self.app.state::<TunnelManager>();
        clear_tray_task(manager.inner());
    }
}

pub(super) fn reserve_tray_task(
    manager: &TunnelManager,
    task_name: &'static str,
) -> Result<(), String> {
    let mut guard = manager
        .tray_task
        .lock()
        .map_err(|_| "托盘任务状态锁已损坏".to_string())?;
    if let Some(active) = *guard {
        return Err(format!("已有托盘任务正在执行：{active}"));
    }
    *guard = Some(task_name);
    Ok(())
}

pub(super) fn clear_tray_task(manager: &TunnelManager) {
    if let Ok(mut guard) = manager.tray_task.lock() {
        *guard = None;
    }
}

pub(super) fn try_begin_tray_task(
    app: &AppHandle,
    task_name: &'static str,
) -> Result<TrayTaskGuard, String> {
    let manager = app.state::<TunnelManager>();
    reserve_tray_task(manager.inner(), task_name)?;
    Ok(TrayTaskGuard { app: app.clone() })
}

pub(super) fn start_saved_profiles_from_tray(app: &AppHandle) {
    let state = app.state::<TunnelManager>();
    let tray_task_guard = match try_begin_tray_task(app, "启动全部配置") {
        Ok(guard) => guard,
        Err(error) => {
            notify_tray_result_with_level(app, "WARN", "SSHNet Share", &error);
            push_tunnel_log(
                app,
                &state.logs,
                "WARN",
                None,
                &format!("托盘启动已忽略：{error}"),
            );
            return;
        }
    };
    let app = app.clone();
    thread::spawn(move || {
        let _tray_task_guard = tray_task_guard;
        let state = app.state::<TunnelManager>();
        notify_tray_result(&app, "SSHNet Share", "正在从托盘启动配置...");
        match load_profiles_inner(&app) {
            Ok(profiles) => {
                let total = profiles.len();
                let mut success_count = 0_usize;
                let mut failures = Vec::<String>::new();
                for profile in profiles {
                    let profile_id = profile.id.clone();
                    let profile_name = profile.name.clone();
                    let last_connected_at = profile.last_connected_at;
                    match start_tunnel_inner(&app, state.inner(), profile, None, None) {
                        Ok(status) => {
                            success_count += 1;
                            push_tunnel_log(
                                &app,
                                &state.logs,
                                "INFO",
                                Some(&profile_id),
                                &format!("托盘启动完成：{}", status.detail),
                            );
                        }
                        Err(error) => {
                            let summary = concise_tray_error(&error);
                            failures.push(format!("{profile_name}: {summary}"));
                            push_tunnel_log(
                                &app,
                                &state.logs,
                                "ERROR",
                                Some(&profile_id),
                                &format!("托盘启动失败：{error}"),
                            );
                            emit_status_changed(
                                &app,
                                &profile_id,
                                &TunnelStatus {
                                    status: "failed",
                                    detail: error,
                                    pid: None,
                                    last_connected_at,
                                },
                            );
                        }
                    }
                }
                if failures.is_empty() {
                    notify_tray_result(
                        &app,
                        "SSHNet Share",
                        &format!("启动完成：已处理 {success_count}/{total} 个配置。"),
                    );
                } else if success_count == 0 {
                    notify_tray_result_with_level(
                        &app,
                        "ERROR",
                        "SSHNet Share",
                        &format!(
                            "启动失败：{} 个配置均未启动。{}",
                            failures.len(),
                            failures.first().cloned().unwrap_or_default()
                        ),
                    );
                } else {
                    notify_tray_result_with_level(
                        &app,
                        "WARN",
                        "SSHNet Share",
                        &format!(
                            "启动部分失败：成功 {success_count}/{total}，失败 {}。{}",
                            failures.len(),
                            failures.first().cloned().unwrap_or_default()
                        ),
                    );
                }
            }
            Err(error) => {
                let summary = concise_tray_error(&error);
                push_tunnel_log(
                    &app,
                    &state.logs,
                    "ERROR",
                    None,
                    &format!("托盘启动失败：{error}"),
                );
                notify_tray_result_with_level(
                    &app,
                    "ERROR",
                    "SSHNet Share",
                    &format!("启动失败：{summary}"),
                );
            }
        }
    });
}

pub(super) fn stop_tunnels_from_tray(app: &AppHandle) {
    let state = app.state::<TunnelManager>();
    let tray_task_guard = match try_begin_tray_task(app, "停止全部隧道") {
        Ok(guard) => guard,
        Err(error) => {
            notify_tray_result_with_level(app, "WARN", "SSHNet Share", &error);
            push_tunnel_log(
                app,
                &state.logs,
                "WARN",
                None,
                &format!("托盘停止已忽略：{error}"),
            );
            return;
        }
    };
    let app = app.clone();
    thread::spawn(move || {
        let _tray_task_guard = tray_task_guard;
        let state = app.state::<TunnelManager>();
        notify_tray_result(&app, "SSHNet Share", "正在从托盘停止隧道...");
        match stop_all_tunnels_inner(&app, state.inner()) {
            Ok(status) => {
                let count = status.len();
                push_tunnel_log(
                    &app,
                    &state.logs,
                    "INFO",
                    None,
                    &format!("托盘停止完成：已处理 {} 个隧道", status.len()),
                );
                notify_tray_result(
                    &app,
                    "SSHNet Share",
                    &format!("停止完成：已处理 {count} 个隧道。"),
                );
            }
            Err(error) => {
                let summary = concise_tray_error(&error);
                push_tunnel_log(
                    &app,
                    &state.logs,
                    "ERROR",
                    None,
                    &format!("托盘停止失败：{error}"),
                );
                notify_tray_result_with_level(
                    &app,
                    "ERROR",
                    "SSHNet Share",
                    &format!("停止失败：{summary}"),
                );
            }
        }
    });
}

pub(super) fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let menu = build_tray_menu(app, TrayLanguage::ZhCn)?;

    let mut tray = TrayIconBuilder::with_id(TRAY_ICON_ID)
        .tooltip("SSHNet Share")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_OPEN => show_main_window(app),
            TRAY_LOGS => show_logs_window(app),
            TRAY_FLOATING => toggle_floating_window_inner(app),
            TRAY_START => start_saved_profiles_from_tray(app),
            TRAY_STOP => stop_tunnels_from_tray(app),
            TRAY_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}
