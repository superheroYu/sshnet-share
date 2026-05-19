import { Download, Eye, FolderOpen } from "lucide-react";
import type {
  LogExportResult,
  LogLevelFilter,
  LogProfileFilter,
  Profile,
} from "../../types/domain";
import type { LocaleText } from "../../i18n/localeText";
import { displayProfileName } from "../../lib/display";

interface LogControlsProps {
  text: LocaleText;
  variant?: "page" | "compact";
  profiles: Profile[];
  logProfileFilter: LogProfileFilter;
  logLevelFilter: LogLevelFilter[];
  logFromDateTime: string;
  logToDateTime: string;
  lastLogExport: LogExportResult | null;
  isExportingLogs: boolean;
  isPreviewingLogs: boolean;
  onExportLogs: () => void;
  onPreviewLogs: () => void;
  onOpenLastLogExportFolder: () => void;
  onClearLogs: () => void;
  onSetLogProfileFilter: (value: LogProfileFilter) => void;
  onSetLogFromDateTime: (value: string) => void;
  onSetLogToDateTime: (value: string) => void;
  onToggleLogLevel: (level: LogLevelFilter) => void;
}

export function LogControls({
  text,
  variant = "page",
  profiles,
  logProfileFilter,
  logLevelFilter,
  logFromDateTime,
  logToDateTime,
  lastLogExport,
  isExportingLogs,
  isPreviewingLogs,
  onExportLogs,
  onPreviewLogs,
  onOpenLastLogExportFolder,
  onClearLogs,
  onSetLogProfileFilter,
  onSetLogFromDateTime,
  onSetLogToDateTime,
  onToggleLogLevel,
}: LogControlsProps) {
  const isCompact = variant === "compact";
  const profileSelect = (
    <select
      aria-label={text.logs.profileFilter}
      value={logProfileFilter}
      onChange={(event) => onSetLogProfileFilter(event.currentTarget.value as LogProfileFilter)}
    >
      <option value="all">{text.logs.allProfiles}</option>
      <option value="app">{text.logs.appLogs}</option>
      {profiles.map((profile) => (
        <option value={profile.id} key={profile.id}>
          {displayProfileName(profile.name, text)}
        </option>
      ))}
    </select>
  );
  const levelFilter = (
    <div className="level-filter" aria-label={text.logs.levelFilter}>
      {(["INFO", "WARN", "ERROR"] as LogLevelFilter[]).map((level) => (
        <button
          className={logLevelFilter.includes(level) ? "active" : ""}
          type="button"
          key={level}
          onClick={() => onToggleLogLevel(level)}
        >
          {level}
        </button>
      ))}
    </div>
  );

  const exportActions = (
    <>
      <button type="button" onClick={onExportLogs} disabled={isExportingLogs}>
        <Download size={14} />
        {isExportingLogs ? text.logs.exporting : text.logs.export}
      </button>
      <button type="button" onClick={onOpenLastLogExportFolder} disabled={!lastLogExport}>
        <FolderOpen size={14} />
        {text.logs.openExportFolder}
      </button>
      <button type="button" onClick={onClearLogs}>
        {text.logs.clear}
      </button>
    </>
  );

  if (isCompact) {
    return (
      <div className="log-controls compact-controls">
        <div className="compact-filter-group">
          {profileSelect}
          {levelFilter}
        </div>
        <div className="compact-action-group">
          {exportActions}
        </div>
      </div>
    );
  }

  return (
    <div className="log-controls page-controls">
      <div className="log-filter-group">
        <div className="log-filter-field log-filter-profile">
          {profileSelect}
        </div>
        {levelFilter}
        <div className="log-date-range">
          <label className="log-date-filter">
            <span>{text.logs.fromDate}</span>
            <input
              type="datetime-local"
              value={logFromDateTime}
              onChange={(event) => onSetLogFromDateTime(event.currentTarget.value)}
            />
          </label>
          <label className="log-date-filter">
            <span>{text.logs.toDate}</span>
            <input
              type="datetime-local"
              value={logToDateTime}
              onChange={(event) => onSetLogToDateTime(event.currentTarget.value)}
            />
          </label>
        </div>
      </div>
      <div className="log-action-group">
        <button type="button" onClick={onPreviewLogs} disabled={isPreviewingLogs}>
          <Eye size={14} />
          {isPreviewingLogs ? text.logs.previewing : text.logs.preview}
        </button>
        {exportActions}
      </div>
    </div>
  );
}
