import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, X } from "lucide-react";
import { useFloatingController } from "../../hooks/useFloatingController";
import {
  displayProfileName,
  formatConnectionDuration,
  tunnelStatusLabel,
} from "../../lib/display";
import "../../styles/floating.css";

export function FloatingView() {
  const { resolvedColorMode, profiles, tunnelStatuses, runningCount, nowMs, text } =
    useFloatingController();

  function openMainWindow() {
    void invoke("focus_main_window");
  }

  function hideOverlay() {
    void invoke("set_floating_window_visible", { visible: false });
  }

  return (
    <div className={`floating-frame theme-${resolvedColorMode}`}>
      <header className="floating-header" data-tauri-drag-region>
        <div className="floating-title" data-tauri-drag-region>
          <strong data-tauri-drag-region>{text.floating.title}</strong>
          <span data-tauri-drag-region>
            {text.floating.runningOf(runningCount, profiles.length)}
          </span>
        </div>
        <div className="floating-header-actions">
          <button
            type="button"
            title={text.floating.openMain}
            aria-label={text.floating.openMain}
            onClick={openMainWindow}
          >
            <ExternalLink size={15} />
          </button>
          <button
            type="button"
            title={text.floating.close}
            aria-label={text.floating.close}
            onClick={hideOverlay}
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="floating-body">
        {profiles.length === 0 ? (
          <p className="floating-empty">{text.floating.empty}</p>
        ) : (
          <ul className="floating-list">
            {profiles.map((profile) => {
              const status = tunnelStatuses[profile.id];
              const statusKey = status?.status ?? "stopped";
              const isRunning = statusKey === "running";
              const lastConnectedAt = status?.lastConnectedAt ?? profile.lastConnectedAt;
              return (
                <li
                  key={profile.id}
                  className={`floating-item ${statusKey}`}
                  onClick={openMainWindow}
                  title={text.floating.openMain}
                >
                  <span className="floating-led" aria-hidden />
                  <div className="floating-item-main">
                    <strong>{displayProfileName(profile.name, text)}</strong>
                    <span className="floating-endpoint">
                      <code>{profile.localProxyPort}</code>
                      <span aria-hidden>→</span>
                      <code>{profile.remoteProxyPort}</code>
                    </span>
                  </div>
                  <div className="floating-item-status">
                    <span className="floating-status-label">
                      {tunnelStatusLabel(statusKey, text)}
                    </span>
                    {isRunning ? (
                      <span className="floating-duration">
                        {formatConnectionDuration(lastConnectedAt, nowMs)}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
