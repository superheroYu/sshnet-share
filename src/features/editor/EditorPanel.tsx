import { useEffect, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { Check, Clipboard, KeyRound, Save, X } from "lucide-react";
import type {
  AuthMethod,
  EditorTab,
  HostKeyScanState,
  KnownHostsStatus,
  LocalProxyCandidate,
  LocalProxyDiscoveryResult,
  Profile,
  ProxyProbeResult,
  ProxyProtocol,
  SshConfigHost,
} from "../../types/domain";
import type { LocaleText } from "../../i18n/localeText";
import {
  displayKnownHostsDetail,
  formatHostKeyFingerprint,
  knownHostsStatusLabel,
} from "../../lib/display";

type ProfileNumberField =
  | "localProxyPort"
  | "sshPort"
  | "remoteProxyPort"
  | "connectTimeoutSeconds"
  | "reconnectIntervalSeconds";

interface EditorPanelProps {
  text: LocaleText;
  isDirty: boolean;
  isSaving: boolean;
  isBusy: boolean;
  isProbingProxy: boolean;
  isDiscoveringProxy: boolean;
  editorTab: EditorTab;
  setEditorTab: Dispatch<SetStateAction<EditorTab>>;
  setIsEditorOpen: Dispatch<SetStateAction<boolean>>;
  draftProfile: Profile;
  draftValidationError: string | null;
  proxyProbe: ProxyProbeResult | null;
  proxyDiscovery: LocalProxyDiscoveryResult | null;
  sshConfigHosts: SshConfigHost[];
  knownHostsStatus: KnownHostsStatus | null;
  hostKeyScan: HostKeyScanState | null;
  hostKeyScanMatchesDraft: boolean;
  isScanningHostKey: boolean;
  isTrustingHostKey: boolean;
  sshPreview: string;
  serverCommand: string;
  updateDraft: <K extends keyof Profile>(key: K, value: Profile[K]) => void;
  updateNumberField: (key: ProfileNumberField, event: ChangeEvent<HTMLInputElement>) => void;
  updateNoProxy: (value: string) => void;
  probeLocalProxy: () => void;
  discoverLocalProxy: () => void;
  applyProxyCandidate: (candidate: LocalProxyCandidate) => void;
  applySshConfigHost: (alias: string) => void;
  scanHostKeys: () => void;
  trustScannedHostKeys: () => void;
  forgetSavedSshPassword: (profile: Profile) => void;
  copySshCommand: () => Promise<boolean>;
  copyServerCommand: () => Promise<boolean>;
  saveDraft: () => void;
}

export function EditorPanel({
  text,
  isDirty,
  isSaving,
  isBusy,
  isProbingProxy,
  isDiscoveringProxy,
  editorTab,
  setEditorTab,
  setIsEditorOpen,
  draftProfile,
  draftValidationError,
  proxyProbe,
  proxyDiscovery,
  sshConfigHosts,
  knownHostsStatus,
  hostKeyScan,
  hostKeyScanMatchesDraft,
  isScanningHostKey,
  isTrustingHostKey,
  sshPreview,
  serverCommand,
  updateDraft,
  updateNumberField,
  updateNoProxy,
  probeLocalProxy,
  discoverLocalProxy,
  applyProxyCandidate,
  applySshConfigHost,
  scanHostKeys,
  trustScannedHostKeys,
  forgetSavedSshPassword,
  copySshCommand,
  copyServerCommand,
  saveDraft,
}: EditorPanelProps) {
  const [recentCopy, setRecentCopy] = useState<"ssh" | "server" | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

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

  async function handleCopySsh() {
    if (await copySshCommand()) {
      flashCopy("ssh");
    }
  }

  async function handleCopyServer() {
    if (await copyServerCommand()) {
      flashCopy("server");
    }
  }

  async function choosePrivateKeyFile() {
    const selected = await openFileDialog({
      multiple: false,
      directory: false,
    });
    if (typeof selected === "string") {
      updateDraft("privateKeyPath", selected);
    }
  }

  return (            <aside className="editor-panel">
              <div className="editor-header">
                <div>
                  <h2>{text.editor.title}</h2>
                  <span>{isDirty ? text.editor.dirty : text.editor.synced}</span>
                </div>
                <button type="button" onClick={() => setIsEditorOpen(false)} title={text.editor.close}>
                  <X size={18} />
                </button>
              </div>
    
              <div className="editor-tabs">
                <button
                  className={editorTab === "general" ? "active" : ""}
                  type="button"
                  onClick={() => setEditorTab("general")}
                >
                  {text.editor.general}
                </button>
                <button
                  className={editorTab === "advanced" ? "active" : ""}
                  type="button"
                  onClick={() => setEditorTab("advanced")}
                >
                  {text.editor.advanced}
                </button>
              </div>
    
              <div className="editor-scroll">
                {draftValidationError ? (
                  <p className="form-error" role="alert">
                    {draftValidationError}
                  </p>
                ) : null}
                {editorTab === "general" ? (
                  <>
                    <label>
                      {text.editor.profileName}
                      <input
                        value={draftProfile.name}
                        onChange={(event) => updateDraft("name", event.currentTarget.value)}
                      />
                    </label>
    
                    <div className="split-fields">
                      <label>
                        {text.editor.localPort}
                        <input
                          min={1}
                          max={65535}
                          type="number"
                          value={draftProfile.localProxyPort}
                          onChange={(event) => updateNumberField("localProxyPort", event)}
                        />
                      </label>
                    </div>
    
                    <div className="proxy-tools">
                      <button type="button" onClick={probeLocalProxy} disabled={isBusy}>
                        {isProbingProxy ? text.editor.probing : text.editor.probeCurrent}
                      </button>
                      <button type="button" onClick={discoverLocalProxy} disabled={isBusy}>
                        {isDiscoveringProxy
                          ? text.editor.discoveringProxy
                          : text.editor.autoDetectProxy}
                      </button>
                    </div>
    
                    <p className={`inline-status ${proxyProbe?.reachable ? "ready" : ""}`}>
                      {proxyProbe?.detail ?? text.editor.proxyHint}
                    </p>
    
                    {proxyDiscovery?.candidates.length ? (
                      <div className="candidate-list">
                        {proxyDiscovery.candidates.map((candidate) => (
                          <button
                            type="button"
                            key={`${candidate.port}-${candidate.protocol}`}
                            onClick={() => applyProxyCandidate(candidate)}
                          >
                            <strong>
                              {candidate.host}:{candidate.port}
                            </strong>
                            <span>{candidate.protocol.toUpperCase()}</span>
                            <small>{candidate.source}</small>
                          </button>
                        ))}
                      </div>
                    ) : null}
    
                    <div className="field-stack">
                      <span className="field-label">{text.editor.sshHost}</span>
                      <div className="host-combo">
                        <input
                          aria-label={text.editor.sshHost}
                          value={draftProfile.sshHost}
                          onChange={(event) => updateDraft("sshHost", event.currentTarget.value)}
                        />
                        <select
                          aria-label={text.editor.sshConfigSelect}
                          value=""
                          onChange={(event) => applySshConfigHost(event.currentTarget.value)}
                          disabled={!sshConfigHosts.length}
                        >
                          <option value="">
                            {sshConfigHosts.length
                              ? text.editor.sshConfigSelect
                              : text.editor.sshConfigEmpty}
                          </option>
                          {sshConfigHosts.map((host) => (
                            <option value={host.alias} key={host.alias}>
                              {host.alias}
                              {host.hostName ? ` - ${host.hostName}` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
    
                    <div className="split-fields">
                      <label>
                        {text.editor.sshPort}
                        <input
                          min={1}
                          max={65535}
                          type="number"
                          value={draftProfile.sshPort}
                          onChange={(event) => updateNumberField("sshPort", event)}
                        />
                      </label>
                      <label>
                        {text.editor.remotePort}
                        <input
                          min={1024}
                          max={65535}
                          type="number"
                          value={draftProfile.remoteProxyPort}
                          onChange={(event) => updateNumberField("remoteProxyPort", event)}
                        />
                      </label>
                    </div>
    
                    <label>
                      {text.editor.sshUser}
                      <input
                        value={draftProfile.sshUser}
                        onChange={(event) => updateDraft("sshUser", event.currentTarget.value)}
                      />
                    </label>
    
                    <div className={`host-card ${knownHostsStatus?.status ?? "missing"}`}>
                      <div>
                        <KeyRound size={18} />
                        <strong>{knownHostsStatusLabel(knownHostsStatus?.status, text)}</strong>
                      </div>
                      <p>{displayKnownHostsDetail(knownHostsStatus, text)}</p>
                      <div className="proxy-tools">
                        <button type="button" onClick={scanHostKeys} disabled={isScanningHostKey}>
                          {isScanningHostKey ? text.editor.scanning : text.editor.scanFingerprint}
                        </button>
                        <button
                          type="button"
                          onClick={trustScannedHostKeys}
                          disabled={
                            !hostKeyScan ||
                            !hostKeyScanMatchesDraft ||
                            hostKeyScan.result.trustAction === "unchanged" ||
                            isTrustingHostKey
                          }
                          title={
                            hostKeyScan && !hostKeyScanMatchesDraft
                              ? text.editor.scanMismatchTitle
                              : text.editor.trustScan
                          }
                        >
                          {isTrustingHostKey
                            ? text.editor.writing
                            : hostKeyScan && !hostKeyScanMatchesDraft
                              ? text.editor.hostMismatchLabel
                              : hostKeyScan?.result.trustAction === "replace"
                                ? text.editor.replaceTrust
                                : hostKeyScan?.result.trustAction === "unchanged"
                                  ? text.editor.alreadyTrusted
                                  : text.editor.trustScan}
                        </button>
                      </div>
                      {hostKeyScan ? (
                        <div className="fingerprints">
                          {!hostKeyScanMatchesDraft ? (
                            <small>{text.editor.scanMismatchDetail}</small>
                          ) : null}
                          {hostKeyScan.result.trustAction === "replace" &&
                          hostKeyScan.result.existingKeys.length ? (
                            <>
                              <small>{text.editor.existingFingerprints}</small>
                              {hostKeyScan.result.existingKeys.map((item) => (
                                <code key={`existing-${item.keyId}`}>
                                  {formatHostKeyFingerprint(item)}
                                </code>
                              ))}
                              <small>{text.editor.newFingerprints}</small>
                            </>
                          ) : null}
                          {hostKeyScan.result.fingerprints.map((item) => (
                            <code key={`scanned-${item.keyId}`}>{formatHostKeyFingerprint(item)}</code>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="split-fields">
                      <label>
                        {text.editor.proxyMode}
                        <select
                          value={draftProfile.localProxyProtocol}
                          onChange={(event) =>
                            updateDraft("localProxyProtocol", event.currentTarget.value as ProxyProtocol)
                          }
                        >
                          <option value="http">HTTP</option>
                          <option value="socks5">SOCKS5</option>
                        </select>
                      </label>
                      <label>
                        {text.editor.authMethod}
                        <select
                          value={draftProfile.authMethod}
                          onChange={(event) =>
                            updateDraft("authMethod", event.currentTarget.value as AuthMethod)
                          }
                        >
                          <option value="key">{text.auth.key}</option>
                          <option value="agent">{text.auth.agent}</option>
                          <option value="password">{text.auth.password}</option>
                        </select>
                      </label>
                    </div>
    
                    {draftProfile.authMethod === "key" ? (
                      <div className="field-group">
                        <label htmlFor="profile-private-key-path">
                          {text.editor.privateKeyPath}
                        </label>
                        <div className="path-picker">
                          <input
                            id="profile-private-key-path"
                            value={draftProfile.privateKeyPath}
                            onChange={(event) =>
                              updateDraft("privateKeyPath", event.currentTarget.value)
                            }
                            placeholder="C:\\Users\\user\\.ssh\\id_ed25519"
                          />
                          <button type="button" onClick={() => void choosePrivateKeyFile()}>
                            {text.editor.browsePrivateKey}
                          </button>
                        </div>
                      </div>
                    ) : null}
    
                    {draftProfile.authMethod === "password" ? (
                      <>
                        <div className="editor-toggle-row">
                          <div className="editor-toggle-head">
                            <strong className="editor-toggle-title">
                              {text.editor.rememberSshPassword}
                            </strong>
                            <button
                              className={`switch-button ${draftProfile.rememberSshPassword ? "active" : ""}`}
                              type="button"
                              role="switch"
                              aria-label={text.editor.rememberSshPassword}
                              aria-checked={draftProfile.rememberSshPassword}
                              onClick={() =>
                                updateDraft("rememberSshPassword", !draftProfile.rememberSshPassword)
                              }
                            >
                              <span />
                              <em>
                                {draftProfile.rememberSshPassword
                                  ? text.settings.enabled
                                  : text.settings.disabled}
                              </em>
                            </button>
                          </div>
                          <span className="editor-toggle-desc">
                            {text.editor.rememberSshPasswordHint}
                          </span>
                        </div>
                        <button
                          className="toolbar-button inline-action-button"
                          type="button"
                          onClick={() => forgetSavedSshPassword(draftProfile)}
                        >
                          {text.editor.forgetSavedPassword}
                        </button>
                      </>
                    ) : null}
    
                    <label>
                      {text.editor.connectTimeout}
                      <input
                        min={3}
                        max={60}
                        type="number"
                        value={draftProfile.connectTimeoutSeconds}
                        onChange={(event) => updateNumberField("connectTimeoutSeconds", event)}
                      />
                    </label>
    
                    <div className="editor-toggle-row">
                      <div className="editor-toggle-head">
                        <strong className="editor-toggle-title">
                          {text.editor.reconnectEnabled}
                        </strong>
                        <button
                          className={`switch-button ${draftProfile.reconnectEnabled ? "active" : ""}`}
                          type="button"
                          role="switch"
                          aria-label={text.editor.reconnectEnabled}
                          aria-checked={draftProfile.reconnectEnabled}
                          onClick={() => updateDraft("reconnectEnabled", !draftProfile.reconnectEnabled)}
                        >
                          <span />
                          <em>
                            {draftProfile.reconnectEnabled
                              ? text.settings.enabled
                              : text.settings.disabled}
                          </em>
                        </button>
                      </div>
                      <span className="editor-toggle-desc">
                        {text.editor.reconnectEnabledHint}
                      </span>
                    </div>
    
                    <label>
                      {text.editor.reconnectInterval}
                      <input
                        min={3}
                        max={3600}
                        type="number"
                        value={draftProfile.reconnectIntervalSeconds}
                        disabled={!draftProfile.reconnectEnabled}
                        onChange={(event) => updateNumberField("reconnectIntervalSeconds", event)}
                      />
                    </label>
    
                    <label>
                      {text.editor.remoteBindHost}
                      <input value={draftProfile.remoteBindHost} readOnly />
                    </label>
                    <p className="inline-status">{text.editor.remoteBindHostHint}</p>
    
                    <label>
                      NO_PROXY
                      <input
                        value={draftProfile.noProxy.join(",")}
                        onChange={(event) => updateNoProxy(event.currentTarget.value)}
                        placeholder="localhost,127.0.0.1,::1"
                      />
                    </label>
    
                    <div className="preview-block">
                      <div className="preview-header">
                        <span>{text.editor.sshCommand}</span>
                        <button
                          type="button"
                          onClick={handleCopySsh}
                          className={recentCopy === "ssh" ? "copy-done" : undefined}
                          aria-live="polite"
                        >
                          {recentCopy === "ssh" ? <Check size={14} /> : <Clipboard size={14} />}
                          {recentCopy === "ssh" ? text.editor.copySshDone : text.editor.copySsh}
                        </button>
                      </div>
                      <pre>{sshPreview}</pre>
                    </div>

                    <div className="preview-block">
                      <div className="preview-header">
                        <span>{text.editor.serverCommand}</span>
                        <button
                          type="button"
                          onClick={handleCopyServer}
                          className={recentCopy === "server" ? "copy-done" : undefined}
                          aria-live="polite"
                        >
                          {recentCopy === "server" ? (
                            <Check size={14} />
                          ) : (
                            <Clipboard size={14} />
                          )}
                          {recentCopy === "server"
                            ? text.editor.copyProxyDone
                            : text.editor.copyProxy}
                        </button>
                      </div>
                      <pre>{serverCommand}</pre>
                    </div>
                  </>
                )}
              </div>
    
              <footer className="editor-actions">
                <button
                  className="save-button"
                  type="button"
                  onClick={saveDraft}
                  disabled={isSaving || Boolean(draftValidationError)}
                >
                  <Save size={16} />
                  {isSaving ? text.editor.saving : text.editor.save}
                </button>
              </footer>
            </aside>
  );
}
