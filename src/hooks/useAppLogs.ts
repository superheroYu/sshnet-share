import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type {
  AppSettings,
  LogExportResult,
  LogLevelFilter,
  LogLineViewModel,
  LogPreviewResult,
  LogProfileFilter,
  LogStorageInfo,
  Profile,
  TunnelLogEntry,
} from "../types/domain";
import type { LocaleText } from "../i18n/localeText";
import {
  displayBackendDetail,
  displayError,
  displayProfileName,
  logMessageMentionsProfile,
} from "../lib/display";

type UseAppLogsParams = {
  appSettings: AppSettings;
  text: LocaleText;
  profiles: Profile[];
};

export function useAppLogs({ appSettings, text, profiles }: UseAppLogsParams) {
  const [tunnelLogEntries, setTunnelLogEntries] = useState<TunnelLogEntry[]>([]);
  const [isExportingLogs, setIsExportingLogs] = useState(false);
  const [isPreviewingLogs, setIsPreviewingLogs] = useState(false);
  const [lastLogExport, setLastLogExport] = useState<LogExportResult | null>(null);
  const [logPreview, setLogPreview] = useState<LogPreviewResult | null>(null);
  const [logStorageInfo, setLogStorageInfo] = useState<LogStorageInfo | null>(null);
  const [logLevelFilter, setLogLevelFilter] = useState<LogLevelFilter[]>([
    "INFO",
    "WARN",
    "ERROR",
  ]);
  const [logProfileFilter, setLogProfileFilter] = useState<LogProfileFilter>("all");
  const [logFromDateTime, setLogFromDateTime] = useState("");
  const [logToDateTime, setLogToDateTime] = useState("");
  const textRef = useRef(text);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    setLogPreview(null);
  }, [logLevelFilter, logProfileFilter, logFromDateTime, logToDateTime]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void listen<TunnelLogEntry>("sshnet-log-entry", ({ payload }) => {
      if (!payload || typeof payload.id !== "number") {
        return;
      }
      setTunnelLogEntries((current) => mergeLogEntry(current, payload));
      void refreshLogStorageInfo();
    }).then((handler) => {
      if (disposed) {
        handler();
      } else {
        unlisten = handler;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const allRenderedLogLines = useMemo<LogLineViewModel[]>(
    () => {
      return tunnelLogEntries
        .map((entry) => {
          const profile = entry.profileId
            ? profiles.find((item) => item.id === entry.profileId)
            : undefined;
          const timestamp = new Date(entry.timestampMs).toLocaleTimeString(appSettings.language, {
            hour12: false,
          });
          const source = entry.source === "app" ? "" : `${entry.source} `;
          const message = displayBackendDetail(entry.message, text);
          const legacyName =
            profile &&
            entry.source !== "app" &&
            !logMessageMentionsProfile(entry.message, message, profile, text)
              ? `${displayProfileName(profile.name, text)} `
              : "";
          const body = `${source}${message}`;
          const legacyText = `${source}${legacyName}${message}`;
          return {
            key: `ssh-${entry.id}`,
            text: `${timestamp} [${entry.level}] ${legacyText}`,
            timestamp,
            body,
            level: (entry.level === "ERROR" || entry.level === "WARN" ? entry.level : "INFO") as LogLevelFilter,
            profileId: entry.profileId ?? null,
            profileLabel: profile ? displayProfileName(profile.name, text) : "",
            source: entry.source,
          };
        })
        .slice(-200);
    },
    [appSettings.language, profiles, text, tunnelLogEntries],
  );

  const renderedLogLines = useMemo<LogLineViewModel[]>(
    () => {
      return allRenderedLogLines
        .filter((line) => logLevelFilter.includes(line.level))
        .filter((line) => {
          if (logProfileFilter === "all") {
            return true;
          }
          if (logProfileFilter === "app") {
            return line.source === "app";
          }
          return line.profileId === logProfileFilter;
        })
        .slice(-160);
    },
    [allRenderedLogLines, logLevelFilter, logProfileFilter],
  );

  const runtimeLogLines = useMemo(
    () => allRenderedLogLines.slice(-160),
    [allRenderedLogLines],
  );

  function appendLog(level: "INFO" | "WARN" | "ERROR", message: string) {
    const timestampMs = Date.now();
    setTunnelLogEntries((current) =>
      [
        ...current,
        {
          id: -timestampMs,
          timestampMs,
          level,
          source: "app",
          profileId: null,
          message,
        },
      ].slice(-200),
    );
    void invoke("append_app_log", { level, message })
      .then(() => refreshTunnelLogs())
      .catch(() => undefined);
  }

  async function refreshTunnelLogs() {
    try {
      setTunnelLogEntries(await invoke<TunnelLogEntry[]>("get_tunnel_logs"));
      await refreshLogStorageInfo();
    } catch (error) {
      appendLog(
        "WARN",
        textRef.current.messages.readSshOutputFailed(displayError(error, textRef.current)),
      );
    }
  }

  async function refreshLogStorageInfo() {
    try {
      setLogStorageInfo(await invoke<LogStorageInfo>("get_log_storage_info"));
    } catch {
      setLogStorageInfo(null);
    }
  }

  async function clearLogs() {
    setTunnelLogEntries([]);
    setLogPreview(null);
    try {
      await invoke("clear_tunnel_logs");
      await refreshLogStorageInfo();
    } catch (error) {
      appendLog("WARN", text.messages.clearSshLogsFailed(displayError(error, text)));
    }
  }

  function exportFilter() {
    return {
      levels: logLevelFilter,
      profileId:
        logProfileFilter === "all" || logProfileFilter === "app" ? null : logProfileFilter,
      source: logProfileFilter === "app" ? "app" : null,
      fromTimestampMs: dateTimeInputToTimestamp(logFromDateTime),
      toTimestampMs: dateTimeInputToTimestamp(logToDateTime),
    };
  }

  async function exportLogs() {
    setIsExportingLogs(true);
    try {
      const result = await invoke<LogExportResult>("export_tunnel_logs", {
        filter: exportFilter(),
      });
      setLastLogExport(result);
      appendLog("INFO", displayBackendDetail(result.detail, text));
      await refreshLogStorageInfo();
    } catch (error) {
      appendLog("ERROR", text.messages.exportLogsFailed(displayError(error, text)));
    } finally {
      setIsExportingLogs(false);
    }
  }

  async function previewLogs() {
    setIsPreviewingLogs(true);
    try {
      const result = await invoke<LogPreviewResult>("preview_tunnel_logs", {
        filter: exportFilter(),
        limit: 40,
      });
      setLogPreview(result);
    } catch (error) {
      appendLog("ERROR", text.messages.previewLogsFailed(displayError(error, text)));
    } finally {
      setIsPreviewingLogs(false);
    }
  }

  async function openLastLogExportFolder() {
    if (!lastLogExport) {
      return;
    }
    try {
      await revealItemInDir(lastLogExport.path);
    } catch (error) {
      appendLog("ERROR", text.messages.openLogFolderFailed(displayError(error, text)));
    }
  }

  function toggleLogLevel(level: LogLevelFilter) {
    setLogLevelFilter((current) => {
      if (current.includes(level)) {
        const next = current.filter((item) => item !== level);
        return next.length ? next : current;
      }
      return [...current, level];
    });
  }

  return {
    renderedLogLines,
    runtimeLogLines,
    logLevelFilter,
    logProfileFilter,
    logFromDateTime,
    logToDateTime,
    isExportingLogs,
    isPreviewingLogs,
    lastLogExport,
    logPreview,
    logStorageInfo,
    setLogProfileFilter,
    setLogFromDateTime,
    setLogToDateTime,
    appendLog,
    refreshTunnelLogs,
    refreshLogStorageInfo,
    clearLogs,
    exportLogs,
    previewLogs,
    setLogPreview,
    openLastLogExportFolder,
    toggleLogLevel,
  };
}

function mergeLogEntry(entries: TunnelLogEntry[], entry: TunnelLogEntry) {
  if (entries.some((item) => item.id === entry.id)) {
    return entries;
  }
  return [...entries, entry].sort((a, b) => a.id - b.id).slice(-200);
}

function dateTimeInputToTimestamp(value: string) {
  if (!value.trim()) {
    return null;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}
