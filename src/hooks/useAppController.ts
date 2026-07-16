import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import type {
  AppSettings,
  DefaultProfileSettings,
  EditorTab,
  EnvironmentCheck,
  LocalProxyCandidate,
  LocalProxyDiscoveryResult,
  Profile,
  ProxyProbeResult,
  ResolvedColorMode,
  RuntimeLogMode,
  SectionKey,
  SshConfigHost,
  StartupPreferences,
  TunnelStatus,
} from "../types/domain";
import {
  FAILED_TUNNEL_STATUS_HOLD_MS,
  TRANSIENT_TUNNEL_STATUS_HOLD_MS,
  isProtectedTunnelStatus,
  isTerminalTunnelStatus,
} from "../types/domain";
import { localeText } from "../i18n/localeText";
import {
  APP_SETTINGS_STORAGE_KEY,
  type DefaultNumberSettingKey,
  clampDefaultNumberSetting,
  defaultProfileOverrides,
  loadAppSettings,
  resolveColorMode,
} from "../lib/appSettings";
import { createProfile, fallbackProfile, firstProfileValidationError, initialChecks } from "../lib/profile";
import { buildServerCommand, buildSshPreview } from "../lib/sshPreview";
import {
  displayBackendDetail,
  displayError,
  displayProfileName,
} from "../lib/display";
import { useAppLogs } from "./useAppLogs";
import { useAppEvents } from "./useAppEvents";
import { useDiagnosticBundle } from "./useDiagnosticBundle";
import { useAppUpdates } from "./useAppUpdates";
import { useKnownHostsController } from "./useKnownHostsController";
import { useSshPasswordPrompt } from "./useSshPasswordPrompt";

type TunnelStatusChangedEvent = {
  profileId: string;
  status: TunnelStatus;
};

