import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  HostKeyScanResult,
  HostKeyScanState,
  KnownHostsStatus,
  Profile,
} from "../types/domain";
import type { LocaleText } from "../i18n/localeText";
import {
  displayBackendDetail,
  displayError,
  displayProfileName,
} from "../lib/display";

type AppendLog = (level: "INFO" | "WARN" | "ERROR", message: string) => void;

type UseKnownHostsControllerParams = {
  draftProfile: Profile;
  text: LocaleText;
  appendLog: AppendLog;
};

export interface PendingHostKeyReplaceRequest {
  profile: Profile;
  scan: HostKeyScanResult;
  trustRequestId: number;
}

export function useKnownHostsController({
  draftProfile,
  text,
  appendLog,
}: UseKnownHostsControllerParams) {
  const [knownHostsStatus, setKnownHostsStatus] = useState<KnownHostsStatus | null>(null);
  const [hostKeyScan, setHostKeyScan] = useState<HostKeyScanState | null>(null);
  const [isScanningHostKey, setIsScanningHostKey] = useState(false);
  const [isTrustingHostKey, setIsTrustingHostKey] = useState(false);
  const [pendingHostKeyReplace, setPendingHostKeyReplace] =
    useState<PendingHostKeyReplaceRequest | null>(null);
  const textRef = useRef(text);
  const draftProfileRef = useRef(draftProfile);
  const knownHostsRequestId = useRef(0);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    draftProfileRef.current = draftProfile;
  }, [draftProfile]);

  const hostKeyScanMatchesDraft =
    hostKeyScan?.profileId === draftProfile.id &&
    hostKeyScan?.sshHost === draftProfile.sshHost &&
    hostKeyScan?.sshPort === draftProfile.sshPort;

  async function refreshKnownHostsStatus(targetProfile = draftProfile) {
    const requestId = ++knownHostsRequestId.current;
    try {
      const result = await invoke<KnownHostsStatus>("get_known_hosts_status", {
        profile: targetProfile,
      });
      if (requestId === knownHostsRequestId.current) {
        setKnownHostsStatus(result);
      }
    } catch (error) {
      if (requestId === knownHostsRequestId.current) {
        setKnownHostsStatus({
          status: "error",
          detail: textRef.current.messages.readKnownHostsFailed(displayError(error, textRef.current)),
          marker: "",
          path: "",
          trustedKeys: [],
          trustedKeySetId: "empty",
        });
      }
    }
  }

  function resetKnownHostsState() {
    knownHostsRequestId.current += 1;
    setKnownHostsStatus(null);
    setHostKeyScan(null);
    setPendingHostKeyReplace(null);
  }

  async function scanHostKeys() {
    setIsScanningHostKey(true);
    setHostKeyScan(null);
    const scanProfile = draftProfile;
    try {
      const result = await invoke<HostKeyScanResult>("scan_host_keys", { profile: scanProfile });
      const currentDraft = draftProfileRef.current;
      if (
        currentDraft.id === scanProfile.id &&
        currentDraft.sshHost === scanProfile.sshHost &&
        currentDraft.sshPort === scanProfile.sshPort
      ) {
        setHostKeyScan({
          profileId: scanProfile.id,
          sshHost: scanProfile.sshHost,
          sshPort: scanProfile.sshPort,
          result,
        });
      }
      appendLog(
        "INFO",
        `${displayProfileName(scanProfile.name, text)} ${displayBackendDetail(result.detail, text)}`,
      );
    } catch (error) {
      appendLog("ERROR", text.messages.scanHostKeyFailed(displayError(error, text)));
    } finally {
      setIsScanningHostKey(false);
    }
  }

  function trustContextStillMatches(profile: Profile, trustRequestId: number) {
    if (knownHostsRequestId.current !== trustRequestId) {
      return false;
    }
    const currentDraft = draftProfileRef.current;
    return (
      currentDraft.id === profile.id &&
      currentDraft.sshHost === profile.sshHost &&
      currentDraft.sshPort === profile.sshPort
    );
  }

  async function performTrust(
    profile: Profile,
    scan: HostKeyScanResult,
    trustRequestId: number,
    allowReplace: boolean,
  ) {
    if (!trustContextStillMatches(profile, trustRequestId)) {
      return;
    }
    setIsTrustingHostKey(true);
    try {
      const result = await invoke<KnownHostsStatus>("trust_host_keys", {
        profile,
        request: {
          profileId: scan.profileId,
          host: scan.host,
          port: scan.port,
          hostKeys: scan.hostKeys,
          expectedMarker: scan.marker,
          expectedExistingKeySetId: scan.existingKeySetId,
          scannedKeySetId: scan.scannedKeySetId,
          allowReplace,
        },
      });
      if (trustContextStillMatches(profile, trustRequestId)) {
        knownHostsRequestId.current += 1;
        setKnownHostsStatus(result);
        setHostKeyScan(null);
        appendLog(
          "INFO",
          text.messages.trustedHostKey(displayProfileName(profile.name, text)),
        );
      }
    } catch (error) {
      appendLog("ERROR", text.messages.trustHostKeyFailed(displayError(error, text)));
    } finally {
      setIsTrustingHostKey(false);
    }
  }

  async function trustScannedHostKeys() {
    if (!hostKeyScan || !hostKeyScanMatchesDraft) {
      appendLog("ERROR", text.messages.hostKeyScanMismatch);
      return;
    }

    if (hostKeyScan.result.trustAction === "unchanged") {
      setKnownHostsStatus((current) =>
        current
          ? {
              ...current,
              status: "trusted",
              trustedKeys: hostKeyScan.result.fingerprints,
              trustedKeySetId: hostKeyScan.result.scannedKeySetId,
            }
          : current,
      );
      setHostKeyScan(null);
      appendLog("INFO", text.editor.alreadyTrusted);
      return;
    }

    if (hostKeyScan.result.trustAction === "replace") {
      setPendingHostKeyReplace({
        profile: draftProfile,
        scan: hostKeyScan.result,
        trustRequestId: knownHostsRequestId.current,
      });
      return;
    }

    await performTrust(draftProfile, hostKeyScan.result, knownHostsRequestId.current, false);
  }

  async function confirmHostKeyReplace() {
    if (!pendingHostKeyReplace) {
      return;
    }
    const request = pendingHostKeyReplace;
    setPendingHostKeyReplace(null);
    await performTrust(request.profile, request.scan, request.trustRequestId, true);
  }

  function cancelHostKeyReplace() {
    setPendingHostKeyReplace(null);
  }

  return {
    knownHostsStatus,
    hostKeyScan,
    hostKeyScanMatchesDraft,
    isScanningHostKey,
    isTrustingHostKey,
    pendingHostKeyReplace,
    refreshKnownHostsStatus,
    resetKnownHostsState,
    scanHostKeys,
    trustScannedHostKeys,
    confirmHostKeyReplace,
    cancelHostKeyReplace,
  };
}
