import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Check,
  Clipboard,
  FileText,
  Pencil,
  Square,
  Terminal,
  X,
} from "lucide-react";
import type { LocaleText } from "../../i18n/localeText";
import type { Profile, TunnelStatus } from "../../types/domain";
import { displayProfileName, formatConnectionDuration, tunnelStatusLabel } from "../../lib/display";

interface ConnectionDetailsPanelProps {
  text: LocaleText;
  selectedConnection: Profile;
  selectedConnectionStatus: TunnelStatus | undefined;
  isSelectedConnectionRunning: boolean;
  isBusy: boolean;
  stopProfiles: (targetProfiles?: Profile[]) => void;
  copySshCommand: (target?: Profile) => Promise<boolean>;
  copyServerCommand: (target?: Profile) => Promise<boolean>;
  openProfileEditor: (profile: Profile) => void;
  viewProfileLogs: (profile: Profile) => void;
  clearSelectedConnection: () => void;
}

export function ConnectionDetailsPanel({
  text,
  selectedConnection,
  selectedConnectionStatus,
  isSelectedConnectionRunning,
  isBusy,
  stopProfiles,
  copySshCommand,
  copyServerCommand,
  openProfileEditor,
  viewProfileLogs,
  clearSelectedConnection,
}: ConnectionDetailsPanelProps) {
  const [recentCopy, setRecentCopy] = useState<"ssh" | "server" | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isSelectedConnectionRunning) {
      return;
    }
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isSelectedConnectionRunning]);

  function flashCopy(target: "ssh" | "server") {
    setRecentCopy(target);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setRecentCopy(null);
      copyTimerRef.current = null;
    }, 1500);
  }

  const profileDisplayName = displayProfileName(selectedConnection.name, text);
  const statusKey = selectedConnectionStatus?.status ?? "stopped";
  const statusLabel = tunnelStatusLabel(selectedConnectionStatus?.status, text);
  const lastConnectedAt =
    selectedConnectionStatus?.lastConnectedAt ?? selectedConnection.lastConnectedAt;
  const pid = selectedConnectionStatus?.pid;

  return (
    <aside className="connection-details-panel" aria-label={text.connectionDetails.title}>
      <div className="connection-details-header">
        <div>
          <h2>{profileDisplayName}</h2>
          <span className={`status-cell ${statusKey}`}>
            <strong>{statusLabel}</strong>
          </span>
        </div>
        <button
          type="button"
          onClick={clearSelectedConnection}
          title={text.connectionDetails.close}
          aria-label={text.connectionDetails.close}
        >
          <X size={18} />
        </button>
      </div>

      {!isSelectedConnectionRunning ? (
        <div className="connection-details-stopped">
          <Activity aria-hidden />
          <strong>{text.connectionDetails.stoppedTitle}</strong>
          <p>{text.connectionDetails.stoppedHint}</p>
          <div className="connection-details-stopped-actions">
            <button
              type="button"
              className="toolbar-button"
              onClick={() => openProfileEditor(selectedConnection)}
            >
              <Pencil size={16} />
              {text.connectionDetails.openInProfiles}
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => viewProfileLogs(selectedConnection)}
            >
              <FileText size={16} />
              {text.connectionDetails.viewLogs}
            </button>
            <button type="button" className="toolbar-button" onClick={clearSelectedConnection}>
              {text.connectionDetails.backToList}
            </button>
          </div>
        </div>
      ) : (
        <>
          <dl className="connection-details-grid">
            <div>
              <dt>{text.connectionDetails.profileName}</dt>
              <dd>{profileDisplayName}</dd>
            </div>
            <div>
              <dt>{text.connectionDetails.localProxy}</dt>
              <dd>
                <code>
                  {selectedConnection.localProxyHost}:{selectedConnection.localProxyPort}
                </code>
              </dd>
            </div>
            <div>
              <dt>{text.connectionDetails.sshServer}</dt>
              <dd>
                <code>
                  {selectedConnection.sshUser}@{selectedConnection.sshHost}:
                  {selectedConnection.sshPort}
                </code>
              </dd>
            </div>
            <div>
              <dt>{text.connectionDetails.remoteEndpoint}</dt>
              <dd>
                <code>
                  {selectedConnection.remoteBindHost}:{selectedConnection.remoteProxyPort}
                </code>
              </dd>
            </div>
            <div>
              <dt>{text.connectionDetails.mode}</dt>
              <dd>
                {selectedConnection.localProxyProtocol === "http"
                  ? text.table.httpProxy
                  : text.table.socks5Proxy}
              </dd>
            </div>
            <div>
              <dt>{text.connectionDetails.duration}</dt>
              <dd className="connection-duration-value">
                {formatConnectionDuration(lastConnectedAt, nowMs)}
              </dd>
            </div>
            <div>
              <dt>{text.connectionDetails.pid}</dt>
              <dd>{pid ?? text.connectionDetails.pidUnknown}</dd>
            </div>
          </dl>

          <div className="connection-details-actions">
            <button
              type="button"
              className="toolbar-button danger-action"
              onClick={() => stopProfiles([selectedConnection])}
              disabled={isBusy}
            >
              <Square size={16} />
              {text.connectionDetails.stop}
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={async () => {
                if (await copySshCommand(selectedConnection)) {
                  flashCopy("ssh");
                }
              }}
            >
              {recentCopy === "ssh" ? <Check size={16} /> : <Terminal size={16} />}
              {text.connectionDetails.copySshCommand}
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={async () => {
                if (await copyServerCommand(selectedConnection)) {
                  flashCopy("server");
                }
              }}
            >
              {recentCopy === "server" ? <Check size={16} /> : <Clipboard size={16} />}
              {text.connectionDetails.copyServerCommand}
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => viewProfileLogs(selectedConnection)}
            >
              <FileText size={16} />
              {text.connectionDetails.viewLogs}
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => openProfileEditor(selectedConnection)}
            >
              <Pencil size={16} />
              {text.connectionDetails.openInProfiles}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
