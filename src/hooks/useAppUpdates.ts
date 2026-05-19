import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { AvailableUpdateInfo } from "../types/domain";
import type { LocaleText } from "../i18n/localeText";
import { displayError } from "../lib/display";

type AppendLog = (level: "INFO" | "WARN" | "ERROR", message: string) => void;
type PendingUpdate = NonNullable<Awaited<ReturnType<typeof check>>>;

type UseAppUpdatesParams = {
  text: LocaleText;
  appendLog: AppendLog;
};

export function useAppUpdates({ text, appendLog }: UseAppUpdatesParams) {
  const [isCheckingForUpdate, setIsCheckingForUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdateInfo | null>(null);
  const [updateStatusMessage, setUpdateStatusMessage] = useState("");
  const pendingUpdateRef = useRef<PendingUpdate | null>(null);
  const didSilentCheckRef = useRef(false);
  const textRef = useRef(text);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    if (didSilentCheckRef.current) {
      return;
    }
    didSilentCheckRef.current = true;
    void checkForUpdates({ silent: true });
  }, []);

  async function checkForUpdates(options: { silent?: boolean } = {}) {
    const silent = options.silent ?? false;
    setIsCheckingForUpdate(true);
    if (!silent) {
      setUpdateStatusMessage(textRef.current.settings.updateChecking);
    }
    try {
      const update = await check();
      pendingUpdateRef.current = update;
      if (update) {
        const info = updateInfo(update);
        setAvailableUpdate(info);
        const message = textRef.current.messages.updateAvailable(info.version);
        setUpdateStatusMessage(message);
        appendLog("INFO", message);
        await recordUpdateEvent("INFO", textRef.current.settings.updateAvailableTitle, message);
        return;
      }

      setAvailableUpdate(null);
      if (!silent) {
        const message = textRef.current.messages.noUpdatesAvailable;
        setUpdateStatusMessage(message);
        appendLog("INFO", message);
        await recordUpdateEvent("INFO", textRef.current.settings.updateCurrentTitle, message);
      }
    } catch (error) {
      setAvailableUpdate(null);
      pendingUpdateRef.current = null;
      if (!silent) {
        const message = textRef.current.messages.checkUpdateFailed(
          displayError(error, textRef.current),
        );
        setUpdateStatusMessage(message);
        appendLog("WARN", message);
        await recordUpdateEvent("WARN", textRef.current.settings.updateFailedTitle, message);
      }
    } finally {
      setIsCheckingForUpdate(false);
    }
  }

  async function installAvailableUpdate() {
    const update = pendingUpdateRef.current;
    if (!update || isInstallingUpdate) {
      return;
    }
    setIsInstallingUpdate(true);
    const installing = textRef.current.messages.installingUpdate(update.version);
    setUpdateStatusMessage(installing);
    appendLog("INFO", installing);
    await recordUpdateEvent("INFO", textRef.current.settings.updateInstallingTitle, installing);

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setUpdateStatusMessage(textRef.current.messages.updateDownloadStarted);
        }
        if (event.event === "Finished") {
          setUpdateStatusMessage(textRef.current.messages.updateDownloadFinished);
        }
      });
      const installed = textRef.current.messages.updateInstalledRestarting;
      setUpdateStatusMessage(installed);
      appendLog("INFO", installed);
      await recordUpdateEvent("INFO", textRef.current.settings.updateInstalledTitle, installed);
      await relaunch();
    } catch (error) {
      const message = textRef.current.messages.installUpdateFailed(
        displayError(error, textRef.current),
      );
      setUpdateStatusMessage(message);
      appendLog("ERROR", message);
      await recordUpdateEvent("ERROR", textRef.current.settings.updateFailedTitle, message);
    } finally {
      setIsInstallingUpdate(false);
    }
  }

  return {
    isCheckingForUpdate,
    isInstallingUpdate,
    availableUpdate,
    updateStatusMessage,
    checkForUpdates,
    installAvailableUpdate,
  };
}

function updateInfo(update: PendingUpdate): AvailableUpdateInfo {
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    date: update.date ?? null,
    body: update.body ?? null,
  };
}

async function recordUpdateEvent(
  level: "INFO" | "WARN" | "ERROR",
  title: string,
  message: string,
) {
  try {
    await invoke("record_app_event", {
      level,
      category: "updates",
      title,
      message,
      profileId: null,
    });
  } catch {
    // Event history is helpful but should never block update checks.
  }
}
