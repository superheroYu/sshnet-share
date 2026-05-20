import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Activity,
  Archive,
  Bell,
  FolderOpen,
  Github,
  HelpCircle,
  Info,
  List,
  MoreVertical,
  PanelBottomOpen,
  Play,
  Plus,
  Settings,
  Terminal,
} from "lucide-react";
import type { AppController } from "../../hooks/useAppController";
import type { Profile } from "../../types/domain";
import { APP_INFO } from "../../lib/appInfo";
import { displayProfileName, formatHostKeyFingerprint } from "../../lib/display";
import { ConnectionDetailsPanel } from "../connections/ConnectionDetailsPanel";
import { EditorPanel } from "../editor/EditorPanel";
import { LogControls } from "../logViewer/LogControls";
import { LogPage } from "../logViewer/LogPage";
import { ProfilesWorkspace } from "../profiles/ProfilesWorkspace";
import { SettingsPage } from "../settings/SettingsPage";

export function AppView({ controller }: { controller: AppController }) {
  const windowToolsRef = useRef<HTMLDivElement>(null);
  const [openWindowPanel, setOpenWindowPanel] = useState<
    "notifications" | "help" | "more" | null
  >(null);
  const [forgetPasswordConfirmProfile, setForgetPasswordConfirmProfile] =
    useState<Profile | null>(null);
  const [isClearLogsConfirmOpen, setIsClearLogsConfirmOpen] = useState(false);
  const [deleteConfirmProfiles, setDeleteConfirmProfiles] = useState<Profile[] | null>(null);
  const changeSectionRef = useRef<AppController["changeSection"] | null>(null);
  const {
    activeSection,
    appSettings,
    resolvedColorMode,
    profiles,
    selectedProfileId,
    selectedConnection,
    selectedConnectionId,
    selectedConnectionStatus,
    isSelectedConnectionRunning,
    selectedIds,
    draftProfile,
    isDirty,
    isSaving,
    editorTab,
    searchQuery,
    tunnelStatuses,
    sshConfigHosts,
    knownHostsStatus,
    hostKeyScan,
    proxyProbe,
    proxyDiscovery,
    isBusy,
    isProbingProxy,
    isDiscoveringProxy,
    isScanningHostKey,
    isTrustingHostKey,
    isStartupSyncing,
    isExportingLogs,
    isPreviewingLogs,
    lastLogExport,
    logPreview,
    logStorageInfo,
    appEvents,
    isExportingDiagnosticBundle,
    lastDiagnosticBundle,
    isCheckingForUpdate,
    isInstallingUpdate,
    availableUpdate,
    updateStatusMessage,
    runtimeLogMode,
    logLevelFilter,
    logProfileFilter,
    logFromDateTime,
    logToDateTime,
    passwordPrompt,
    passwordValue,
    text,
    visibleProfiles,
    renderedLogLines,
    draftValidationError,
    visibleSelectedProfiles,
    invalidSelectedProfileNames,
    runningCount,
    serverCommand,
    sshPreview,
    hostKeyScanMatchesDraft,
    pendingHostKeyReplace,
    pendingDiscardChange,
    isWorkspaceSection,
    showInlineLogs,
    canShowEditor,
    canShowConnectionDetails,
    isRightPanelOpen,
    hasVisibleSelection,
    hasSingleVisibleSelection,
    setEditorTab,
    setIsEditorOpen,
    setSearchQuery,
    setRuntimeLogMode,
    setLogProfileFilter,
    setLogFromDateTime,
    setLogToDateTime,
    setPasswordValue,
    changeSection,
    toggleStartOnBoot,
    updateAppSetting,
    updateDefaultProfileSetting,
    updateDefaultNumberSetting,
    updateDefaultNoProxy,
    createNewProfile,
    startProfiles,
    stopProfiles,
    editSelectedProfile,
    copyProfile,
    deleteSelectedProfiles,
    toggleSelectAll,
    toggleSelected,
    selectProfile,
    selectConnection,
    clearSelectedConnection,
    openProfileEditor,
    viewProfileLogs,
    statusClass,
    exportLogs,
    previewLogs,
    setLogPreview,
    openLastLogExportFolder,
    exportDiagnosticBundle,
    openLastDiagnosticBundleFolder,
    checkForUpdates,
    installAvailableUpdate,
    clearLogs,
    toggleLogLevel,
    toggleSilentStartOnBoot,
    updateDraft,
    updateNumberField,
    updateNoProxy,
    probeLocalProxy,
    discoverLocalProxy,
    applyProxyCandidate,
    applySshConfigHost,
    scanHostKeys,
    trustScannedHostKeys,
    confirmHostKeyReplace,
    cancelHostKeyReplace,
    confirmDiscardChange,
    cancelDiscardChange,
    forgetSavedSshPassword,
    copySshCommand,
    copyServerCommand,
    saveDraft,
    submitSshPassword,
    cancelSshPassword,
  } = controller;

  function requestClearLogs() {
    setIsClearLogsConfirmOpen(true);
  }

  function confirmClearLogs() {
    setIsClearLogsConfirmOpen(false);
    void clearLogs();
  }

  function requestDeleteSelectedProfiles() {
    if (!visibleSelectedProfiles.length) {
      return;
    }
    setDeleteConfirmProfiles(visibleSelectedProfiles);
  }

  function confirmDeleteSelectedProfiles() {
    setDeleteConfirmProfiles(null);
    void deleteSelectedProfiles();
  }

  useEffect(() => {
    if (!openWindowPanel) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !windowToolsRef.current?.contains(event.target)
      ) {
        setOpenWindowPanel(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenWindowPanel(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openWindowPanel]);

  useEffect(() => {
    setOpenWindowPanel(null);
  }, [activeSection]);

  useEffect(() => {
    changeSectionRef.current = changeSection;
  }, [changeSection]);

  useEffect(() => {
    if (!pendingHostKeyReplace) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancelHostKeyReplace();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [pendingHostKeyReplace, cancelHostKeyReplace]);

  useEffect(() => {
    if (!pendingDiscardChange) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancelDiscardChange();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [pendingDiscardChange, cancelDiscardChange]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void listen("tray-show-logs", () => {
      changeSectionRef.current?.("logs");
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

  function confirmForgetSavedPassword() {
    if (!forgetPasswordConfirmProfile) {
      return;
    }
    const profile = forgetPasswordConfirmProfile;
    setForgetPasswordConfirmProfile(null);
    void forgetSavedSshPassword(profile);
  }

  return (
    <main
      className={`app-frame theme-${resolvedColorMode} ${
        isRightPanelOpen ? "with-editor" : "editor-closed"
      }`}
    >
      <header className="titlebar">
        <div className="app-title">
          <img src="/icon.png" alt="" />
          <strong>SSHNet Share</strong>
        </div>

        <nav className="top-tabs" aria-label={text.nav.label}>
          <button
            type="button"
            className={activeSection === "profiles" ? "active" : ""}
            onClick={() => changeSection("profiles")}
          >
            {text.nav.profiles}
          </button>
          <button
            type="button"
            className={activeSection === "connections" ? "active" : ""}
            onClick={() => changeSection("connections")}
          >
            {text.nav.connections}
          </button>
          <button
            type="button"
            className={activeSection === "logs" ? "active" : ""}
            onClick={() => changeSection("logs")}
          >
            {text.nav.logs}
          </button>
          <button
            type="button"
            className={activeSection === "settings" ? "active" : ""}
            onClick={() => changeSection("settings")}
          >
            {text.nav.settings}
          </button>
        </nav>

        <div className="window-tools" ref={windowToolsRef}>
          <span className="service-pill">
            <span className="status-led" />
            {text.window.serviceRunning}
          </span>
          <div className="window-tool-item">
            <button
              type="button"
              title={text.window.notifications}
              aria-expanded={openWindowPanel === "notifications"}
              onClick={() =>
                setOpenWindowPanel((current) =>
                  current === "notifications" ? null : "notifications",
                )
              }
            >
              <Bell size={18} />
            </button>
            {openWindowPanel === "notifications" ? (
              <div className="quick-panel notifications-panel">
                <div className="quick-panel-title">
                  <strong>{text.window.notifications}</strong>
                  <span>{text.window.notificationsEventCount(appEvents.length)}</span>
                </div>
                {appEvents.length ? (
                  <div className="event-list">
                    {appEvents.slice(-6).reverse().map((event) => (
                      <article
                        className={`event-item level-${event.level.toLowerCase()}`}
                        key={event.id}
                      >
                        <span className="event-time">
                          {formatAppEventTime(event.timestampMs, appSettings.language)}
                        </span>
                        <strong>{event.title}</strong>
                        <p>{event.message}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p>{text.window.notificationsEmpty}</p>
                )}
                <div className="quick-panel-actions">
                  <button
                    type="button"
                    onClick={() => {
                      changeSection("logs");
                      setOpenWindowPanel(null);
                    }}
                  >
                    <Terminal size={15} />
                    {text.nav.logs}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenWindowPanel("help");
                    }}
                  >
                    <Archive size={15} />
                    {text.window.diagnosticBundle}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      changeSection("settings");
                      setOpenWindowPanel(null);
                    }}
                  >
                    <Settings size={15} />
                    {text.nav.settings}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRuntimeLogMode(runtimeLogMode === "hidden" ? "dock" : "hidden");
                      setOpenWindowPanel(null);
                    }}
                  >
                    <PanelBottomOpen size={15} />
                    {runtimeLogMode === "hidden" ? text.logs.showRuntime : text.logs.hide}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="window-tool-item">
            <button
              type="button"
              title={text.window.help}
              aria-expanded={openWindowPanel === "help"}
              onClick={() =>
                setOpenWindowPanel((current) => (current === "help" ? null : "help"))
              }
            >
              <HelpCircle size={18} />
            </button>
            {openWindowPanel === "help" ? (
              <div className="quick-panel help-panel">
                <strong>{text.window.help}</strong>
                <p>{text.window.helpDescription}</p>
                <p className="quick-panel-meta">
                  <Info size={14} />
                  <span>
                    {text.window.helpVersion}: {APP_INFO.version}
                  </span>
                </p>
                <div className="diagnostic-panel-block">
                  <strong>{text.window.diagnosticBundle}</strong>
                  <p>{text.window.diagnosticBundleDescription}</p>
                  <button
                    type="button"
                    disabled={isExportingDiagnosticBundle}
                    onClick={() => void exportDiagnosticBundle()}
                  >
                    <Archive size={15} />
                    {isExportingDiagnosticBundle
                      ? text.window.exportingDiagnosticBundle
                      : text.window.exportDiagnosticBundle}
                  </button>
                  {lastDiagnosticBundle ? (
                    <>
                      <p className="quick-panel-meta diagnostic-path">
                        <Info size={14} />
                        <span>
                          {text.window.diagnosticBundlePath}: {lastDiagnosticBundle.path}
                        </span>
                      </p>
                      <button type="button" onClick={() => void openLastDiagnosticBundleFolder()}>
                        <FolderOpen size={15} />
                        {text.window.openDiagnosticBundleFolder}
                      </button>
                    </>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    changeSection("settings");
                    setOpenWindowPanel(null);
                  }}
                >
                  <Settings size={15} />
                  {text.nav.settings}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    changeSection("logs");
                    setOpenWindowPanel(null);
                  }}
                >
                  <Terminal size={15} />
                  {text.nav.logs}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void openUrl(APP_INFO.authorUrl);
                    setOpenWindowPanel(null);
                  }}
                >
                  <Github size={15} />
                  {text.window.helpOpenAuthor(APP_INFO.authorName)}
                </button>
              </div>
            ) : null}
          </div>
          <div className="window-tool-item">
            <button
              type="button"
              title={text.window.more}
              aria-expanded={openWindowPanel === "more"}
              onClick={() =>
                setOpenWindowPanel((current) => (current === "more" ? null : "more"))
              }
            >
              <MoreVertical size={18} />
            </button>
            {openWindowPanel === "more" ? (
              <div className="quick-panel">
                <strong>{text.window.more}</strong>
                <button
                  type="button"
                  onClick={() => {
                    void createNewProfile();
                    setOpenWindowPanel(null);
                  }}
                >
                  <Plus size={15} />
                  {text.toolbar.create}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    changeSection("profiles");
                    setOpenWindowPanel(null);
                  }}
                >
                  <List size={15} />
                  {text.nav.profiles}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    changeSection("connections");
                    setOpenWindowPanel(null);
                  }}
                >
                  <Activity size={15} />
                  {text.nav.connections}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <section className="content-shell">
        <section
          className={`main-panel ${
            activeSection === "logs" || activeSection === "settings" ? "single-page" : ""
          } ${isWorkspaceSection && runtimeLogMode === "hidden" ? "logs-hidden" : ""} ${
            isWorkspaceSection && runtimeLogMode === "expanded" ? "logs-expanded" : ""
          }`}
        >
          {activeSection === "settings" ? (
            <SettingsPage
              appSettings={appSettings}
              resolvedColorMode={resolvedColorMode}
              isStartupSyncing={isStartupSyncing}
              isCheckingForUpdate={isCheckingForUpdate}
              isInstallingUpdate={isInstallingUpdate}
              availableUpdate={availableUpdate}
              updateStatusMessage={updateStatusMessage}
              text={text}
              onToggleStartOnBoot={toggleStartOnBoot}
              onToggleSilentStartOnBoot={toggleSilentStartOnBoot}
              onCheckForUpdates={() => void checkForUpdates()}
              onInstallUpdate={() => void installAvailableUpdate()}
              onUpdateAppSetting={updateAppSetting}
              onUpdateDefaultProfileSetting={updateDefaultProfileSetting}
              onUpdateDefaultNumberSetting={updateDefaultNumberSetting}
              onUpdateDefaultNoProxy={updateDefaultNoProxy}
            />
          ) : activeSection === "logs" ? (
            <LogPage
              text={text}
              profiles={profiles}
              runningCount={runningCount}
              renderedLogLines={renderedLogLines}
              logProfileFilter={logProfileFilter}
              logLevelFilter={logLevelFilter}
              logFromDateTime={logFromDateTime}
              logToDateTime={logToDateTime}
              lastLogExport={lastLogExport}
              logPreview={logPreview}
              logStorageInfo={logStorageInfo}
              isExportingLogs={isExportingLogs}
              isPreviewingLogs={isPreviewingLogs}
              onExportLogs={exportLogs}
              onPreviewLogs={previewLogs}
              onOpenLastLogExportFolder={openLastLogExportFolder}
              onClearLogs={requestClearLogs}
              onSetLogProfileFilter={setLogProfileFilter}
              onSetLogFromDateTime={setLogFromDateTime}
              onSetLogToDateTime={setLogToDateTime}
              onCloseLogPreview={() => setLogPreview(null)}
              onToggleLogLevel={toggleLogLevel}
              onOpenProfiles={() => changeSection("profiles")}
            />
          ) : (
            <ProfilesWorkspace
              text={text}
              profiles={profiles}
              visibleProfiles={visibleProfiles}
              selectedIds={selectedIds}
              selectedProfileId={selectedProfileId}
              selectedConnectionId={selectedConnectionId}
              visibleSelectedProfiles={visibleSelectedProfiles}
              runningCount={runningCount}
              tunnelStatuses={tunnelStatuses}
              draftProfile={draftProfile}
              language={appSettings.language}
              searchQuery={searchQuery}
              isBusy={isBusy}
              hasVisibleSelection={hasVisibleSelection}
              hasSingleVisibleSelection={hasSingleVisibleSelection}
              invalidSelectedProfileNames={invalidSelectedProfileNames}
              isConnectionsView={activeSection === "connections"}
              createNewProfile={createNewProfile}
              startProfiles={startProfiles}
              stopProfiles={stopProfiles}
              editSelectedProfile={editSelectedProfile}
              copyProfile={copyProfile}
              deleteSelectedProfiles={requestDeleteSelectedProfiles}
              setSearchQuery={setSearchQuery}
              showAllProfiles={() => changeSection("profiles")}
              showActiveConnections={() => changeSection("connections")}
              toggleSelectAll={toggleSelectAll}
              toggleSelected={toggleSelected}
              selectProfile={selectProfile}
              selectConnection={selectConnection}
              statusClass={statusClass}
            />
          )}

          {showInlineLogs ? (
            <section className={`log-dock ${runtimeLogMode === "expanded" ? "expanded" : ""}`}>
              <div className="log-dock-toolbar">
                <strong>
                  <Terminal size={16} />
                  {text.logs.runningTitle}
                </strong>
                <LogControls
                  text={text}
                  variant="compact"
                  profiles={profiles}
                  logProfileFilter={logProfileFilter}
                  logLevelFilter={logLevelFilter}
                  logFromDateTime={logFromDateTime}
                  logToDateTime={logToDateTime}
                  lastLogExport={lastLogExport}
                  isExportingLogs={isExportingLogs}
                  isPreviewingLogs={isPreviewingLogs}
                  onExportLogs={exportLogs}
                  onPreviewLogs={previewLogs}
                  onOpenLastLogExportFolder={openLastLogExportFolder}
                  onClearLogs={requestClearLogs}
                  onSetLogProfileFilter={setLogProfileFilter}
                  onSetLogFromDateTime={setLogFromDateTime}
                  onSetLogToDateTime={setLogToDateTime}
                  onToggleLogLevel={toggleLogLevel}
                />
                <div className="log-dock-actions">
                  <button
                    type="button"
                    onClick={() =>
                      setRuntimeLogMode(runtimeLogMode === "expanded" ? "dock" : "expanded")
                    }
                  >
                    {runtimeLogMode === "expanded" ? text.logs.collapse : text.logs.expand}
                  </button>
                  <button type="button" onClick={() => setRuntimeLogMode("hidden")}>
                    {text.logs.hide}
                  </button>
                </div>
              </div>
              <div className="log-lines">
                {renderedLogLines.map((line) => (
                  <code className={`log-line level-${line.level.toLowerCase()}`} key={line.key}>
                    {line.text}
                  </code>
                ))}
              </div>
            </section>
          ) : null}

          {isWorkspaceSection && runtimeLogMode === "hidden" ? (
            <button
              className="log-reveal-button"
              type="button"
              onClick={() => setRuntimeLogMode("dock")}
            >
              <Terminal size={16} />
              {text.logs.showRuntime}
            </button>
          ) : null}
        </section>
        {canShowEditor ? (
          <EditorPanel
            text={text}
            isDirty={isDirty}
            isSaving={isSaving}
            isBusy={isBusy}
            isProbingProxy={isProbingProxy}
            isDiscoveringProxy={isDiscoveringProxy}
            editorTab={editorTab}
            setEditorTab={setEditorTab}
            setIsEditorOpen={setIsEditorOpen}
            draftProfile={draftProfile}
            draftValidationError={draftValidationError}
            proxyProbe={proxyProbe}
            proxyDiscovery={proxyDiscovery}
            sshConfigHosts={sshConfigHosts}
            knownHostsStatus={knownHostsStatus}
            hostKeyScan={hostKeyScan}
            hostKeyScanMatchesDraft={hostKeyScanMatchesDraft}
            isScanningHostKey={isScanningHostKey}
            isTrustingHostKey={isTrustingHostKey}
            sshPreview={sshPreview}
            serverCommand={serverCommand}
            updateDraft={updateDraft}
            updateNumberField={updateNumberField}
            updateNoProxy={updateNoProxy}
            probeLocalProxy={probeLocalProxy}
            discoverLocalProxy={discoverLocalProxy}
            applyProxyCandidate={applyProxyCandidate}
            applySshConfigHost={applySshConfigHost}
            scanHostKeys={scanHostKeys}
            trustScannedHostKeys={trustScannedHostKeys}
            forgetSavedSshPassword={setForgetPasswordConfirmProfile}
            copySshCommand={copySshCommand}
            copyServerCommand={copyServerCommand}
            saveDraft={saveDraft}
          />
        ) : canShowConnectionDetails && selectedConnection ? (
          <ConnectionDetailsPanel
            text={text}
            selectedConnection={selectedConnection}
            selectedConnectionStatus={selectedConnectionStatus}
            isSelectedConnectionRunning={isSelectedConnectionRunning}
            isBusy={isBusy}
            stopProfiles={stopProfiles}
            copySshCommand={copySshCommand}
            copyServerCommand={copyServerCommand}
            openProfileEditor={openProfileEditor}
            viewProfileLogs={viewProfileLogs}
            clearSelectedConnection={clearSelectedConnection}
          />
        ) : null}
      </section>

      {pendingDiscardChange ? (
        <div className="modal-backdrop">
          <div
            className="password-dialog confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="discard-changes-dialog-title"
          >
            <div>
              <h2 id="discard-changes-dialog-title">
                {text.messages.confirmDiscardTitle}
              </h2>
              <p>{text.messages.confirmDiscard}</p>
            </div>
            <div className="dialog-actions">
              <button autoFocus type="button" onClick={cancelDiscardChange}>
                {text.messages.confirmDiscardCancel}
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={confirmDiscardChange}
              >
                {text.messages.confirmDiscardConfirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isClearLogsConfirmOpen ? (
        <div className="modal-backdrop">
          <div
            className="password-dialog confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-logs-dialog-title"
          >
            <div>
              <h2 id="clear-logs-dialog-title">{text.logs.clearConfirmTitle}</h2>
              <p>{text.logs.clearConfirmDescription}</p>
            </div>
            <div className="dialog-actions">
              <button autoFocus type="button" onClick={() => setIsClearLogsConfirmOpen(false)}>
                {text.logs.clearConfirmCancel}
              </button>
              <button className="danger-button" type="button" onClick={confirmClearLogs}>
                {text.logs.clearConfirmSubmit}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteConfirmProfiles ? (
        <div className="modal-backdrop">
          <div
            className="password-dialog confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-profiles-dialog-title"
          >
            <div>
              <h2 id="delete-profiles-dialog-title">
                {text.messages.confirmDeleteProfilesTitle(deleteConfirmProfiles.length)}
              </h2>
              <p>{text.messages.confirmDeleteProfilesDescription(deleteConfirmProfiles.length)}</p>
            </div>
            <div className="dialog-actions">
              <button autoFocus type="button" onClick={() => setDeleteConfirmProfiles(null)}>
                {text.messages.confirmDeleteProfilesCancel}
              </button>
              <button className="danger-button" type="button" onClick={confirmDeleteSelectedProfiles}>
                {text.messages.confirmDeleteProfilesSubmit}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingHostKeyReplace ? (
        <div className="modal-backdrop">
          <div
            className="password-dialog host-key-replace-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="host-key-replace-dialog-title"
          >
            <div>
              <h2 id="host-key-replace-dialog-title">
                {text.editor.replaceHostKeyDialogTitle(
                  pendingHostKeyReplace.scan.host,
                  pendingHostKeyReplace.scan.port,
                )}
              </h2>
              <p className="host-key-replace-warning">
                {text.editor.replaceHostKeyDialogWarning}
              </p>
            </div>
            <div className="host-key-diff">
              <section className="host-key-diff-column trusted">
                <h3>{text.editor.replaceHostKeyDialogTrustedHeading}</h3>
                {pendingHostKeyReplace.scan.existingKeys.length ? (
                  <ul>
                    {pendingHostKeyReplace.scan.existingKeys.map((item) => (
                      <li key={`replace-existing-${item.keyId}`}>
                        <code>{formatHostKeyFingerprint(item)}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="host-key-diff-empty">
                    {text.editor.replaceHostKeyDialogNoFingerprints}
                  </p>
                )}
              </section>
              <section className="host-key-diff-column scanned">
                <h3>{text.editor.replaceHostKeyDialogScannedHeading}</h3>
                {pendingHostKeyReplace.scan.fingerprints.length ? (
                  <ul>
                    {pendingHostKeyReplace.scan.fingerprints.map((item) => (
                      <li key={`replace-scanned-${item.keyId}`}>
                        <code>{formatHostKeyFingerprint(item)}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="host-key-diff-empty">
                    {text.editor.replaceHostKeyDialogNoFingerprints}
                  </p>
                )}
              </section>
            </div>
            <div className="dialog-actions">
              <button autoFocus type="button" onClick={cancelHostKeyReplace}>
                {text.editor.replaceHostKeyDialogCancel}
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={() => void confirmHostKeyReplace()}
              >
                {text.editor.replaceHostKeyDialogConfirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {forgetPasswordConfirmProfile ? (
        <div className="modal-backdrop">
          <div
            className="password-dialog confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="forget-password-dialog-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setForgetPasswordConfirmProfile(null);
              }
            }}
          >
            <div>
              <h2 id="forget-password-dialog-title">
                {text.editor.forgetSavedPasswordConfirmTitle}
              </h2>
              <p>
                {text.editor.forgetSavedPasswordConfirmDescription(
                  displayProfileName(forgetPasswordConfirmProfile.name, text),
                )}
              </p>
            </div>
            <div className="dialog-actions">
              <button
                autoFocus
                type="button"
                onClick={() => setForgetPasswordConfirmProfile(null)}
              >
                {text.editor.forgetSavedPasswordConfirmCancel}
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={confirmForgetSavedPassword}
              >
                {text.editor.forgetSavedPasswordConfirmSubmit}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {passwordPrompt ? (
        <div className="modal-backdrop">
          <form
            className="password-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="password-dialog-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                cancelSshPassword();
              }
            }}
            onSubmit={(event) => {
              event.preventDefault();
              submitSshPassword();
            }}
          >
            <div>
              <h2 id="password-dialog-title">{text.editor.passwordPromptTitle}</h2>
              <p>
                {text.editor.passwordPromptDescription(
                  displayProfileName(passwordPrompt.profile.name, text),
                  passwordPrompt.profile.sshUser,
                  passwordPrompt.profile.sshHost,
                  passwordPrompt.profile.rememberSshPassword,
                )}
              </p>
            </div>
            <label>
              {text.editor.passwordLabel}
              <input
                autoFocus
                type="password"
                value={passwordValue}
                onChange={(event) => setPasswordValue(event.currentTarget.value)}
                placeholder={text.editor.passwordPlaceholder}
              />
            </label>
            <div className="dialog-actions">
              <button type="button" onClick={cancelSshPassword}>
                {text.editor.passwordCancel}
              </button>
              <button className="save-button" type="submit" disabled={!passwordValue}>
                <Play size={15} />
                {text.editor.passwordSubmit}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <footer className="statusbar">
        <span>
          <span className="status-led" />
          {text.status.service}
        </span>
        <span>{text.status.localListeners(profiles.length)}</span>
        <span>{text.status.activeConnections(runningCount)}</span>
      </footer>
    </main>
  );
}

function formatAppEventTime(timestampMs: number, language: string) {
  return new Date(timestampMs).toLocaleTimeString(language, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}
