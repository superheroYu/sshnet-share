import { Inbox, Terminal } from "lucide-react";
import type {
  LogExportResult,
  LogLevelFilter,
  LogLineViewModel,
  LogPreviewResult,
  LogProfileFilter,
  LogStorageInfo,
  Profile,
} from "../../types/domain";
import type { LocaleText } from "../../i18n/localeText";
import { LogControls } from "./LogControls";

interface LogPageProps {
  text: LocaleText;
  profiles: Profile[];
  runningCount: number;
  renderedLogLines: LogLineViewModel[];
  logProfileFilter: LogProfileFilter;
  logLevelFilter: LogLevelFilter[];
  logFromDateTime: string;
  logToDateTime: string;
  lastLogExport: LogExportResult | null;
  logPreview: LogPreviewResult | null;
  logStorageInfo: LogStorageInfo | null;
  isExportingLogs: boolean;
  isPreviewingLogs: boolean;
  onExportLogs: () => void;
  onPreviewLogs: () => void;
  onOpenLastLogExportFolder: () => void;
  onClearLogs: () => void;
  onSetLogProfileFilter: (value: LogProfileFilter) => void;
  onSetLogFromDateTime: (value: string) => void;
  onSetLogToDateTime: (value: string) => void;
  onCloseLogPreview: () => void;
  onToggleLogLevel: (level: LogLevelFilter) => void;
  onOpenProfiles: () => void;
}

export function LogPage(props: LogPageProps) {
  const { text, renderedLogLines, logPreview, onCloseLogPreview, onOpenProfiles } = props;
  const hasRunningTunnels = props.runningCount > 0;

  return (
    <section className="log-page">
      <div className="log-page-toolbar">
        <div className="log-page-heading">
          <strong>
            <Terminal size={16} />
            {text.logs.title}
          </strong>
          {props.logStorageInfo ? (
            <span>
              {text.logs.storageInfo(
                formatBytes(props.logStorageInfo.totalBytes),
                props.logStorageInfo.fileCount,
              )}
            </span>
          ) : null}
        </div>
        <LogControls {...props} />
      </div>
      {logPreview ? (
        <section className="log-preview-panel" aria-label={text.logs.previewTitle}>
          <div className="log-preview-header">
            <strong>{text.logs.previewTitle}</strong>
            <span>
              {text.logs.previewSummary(logPreview.lineCount, logPreview.redactionCount)}
            </span>
            <button type="button" onClick={onCloseLogPreview}>
              {text.logs.closePreview}
            </button>
          </div>
          {logPreview.previewLines.length ? (
            <pre>{logPreview.previewLines.join("\n")}</pre>
          ) : (
            <p>{text.logs.previewEmpty}</p>
          )}
        </section>
      ) : null}
      <div className="log-lines">
        {renderedLogLines.length === 0 ? (
          <div className="logs-empty">
            <Inbox aria-hidden />
            <strong>{text.logs.title}</strong>
            <p>{hasRunningTunnels ? text.logs.emptyRunningHint : text.logs.emptyHint}</p>
            {hasRunningTunnels ? null : (
              <button type="button" className="logs-empty-cta" onClick={onOpenProfiles}>
                {text.logs.emptyHintCta}
              </button>
            )}
          </div>
        ) : (
          renderedLogLines.map((line) => (
            <div
              className={`log-line level-${line.level.toLowerCase()}`}
              key={line.key}
            >
              <span className="log-time">{line.timestamp}</span>
              <span className="log-level" data-level={line.level.toLowerCase()}>
                {line.level}
              </span>
              <span className="log-message">{line.body}</span>
              {line.profileLabel ? (
                <span className="log-profile">{line.profileLabel}</span>
              ) : (
                <span className="log-profile" aria-hidden />
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
