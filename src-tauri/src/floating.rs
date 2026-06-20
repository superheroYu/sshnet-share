use super::*;

pub(super) const FLOATING_LABEL: &str = "floating";
pub(super) const FLOATING_VISIBILITY_EVENT: &str = "floating-visibility-changed";

pub(super) fn emit_floating_visibility(app: &AppHandle, visible: bool) {
    let _ = app.emit(FLOATING_VISIBILITY_EVENT, visible);
}

fn floating_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window(FLOATING_LABEL)
}

pub(super) fn show_floating_window(app: &AppHandle) {
    if let Some(window) = floating_window(app) {
        let _ = window.show();
        let _ = window.set_focus();
        // Windows can deny set_focus() when another app owns the foreground;
        // the window is already always-on-top, so showing is enough.
        emit_floating_visibility(app, true);
    }
}

pub(super) fn hide_floating_window(app: &AppHandle) {
    if let Some(window) = floating_window(app) {
        let _ = window.hide();
        emit_floating_visibility(app, false);
    }
}

pub(super) fn toggle_floating_window_inner(app: &AppHandle) {
    let visible = floating_window(app)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);
    if visible {
        hide_floating_window(app);
    } else {
        show_floating_window(app);
    }
}

#[tauri::command]
pub(super) fn toggle_floating_window(app: AppHandle) {
    toggle_floating_window_inner(&app);
}

#[tauri::command]
pub(super) fn set_floating_window_visible(app: AppHandle, visible: bool) {
    if visible {
        show_floating_window(&app);
    } else {
        hide_floating_window(&app);
    }
}

#[tauri::command]
pub(super) fn is_floating_window_visible(app: AppHandle) -> bool {
    floating_window(&app)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

/// Bring the main window forward from the floating window.
#[tauri::command]
pub(super) fn focus_main_window(app: AppHandle) {
    show_main_window(&app);
}