export function useAppController() {
  const [activeSection, setActiveSection] = useState<SectionKey>("profiles");
  const [appSettings, setAppSettings] = useState<AppSettings>(() => loadAppSettings());
  const [resolvedColorMode, setResolvedColorMode] = useState<ResolvedColorMode>(() =>
    resolveColorMode(appSettings.colorMode),
  );
  const [, setChecks] = useState<EnvironmentCheck[]>(initialChecks);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [draftProfile, setDraftProfile] = useState<Profile>(fallbackProfile);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorTab, setEditorTab] = useState<EditorTab>("general");
  const [searchQuery, setSearchQuery] = useState("");
  const [tunnelStatuses, setTunnelStatuses] = useState<Record<string, TunnelStatus>>({});
  const [sshConfigHosts, setSshConfigHosts] = useState<SshConfigHost[]>([]);
  const [proxyProbe, setProxyProbe] = useState<ProxyProbeResult | null>(null);
  const [proxyDiscovery, setProxyDiscovery] = useState<LocalProxyDiscoveryResult | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isProbingProxy, setIsProbingProxy] = useState(false);
  const [isDiscoveringProxy, setIsDiscoveringProxy] = useState(false);
  const [isStartupSyncing, setIsStartupSyncing] = useState(false);
  const [runtimeLogMode, setRuntimeLogMode] = useState<RuntimeLogMode>("dock");
  const [isFloatingVisible, setIsFloatingVisible] = useState(false);
  const [pendingDiscardChange, setPendingDiscardChange] = useState<{
    resolve: (proceed: boolean) => void;
  } | null>(null);
  const text = localeText[appSettings.language];
  const {
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
    clearLogs,
    exportLogs,
    previewLogs,
    setLogPreview,
    openLastLogExportFolder,
    toggleLogLevel,
  } = useAppLogs({ appSettings, text, profiles });
  const { appEvents } = useAppEvents();
  const {
    isExportingDiagnosticBundle,
    lastDiagnosticBundle,
    exportDiagnosticBundle,
    openLastDiagnosticBundleFolder,
  } = useDiagnosticBundle({ text, appendLog });
  const {
    isCheckingForUpdate,
    isInstallingUpdate,
    availableUpdate,
    updateStatusMessage,
    checkForUpdates,
    installAvailableUpdate,
  } = useAppUpdates({ text, appendLog });
  const {
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
  } = useKnownHostsController({ draftProfile, text, appendLog });
  const {
    passwordPrompt,
    passwordValue,
    setPasswordValue,
    requestSshPassword,
    submitSshPassword,
    cancelSshPassword,
  } = useSshPasswordPrompt();
  const textRef = useRef(text);
  const tunnelStatusHoldUntilRef = useRef<Record<string, number>>({});
  const pendingDiscardResolverRef = useRef<((proceed: boolean) => void) | null>(null);

  useEffect(() => {
    return () => {
      const resolver = pendingDiscardResolverRef.current;
      pendingDiscardResolverRef.current = null;
      resolver?.(false);
    };
  }, []);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    void invoke("set_tray_language", { language: appSettings.language }).catch((error) =>
      appendLog(
        "WARN",
        textRef.current.messages.updateTrayLanguageFailed(displayError(error, textRef.current)),
      ),
    );
  }, [appSettings.language]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void listen<TunnelStatusChangedEvent>("sshnet-status-changed", ({ payload }) => {
      if (!payload?.profileId || !payload.status) {
        return;
      }
      delete tunnelStatusHoldUntilRef.current[payload.profileId];
      setTunnelStatuses((current) => ({
        ...current,
        [payload.profileId]: payload.status,
      }));
      if (payload.status.status === "running" && payload.status.lastConnectedAt) {
        const lastConnectedAt = payload.status.lastConnectedAt;
        setProfiles((currentProfiles) =>
          currentProfiles.map((profile) =>
            profile.id === payload.profileId ? { ...profile, lastConnectedAt } : profile,
          ),
        );
        setDraftProfile((currentDraft) =>
          currentDraft.id === payload.profileId
            ? { ...currentDraft, lastConnectedAt }
            : currentDraft,
        );
      }
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

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void invoke<boolean>("is_floating_window_visible")
      .then((visible) => {
        if (!disposed) {
          setIsFloatingVisible(visible);
        }
      })
      .catch(() => {});

    void listen<boolean>("floating-visibility-changed", ({ payload }) => {
      setIsFloatingVisible(Boolean(payload));
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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(appSettings));
    // Mirror language / color mode to the floating overlay window.
    void emit("sshnet-settings-changed", appSettings).catch(() => {});

    const updateResolvedColor = () => {
      setResolvedColorMode(resolveColorMode(appSettings.colorMode));
    };
    updateResolvedColor();

    if (appSettings.colorMode !== "system") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", updateResolvedColor);
    return () => media.removeEventListener("change", updateResolvedColor);
  }, [appSettings]);

  useEffect(() => {
    isAutostartEnabled()
      .then((enabled) => {
        setAppSettings((current) => ({
          ...current,
          startOnBoot: enabled,
        }));
        if (enabled) {
          void enableAutostart().catch((error) =>
            appendLog(
              "WARN",
              textRef.current.messages.updateAutostartFailed(
                displayError(error, textRef.current),
              ),
            ),
          );
        }
      })
      .catch((error) =>
        appendLog(
          "WARN",
          textRef.current.messages.readAutostartFailed(displayError(error, textRef.current)),
        ),
      );
  }, []);

  useEffect(() => {
    invoke<StartupPreferences>("get_startup_preferences")
      .then((preferences) =>
        setAppSettings((current) => ({
          ...current,
          silentStartOnBoot: preferences.silentStartOnBoot,
        })),
      )
      .catch((error) =>
        appendLog(
          "WARN",
          textRef.current.messages.readAutostartFailed(displayError(error, textRef.current)),
        ),
      );
  }, []);

  useEffect(() => {
    invoke<EnvironmentCheck[]>("get_environment_status")
      .then(setChecks)
      .catch((error) => {
        setChecks((current) =>
          current.map((check) =>
            check.key === "ssh"
              ? {
                  ...check,
                  status: "error",
                  detail: textRef.current.messages.envCheckFailed(displayError(error, textRef.current)),
                }
              : check,
          ),
        );
      });

    invoke<Profile[]>("load_profiles")
      .then((storedProfiles) => {
        const nextProfiles = storedProfiles;
        const firstProfile = nextProfiles[0] ?? null;
        setProfiles(nextProfiles);
        setSelectedProfileId(firstProfile?.id ?? "");
        setSelectedIds([]);
        setDraftProfile(firstProfile ?? fallbackProfile);
        setIsEditorOpen(false);
        setIsDirty(false);
        resetKnownHostsState();
        if (firstProfile) {
          void refreshKnownHostsStatus(firstProfile);
        }
        void refreshTunnelStatuses(nextProfiles);
      })
      .catch((error) =>
        appendLog(
          "ERROR",
          textRef.current.messages.loadProfilesFailed(displayError(error, textRef.current)),
        ),
      );

    invoke<SshConfigHost[]>("list_ssh_config_hosts")
      .then(setSshConfigHosts)
      .catch((error) =>
        appendLog(
          "WARN",
          textRef.current.messages.loadSshConfigHostsFailed(displayError(error, textRef.current)),
        ),
      );

    void refreshTunnelLogs();
    const timer = window.setInterval(() => {
      setProfiles((currentProfiles) => {
        void refreshTunnelStatuses(currentProfiles);
        return currentProfiles;
      });
      void refreshTunnelLogs();
    }, 3000);

    return () => window.clearInterval(timer);
  }, []);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0],
    [profiles, selectedProfileId],
  );

  const selectedConnection = useMemo(
    () =>
      selectedConnectionId
        ? profiles.find((profile) => profile.id === selectedConnectionId) ?? null
        : null,
    [profiles, selectedConnectionId],
  );
  const selectedConnectionStatus = selectedConnection
    ? tunnelStatuses[selectedConnection.id]
    : undefined;
  const isSelectedConnectionRunning = selectedConnectionStatus?.status === "running";

  const activeProfiles = useMemo(
    () => profiles.filter((profile) => tunnelStatuses[profile.id]?.status === "running"),
    [profiles, tunnelStatuses],
  );

  const visibleProfiles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const source = activeSection === "connections" ? activeProfiles : profiles;
    if (!query) {
      return source;
    }
    return source.filter((profile) =>
      [profile.name, profile.sshHost, profile.sshUser, String(profile.localProxyPort)]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [activeProfiles, activeSection, profiles, searchQuery]);

  const selectedProfiles = useMemo(
    () => profiles.filter((profile) => selectedIds.includes(profile.id)),
    [profiles, selectedIds],
  );
  const draftValidationError = useMemo(
    () => firstProfileValidationError(draftProfile, profiles, text),
    [draftProfile, profiles, text],
  );
  const visibleProfileIds = useMemo(
    () => new Set(visibleProfiles.map((profile) => profile.id)),
    [visibleProfiles],
  );
  const visibleSelectedProfiles = useMemo(
    () => selectedProfiles.filter((profile) => visibleProfileIds.has(profile.id)),
    [selectedProfiles, visibleProfileIds],
  );
  const invalidSelectedProfileNames = useMemo(
    () =>
      visibleSelectedProfiles
        .filter((profile) =>
          Boolean(
            firstProfileValidationError(
              profile.id === draftProfile.id ? draftProfile : profile,
              profiles,
              text,
            ),
          ),
        )
        .map((profile) => displayProfileName(profile.name, text)),
    [draftProfile, profiles, text, visibleSelectedProfiles],
  );

  const runningCount = profiles.filter(
    (profile) => tunnelStatuses[profile.id]?.status === "running",
  ).length;
  const serverCommand = buildServerCommand(draftProfile);
  const sshPreview = buildSshPreview(draftProfile);
  const isWorkspaceSection = activeSection === "profiles" || activeSection === "connections";
  const showInlineLogs = isWorkspaceSection && runtimeLogMode !== "hidden";
  const canShowEditor =
    isEditorOpen &&
    activeSection === "profiles" &&
    !!selectedProfile &&
    (isDirty || visibleProfileIds.has(selectedProfile.id));
  const canShowConnectionDetails =
    activeSection === "connections" && selectedConnection !== null;
  const isRightPanelOpen = canShowEditor || canShowConnectionDetails;
  const hasVisibleSelection = visibleSelectedProfiles.length > 0;
  const hasSingleVisibleSelection = visibleSelectedProfiles.length === 1;
  // Reordering rearranges the stored profile array, so it is only allowed when the
  // visible list matches that array 1:1 — i.e. the full Profiles view with no search
  // filter and no unsaved edits in flight.
  const canReorderProfiles =
    activeSection === "profiles" && !searchQuery.trim() && !isDirty && !isBusy && !isSaving;

  useEffect(() => {
    if (selectedProfile && selectedProfile.id !== draftProfile.id && !isDirty) {
      setDraftProfile(selectedProfile);
      setProxyProbe(null);
      setProxyDiscovery(null);
      resetKnownHostsState();
      void refreshKnownHostsStatus(selectedProfile);
    }
  }, [draftProfile.id, isDirty, selectedProfile]);

  async function refreshTunnelStatuses(targetProfiles = profiles) {
    const currentText = textRef.current;
    const pairs = await Promise.all(
      targetProfiles.map(async (profile) => {
        try {
          const status = await invoke<TunnelStatus>("get_tunnel_status", {
            profileId: profile.id,
          });
          return [profile.id, status] as const;
        } catch (error) {
          return [
            profile.id,
            {
              status: "failed",
              detail: currentText.messages.readStatusFailed(displayError(error, currentText)),
              pid: null,
              lastConnectedAt: profile.lastConnectedAt ?? null,
            } satisfies TunnelStatus,
          ] as const;
        }
      }),
    );
    const incoming: Record<string, TunnelStatus> = Object.fromEntries(pairs);
    const now = Date.now();
    setTunnelStatuses((current) => {
      const next = { ...current };
      for (const [profileId, status] of Object.entries(incoming)) {
        const holdUntil = tunnelStatusHoldUntilRef.current[profileId] ?? 0;
        if (
          holdUntil > now &&
          isProtectedTunnelStatus(current[profileId]?.status) &&
          !isTerminalTunnelStatus(status.status)
        ) {
          continue;
        }
        delete tunnelStatusHoldUntilRef.current[profileId];
        next[profileId] = status;
      }
      return next;
    });
  }

  function scheduleStartupStatusRefresh(targetProfiles: Profile[]) {
    for (const delay of [500, 1200, 2200, 3600]) {
      window.setTimeout(() => {
        void refreshTunnelStatuses(targetProfiles);
        void refreshTunnelLogs();
      }, delay);
    }
  }

  function setTransientTunnelStatus(
    profile: Profile,
    status: TunnelStatus["status"],
    detail: string,
  ) {
    tunnelStatusHoldUntilRef.current[profile.id] =
      Date.now() + TRANSIENT_TUNNEL_STATUS_HOLD_MS;
    setTunnelStatuses((current) => ({
      ...current,
      [profile.id]: { status, detail, pid: null },
    }));
  }

  function clearTunnelStatusHold(profileId: string) {
    delete tunnelStatusHoldUntilRef.current[profileId];
  }

  function setFailedTunnelStatus(profile: Profile, detail: string) {
    tunnelStatusHoldUntilRef.current[profile.id] = Date.now() + FAILED_TUNNEL_STATUS_HOLD_MS;
    setTunnelStatuses((current) => ({
      ...current,
      [profile.id]: { status: "failed", detail, pid: null },
    }));
  }

  function requestDiscardConfirm(): Promise<boolean> {
    if (!isDirty) {
      return Promise.resolve(true);
    }
    const stale = pendingDiscardResolverRef.current;
    pendingDiscardResolverRef.current = null;
    stale?.(false);
    return new Promise<boolean>((resolve) => {
      pendingDiscardResolverRef.current = resolve;
      setPendingDiscardChange({ resolve });
    });
  }

  function confirmDiscardChange() {
    const resolver = pendingDiscardResolverRef.current;
    pendingDiscardResolverRef.current = null;
    setPendingDiscardChange(null);
    resolver?.(true);
  }

  function cancelDiscardChange() {
    const resolver = pendingDiscardResolverRef.current;
    pendingDiscardResolverRef.current = null;
    setPendingDiscardChange(null);
    resolver?.(false);
  }

  async function selectProfile(profile: Profile) {
    const isSameDraft = profile.id === draftProfile.id;
    if (!isSameDraft) {
      const proceed = await requestDiscardConfirm();
      if (!proceed) {
        return;
      }
      setSelectedProfileId(profile.id);
      setDraftProfile(profile);
      setIsDirty(false);
      setProxyProbe(null);
      setProxyDiscovery(null);
      resetKnownHostsState();
      void refreshKnownHostsStatus(profile);
    } else {
      setSelectedProfileId(profile.id);
    }
    setIsEditorOpen(true);
  }

  function selectConnection(profile: Profile) {
    setSelectedConnectionId(profile.id);
  }

  function clearSelectedConnection() {
    setSelectedConnectionId(null);
  }

  async function openProfileEditor(profile: Profile) {
    const isSameDraft = profile.id === draftProfile.id;
    if (!isSameDraft) {
      const proceed = await requestDiscardConfirm();
      if (!proceed) {
        return;
      }
      setSelectedProfileId(profile.id);
      setDraftProfile(profile);
      setIsDirty(false);
      setProxyProbe(null);
      setProxyDiscovery(null);
      resetKnownHostsState();
      void refreshKnownHostsStatus(profile);
    } else {
      setSelectedProfileId(profile.id);
    }
    setIsEditorOpen(true);
    setSearchQuery("");
    setActiveSection("profiles");
  }

  function toggleSelected(id: string) {
    const isSelected = selectedIds.includes(id);
    if (isSelected) {
      setSelectedIds((current) => current.filter((item) => item !== id));
      return;
    }

    setSelectedIds((current) => [...current, id]);
  }

  function toggleSelectAll() {
    const visibleIds = visibleProfiles.map((profile) => profile.id);
    if (!visibleIds.length) {
      setSelectedIds([]);
      return;
    }
    const allVisibleSelected = visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allVisibleSelected ? [] : visibleIds);
  }

  function editSelectedProfile() {
    if (!hasSingleVisibleSelection) {
      return;
    }
    void selectProfile(visibleSelectedProfiles[0]);
  }

  function updateDraft<K extends keyof Profile>(key: K, value: Profile[K]) {
    setDraftProfile((current) => ({ ...current, [key]: value }));
    setIsDirty(true);
    if (key === "localProxyPort" || key === "localProxyProtocol") {
      setProxyProbe(null);
      setProxyDiscovery(null);
    }
    if (key === "sshHost" || key === "sshPort") {
      resetKnownHostsState();
    }
  }

  function updateNumberField(
    key:
      | "localProxyPort"
      | "sshPort"
      | "remoteProxyPort"
      | "connectTimeoutSeconds"
      | "reconnectIntervalSeconds",
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const parsed = Number(event.currentTarget.value);
    updateDraft(key, Number.isFinite(parsed) ? parsed : 0);
  }

  function updateNoProxy(value: string) {
    updateDraft(
      "noProxy",
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
  }

  function updateAppSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setAppSettings((current) => ({ ...current, [key]: value }));
  }

  function updateDefaultProfileSetting<K extends keyof DefaultProfileSettings>(
    key: K,
    value: DefaultProfileSettings[K],
  ) {
    setAppSettings((current) => ({
      ...current,
      defaultProfile: {
        ...current.defaultProfile,
        [key]: value,
      },
    }));
  }

  function updateDefaultNumberSetting(
    key: DefaultNumberSettingKey,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const parsed = event.currentTarget.valueAsNumber;
    if (!Number.isFinite(parsed)) {
      return;
    }
    updateDefaultProfileSetting(key, clampDefaultNumberSetting(key, parsed));
  }

  function updateDefaultNoProxy(value: string) {
    updateDefaultProfileSetting(
      "noProxy",
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
  }

  async function persistProfiles(nextProfiles: Profile[], message = text.messages.saved) {
    setIsSaving(true);
    try {
      const saved = await invoke<Profile[]>("save_profiles", { profiles: nextProfiles });
      const nextDraft =
        saved.find((profile) => profile.id === draftProfile.id) ?? saved[0] ?? fallbackProfile;
      setProfiles(saved);
      setDraftProfile(
        (current) => saved.find((profile) => profile.id === current.id) ?? saved[0] ?? fallbackProfile,
      );
      if (!saved.length) {
        setSelectedProfileId("");
        setSelectedIds([]);
        setSelectedConnectionId(null);
        setIsEditorOpen(false);
        resetKnownHostsState();
      } else if (!saved.some((profile) => profile.id === selectedProfileId)) {
        setSelectedProfileId(nextDraft.id);
      }
      setIsDirty(false);
      appendLog("INFO", message);
      void refreshTunnelStatuses(saved);
      return saved;
    } catch (error) {
      appendLog("ERROR", text.messages.saveProfilesFailed(displayError(error, text)));
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  async function persistReorderedProfiles(nextProfiles: Profile[]) {
    const previousProfiles = profiles;
    setProfiles(nextProfiles);
    try {
      const saved = await invoke<Profile[]>("save_profiles", { profiles: nextProfiles });
      setProfiles(saved);
    } catch (error) {
      setProfiles(previousProfiles);
      appendLog("ERROR", text.messages.saveProfilesFailed(displayError(error, text)));
    }
  }

  function reorderProfiles(sourceId: string, targetId: string) {
    if (!canReorderProfiles || sourceId === targetId) {
      return;
    }
    const fromIndex = profiles.findIndex((profile) => profile.id === sourceId);
    const toIndex = profiles.findIndex((profile) => profile.id === targetId);
    if (fromIndex < 0 || toIndex < 0) {
      return;
    }
    const nextProfiles = [...profiles];
    const [moved] = nextProfiles.splice(fromIndex, 1);
    nextProfiles.splice(toIndex, 0, moved);
    void persistReorderedProfiles(nextProfiles);
  }

  function moveProfile(profileId: string, direction: -1 | 1) {
    if (!canReorderProfiles) {
      return;
    }
    const index = profiles.findIndex((profile) => profile.id === profileId);
    if (index < 0) {
      return;
    }
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= profiles.length) {
      return;
    }
    const nextProfiles = [...profiles];
    [nextProfiles[index], nextProfiles[targetIndex]] = [
      nextProfiles[targetIndex],
      nextProfiles[index],
    ];
    void persistReorderedProfiles(nextProfiles);
  }

  async function saveDraft() {
    const validationError = firstProfileValidationError(draftProfile, profiles, text);
    if (validationError) {
      appendLog("ERROR", text.messages.invalidProfile(validationError));
      return null;
    }
    const nextProfiles = profiles.some((profile) => profile.id === draftProfile.id)
      ? profiles.map((profile) => (profile.id === draftProfile.id ? draftProfile : profile))
      : [...profiles, draftProfile];
    const saved = await persistProfiles(
      nextProfiles,
      text.messages.profileSaved(displayProfileName(draftProfile.name, text)),
    );
    return saved?.find((profile) => profile.id === draftProfile.id) ?? null;
  }

  async function createNewProfile() {
    const proceed = await requestDiscardConfirm();
    if (!proceed) {
      return;
    }

    const profile = createProfile({
      ...defaultProfileOverrides(appSettings),
      name: text.profile.newName(profiles.length + 1),
      remoteProxyPort: 27890 + profiles.length,
    });
    setSearchQuery("");
    setActiveSection("profiles");
    setProfiles((current) => [...current, profile]);
    setSelectedProfileId(profile.id);
    setSelectedIds([profile.id]);
    setDraftProfile(profile);
    setIsDirty(true);
    setProxyProbe(null);
    setProxyDiscovery(null);
    resetKnownHostsState();
    setIsEditorOpen(true);
  }

  async function copyProfile() {
    if (!hasSingleVisibleSelection) {
      return;
    }
    const proceed = await requestDiscardConfirm();
    if (!proceed) {
      return;
    }

    const source = visibleSelectedProfiles[0];
    const profile = createProfile({
      ...source,
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `profile-${Date.now()}`,
      name: text.profile.cloneName(source.name),
      remoteProxyPort: source.remoteProxyPort + 1,
    });
    setProfiles((current) => [...current, profile]);
    setSelectedProfileId(profile.id);
    setSelectedIds([profile.id]);
    setDraftProfile(profile);
    setIsDirty(true);
    setProxyProbe(null);
    setProxyDiscovery(null);
    resetKnownHostsState();
    setIsEditorOpen(true);
  }

  async function deleteSelectedProfiles() {
    const targets = visibleSelectedProfiles;
    if (!targets.length) {
      return;
    }
    if (targets.some((profile) => profile.id === draftProfile.id)) {
      const proceed = await requestDiscardConfirm();
      if (!proceed) {
        return;
      }
    }

    for (const profile of targets) {
      if (tunnelStatuses[profile.id]?.status === "running") {
        await stopProfiles([profile]);
      }
    }
    const targetIds = new Set(targets.map((profile) => profile.id));
    const nextProfiles = profiles.filter((profile) => !targetIds.has(profile.id));
    const nextSelectedProfile = nextProfiles[0] ?? null;
    setSelectedProfileId(nextSelectedProfile?.id ?? "");
    setSelectedIds([]);
    setDraftProfile(nextSelectedProfile ?? fallbackProfile);
    setProxyProbe(null);
    setProxyDiscovery(null);
    resetKnownHostsState();
    if (targetIds.has(draftProfile.id)) {
      setIsEditorOpen(false);
    }
    if (selectedConnectionId && targetIds.has(selectedConnectionId)) {
      setSelectedConnectionId(null);
    }
    await persistProfiles(nextProfiles, text.messages.deletedProfiles(targets.length));
    if (nextSelectedProfile) {
      void refreshKnownHostsStatus(nextSelectedProfile);
    }
  }

  async function probeLocalProxy() {
    setIsBusy(true);
    setIsProbingProxy(true);
    try {
      const result = await invoke<ProxyProbeResult>("probe_local_proxy", { profile: draftProfile });
      setProxyProbe(result);
      if (result.protocol && result.protocol !== draftProfile.localProxyProtocol) {
        updateDraft("localProxyProtocol", result.protocol);
      }
      appendLog("INFO", displayBackendDetail(result.detail, text));
    } catch (error) {
      const detail = text.messages.probeFailed(displayError(error, text));
      setProxyProbe({ reachable: false, protocol: null, detail });
      appendLog("ERROR", detail);
    } finally {
      setIsBusy(false);
      setIsProbingProxy(false);
    }
  }

  function applyProxyCandidate(candidate: LocalProxyCandidate) {
    setDraftProfile((current) => ({
      ...current,
      localProxyPort: candidate.port,
      localProxyProtocol: candidate.protocol,
    }));
    setIsDirty(true);
    setProxyProbe({
      reachable: true,
      protocol: candidate.protocol,
      detail: text.messages.adoptedProxy(candidate.host, candidate.port, candidate.source),
    });
  }

  function applySshConfigHost(alias: string) {
    const configHost = sshConfigHosts.find((host) => host.alias === alias);
    if (!configHost) {
      return;
    }

    setDraftProfile((current) => ({
      ...current,
      sshHost: configHost.hostName?.trim() || configHost.alias,
      sshUser: configHost.user?.trim() || current.sshUser,
      sshPort: configHost.port ?? current.sshPort,
      authMethod: configHost.identityFile ? "key" : current.authMethod,
      privateKeyPath: configHost.identityFile?.trim() || current.privateKeyPath,
    }));
    setIsDirty(true);
    resetKnownHostsState();
  }

  async function discoverLocalProxy() {
    setIsBusy(true);
    setIsDiscoveringProxy(true);
    try {
      const result = await invoke<LocalProxyDiscoveryResult>("discover_local_proxies", {
        profile: draftProfile,
      });
      setProxyDiscovery(result);
      appendLog("INFO", displayBackendDetail(result.detail, text));
      if (result.candidates[0]) {
        applyProxyCandidate(result.candidates[0]);
      }
    } catch (error) {
      appendLog("ERROR", text.messages.discoverProxyFailed(displayError(error, text)));
    } finally {
      setIsBusy(false);
      setIsDiscoveringProxy(false);
    }
  }

  async function resolveSshPasswordSecret(profile: Profile) {
    if (profile.authMethod !== "password") {
      return undefined;
    }

    if (profile.rememberSshPassword) {
      try {
        const hasSavedPassword = await invoke<boolean>("has_saved_ssh_password", {
          profileId: profile.id,
        });
        if (hasSavedPassword) {
          return undefined;
        }
      } catch {
        // If the credential check fails, fall through to a one-time prompt so the user can still start.
      }
      appendLog("INFO", text.messages.savedPasswordMissing(displayProfileName(profile.name, text)));
    }

    return requestSshPassword(profile);
  }

  async function forgetSavedSshPassword(profile: Profile) {
    try {
      await invoke("forget_saved_ssh_password", { profileId: profile.id });
      appendLog("INFO", text.messages.forgotSavedPassword(displayProfileName(profile.name, text)));
    } catch (error) {
      appendLog("ERROR", text.messages.forgetSavedPasswordFailed(displayError(error, text)));
    }
  }

  async function startProfiles(
    targetProfiles = visibleSelectedProfiles,
  ) {
    if (!targetProfiles.length) {
      return;
    }
    const invalidTarget = targetProfiles
      .map((profile) => (profile.id === draftProfile.id ? draftProfile : profile))
      .find((profile) => firstProfileValidationError(profile, profiles, text));
    if (invalidTarget) {
      const validationError = firstProfileValidationError(invalidTarget, profiles, text);
      appendLog("ERROR", text.messages.invalidProfile(validationError ?? invalidTarget.name));
      return;
    }
    setIsBusy(true);
    try {
      let profilesToStart = targetProfiles;
      if (isDirty && targetProfiles.some((profile) => profile.id === draftProfile.id)) {
        const savedDraft = await saveDraft();
        if (!savedDraft) {
          appendLog("ERROR", text.messages.saveBeforeStartFailed);
          return;
        }
        profilesToStart = targetProfiles.map((profile) =>
          profile.id === savedDraft.id ? savedDraft : profile,
        );
      }

      for (const profile of profilesToStart) {
        const profileToStart = profile.id === draftProfile.id && !isDirty ? draftProfile : profile;
        appendLog(
          "INFO",
          text.messages.startingProfile(displayProfileName(profileToStart.name, text)),
        );
        const authSecret = await resolveSshPasswordSecret(profileToStart);
        if (profileToStart.authMethod === "password" && authSecret === null) {
          appendLog(
            "WARN",
            text.messages.passwordCancelled(displayProfileName(profileToStart.name, text)),
          );
          continue;
        }
        const currentStatus = tunnelStatuses[profileToStart.id]?.status;
        setTransientTunnelStatus(
          profileToStart,
          currentStatus === "failed"
            ? "reconnecting"
            : profileToStart.authMethod === "password"
              ? "authenticating"
              : "connecting",
          currentStatus === "failed"
            ? text.table.tunnelReconnectingDetail
            : profileToStart.authMethod === "password"
            ? text.table.tunnelAuthenticatingDetail
            : text.table.tunnelConnectingDetail,
        );
        try {
          const status = await invoke<TunnelStatus>("start_tunnel", {
            profile: profileToStart,
            authSecret,
          });
          clearTunnelStatusHold(profileToStart.id);
          setTunnelStatuses((current) => ({ ...current, [profileToStart.id]: status }));
          if (status.status === "running") {
            const lastConnectedAt = status.lastConnectedAt ?? Date.now();
            setProfiles((currentProfiles) =>
              currentProfiles.map((item) =>
                item.id === profileToStart.id ? { ...item, lastConnectedAt } : item,
              ),
            );
            setDraftProfile((currentDraft) =>
              currentDraft.id === profileToStart.id
                ? { ...currentDraft, lastConnectedAt }
                : currentDraft,
            );
            scheduleStartupStatusRefresh([profileToStart]);
          }
          appendLog("INFO", displayBackendDetail(status.detail, text));
        } catch (error) {
          const detail = text.messages.startFailed(displayError(error, text));
          setFailedTunnelStatus(profileToStart, detail);
          appendLog("ERROR", detail);
        }
      }
    } catch (error) {
      appendLog("ERROR", text.messages.startFailed(displayError(error, text)));
    } finally {
      setIsBusy(false);
      void refreshTunnelStatuses(profiles);
      void refreshTunnelLogs();
    }
  }

  async function stopProfiles(
    targetProfiles = visibleSelectedProfiles,
  ) {
    if (!targetProfiles.length) {
      return;
    }
    setIsBusy(true);
    try {
      for (const profile of targetProfiles) {
        setTransientTunnelStatus(profile, "stopping", text.table.tunnelStoppingDetail);
        try {
          const status = await invoke<TunnelStatus>("stop_tunnel", { profileId: profile.id });
          clearTunnelStatusHold(profile.id);
          setTunnelStatuses((current) => ({ ...current, [profile.id]: status }));
          appendLog(
            "INFO",
            `${displayProfileName(profile.name, text)} ${displayBackendDetail(status.detail, text)}`,
          );
        } catch (error) {
          const detail = text.messages.stopFailed(displayError(error, text));
          setFailedTunnelStatus(profile, detail);
          appendLog("ERROR", detail);
        }
      }
    } catch (error) {
      appendLog("ERROR", text.messages.stopFailed(displayError(error, text)));
    } finally {
      setIsBusy(false);
      void refreshTunnelLogs();
    }
  }

  async function copyServerCommand(target?: Profile): Promise<boolean> {
    const profile = target ?? draftProfile;
    const command = target ? buildServerCommand(target) : serverCommand;
    try {
      await navigator.clipboard.writeText(command);
      appendLog("INFO", text.messages.copiedServerCommand(displayProfileName(profile.name, text)));
      return true;
    } catch (error) {
      appendLog("ERROR", text.messages.copyServerCommandFailed(displayError(error, text)));
      return false;
    }
  }

  async function copySshCommand(target?: Profile): Promise<boolean> {
    const profile = target ?? draftProfile;
    const command = target ? buildSshPreview(target) : sshPreview;
    try {
      await navigator.clipboard.writeText(command);
      appendLog("INFO", text.messages.copiedSshCommand(displayProfileName(profile.name, text)));
      return true;
    } catch (error) {
      appendLog("ERROR", text.messages.copySshCommandFailed(displayError(error, text)));
      return false;
    }
  }

  function statusClass(profile: Profile) {
    return tunnelStatuses[profile.id]?.status ?? "stopped";
  }

  async function toggleFloatingWindow() {
    try {
      await invoke("toggle_floating_window");
    } catch (error) {
      appendLog("WARN", text.messages.readStatusFailed(displayError(error, text)));
    }
  }

  function changeSection(section: SectionKey) {
    setActiveSection(section);
    if (section === "logs" || section === "settings") {
      setIsEditorOpen(false);
    }
  }

  function viewProfileLogs(profile: Profile) {
    setLogProfileFilter(profile.id);
    changeSection("logs");
  }

  async function toggleStartOnBoot() {
    const nextValue = !appSettings.startOnBoot;
    setIsStartupSyncing(true);
    try {
      if (nextValue) {
        await enableAutostart();
      } else {
        await disableAutostart();
      }
      updateAppSetting("startOnBoot", nextValue);
    } catch (error) {
      appendLog("ERROR", text.messages.updateAutostartFailed(displayError(error, text)));
      try {
        const enabled = await isAutostartEnabled();
        updateAppSetting("startOnBoot", enabled);
      } catch {
        updateAppSetting("startOnBoot", !nextValue);
      }
    } finally {
      setIsStartupSyncing(false);
    }
  }

  async function toggleSilentStartOnBoot() {
    const nextValue = !appSettings.silentStartOnBoot;
    setIsStartupSyncing(true);
    try {
      const preferences = await invoke<StartupPreferences>("set_startup_preferences", {
        preferences: { silentStartOnBoot: nextValue },
      });
      updateAppSetting("silentStartOnBoot", preferences.silentStartOnBoot);
    } catch (error) {
      appendLog("ERROR", text.messages.updateAutostartFailed(displayError(error, text)));
    } finally {
      setIsStartupSyncing(false);
    }
  }
  return {
    activeSection, appSettings, resolvedColorMode, profiles, selectedProfileId, selectedIds,
    selectedConnection, selectedConnectionId, selectedConnectionStatus, isSelectedConnectionRunning,
    draftProfile, isDirty, isSaving, isEditorOpen, editorTab, searchQuery, tunnelStatuses,
    sshConfigHosts, knownHostsStatus, hostKeyScan, proxyProbe, proxyDiscovery, isBusy,
    isProbingProxy, isDiscoveringProxy,
    isScanningHostKey, isTrustingHostKey, isStartupSyncing, isExportingLogs, isPreviewingLogs,
    lastLogExport, logPreview, logStorageInfo, appEvents,
    isExportingDiagnosticBundle, lastDiagnosticBundle,
    isCheckingForUpdate, isInstallingUpdate, availableUpdate, updateStatusMessage,
    runtimeLogMode, logLevelFilter, logProfileFilter, logFromDateTime, logToDateTime,
    isFloatingVisible,
    passwordPrompt, passwordValue, text,
    visibleProfiles, renderedLogLines, runtimeLogLines, draftValidationError, visibleSelectedProfiles,
    invalidSelectedProfileNames, runningCount, serverCommand, sshPreview, hostKeyScanMatchesDraft,
    pendingHostKeyReplace, pendingDiscardChange,
    isWorkspaceSection, showInlineLogs, canShowEditor, canShowConnectionDetails, isRightPanelOpen,
    hasVisibleSelection, hasSingleVisibleSelection, canReorderProfiles,
    setEditorTab, setIsEditorOpen, setSearchQuery, setRuntimeLogMode, setLogProfileFilter,
    setLogFromDateTime, setLogToDateTime,
    setPasswordValue, appendLog, changeSection, toggleStartOnBoot, updateAppSetting,
    updateDefaultProfileSetting, updateDefaultNumberSetting, updateDefaultNoProxy, createNewProfile,
    startProfiles, stopProfiles, editSelectedProfile, copyProfile, deleteSelectedProfiles,
    toggleSelectAll, toggleSelected, selectProfile, selectConnection, clearSelectedConnection,
    reorderProfiles, moveProfile,
    openProfileEditor, viewProfileLogs, statusClass, exportLogs, previewLogs, setLogPreview,
    openLastLogExportFolder, exportDiagnosticBundle, openLastDiagnosticBundleFolder,
    checkForUpdates, installAvailableUpdate,
    toggleFloatingWindow,
    clearLogs, toggleLogLevel, toggleSilentStartOnBoot, updateDraft, updateNumberField,
    updateNoProxy, probeLocalProxy,
    discoverLocalProxy, applyProxyCandidate, applySshConfigHost, scanHostKeys, trustScannedHostKeys,
    confirmHostKeyReplace, cancelHostKeyReplace,
    confirmDiscardChange, cancelDiscardChange,
    forgetSavedSshPassword, copySshCommand, copyServerCommand, saveDraft, submitSshPassword,
    cancelSshPassword,
  };
}

export type AppController = ReturnType<typeof useAppController>;
