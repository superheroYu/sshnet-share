import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { DiagnosticBundleResult } from "../types/domain";
import type { LocaleText } from "../i18n/localeText";
import { displayBackendDetail, displayError } from "../lib/display";

type AppendLog = (level: "INFO" | "WARN" | "ERROR", message: string) => void;

type UseDiagnosticBundleParams = {
  text: LocaleText;
  appendLog: AppendLog;
};

export function useDiagnosticBundle({ text, appendLog }: UseDiagnosticBundleParams) {
  const [isExportingDiagnosticBundle, setIsExportingDiagnosticBundle] = useState(false);
  const [lastDiagnosticBundle, setLastDiagnosticBundle] =
    useState<DiagnosticBundleResult | null>(null);

  async function exportDiagnosticBundle() {
    setIsExportingDiagnosticBundle(true);
    try {
      const result = await invoke<DiagnosticBundleResult>("export_diagnostic_bundle");
      setLastDiagnosticBundle(result);
      appendLog("INFO", displayBackendDetail(result.detail, text));
    } catch (error) {
      appendLog("ERROR", text.messages.exportDiagnosticBundleFailed(displayError(error, text)));
    } finally {
      setIsExportingDiagnosticBundle(false);
    }
  }

  async function openLastDiagnosticBundleFolder() {
    if (!lastDiagnosticBundle) {
      return;
    }
    try {
      await revealItemInDir(lastDiagnosticBundle.path);
    } catch (error) {
      appendLog(
        "ERROR",
        text.messages.openDiagnosticBundleFolderFailed(displayError(error, text)),
      );
    }
  }

  return {
    isExportingDiagnosticBundle,
    lastDiagnosticBundle,
    exportDiagnosticBundle,
    openLastDiagnosticBundleFolder,
  };
}
