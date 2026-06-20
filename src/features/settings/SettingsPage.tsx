import type { ChangeEvent } from "react";
import { Download, RefreshCw } from "lucide-react";
import type {
  AvailableUpdateInfo,
  AppSettings,
  AuthMethod,
  ColorMode,
  DefaultProfileSettings,
  ProxyProtocol,
  ResolvedColorMode,
} from "../../types/domain";
import type { DefaultNumberSettingKey } from "../../lib/appSettings";
import type { LocaleText } from "../../i18n/localeText";

interface SettingsPageProps {
  appSettings: AppSettings;
  resolvedColorMode: ResolvedColorMode;
  isStartupSyncing: boolean;
  isCheckingForUpdate: boolean;
  isInstallingUpdate: boolean;
  availableUpdate: AvailableUpdateInfo | null;
  updateStatusMessage: string;
  text: LocaleText;
  isFloatingVisible: boolean;
  onToggleStartOnBoot: () => void;
  onToggleSilentStartOnBoot: () => void;
  onToggleFloatingWindow: () => void;
  onCheckForUpdates: () => void;
  onInstallUpdate: () => void;
  onUpdateAppSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  onUpdateDefaultProfileSetting: <K extends keyof DefaultProfileSettings>(
    key: K,
    value: DefaultProfileSettings[K],
  ) => void;
  onUpdateDefaultNumberSetting: (
    key: DefaultNumberSettingKey,
    event: ChangeEvent<HTMLInputElement>,
  ) => void;
  onUpdateDefaultNoProxy: (value: string) => void;
}

export function SettingsPage({
  appSettings,
  resolvedColorMode,
  isStartupSyncing,
  isCheckingForUpdate,
  isInstallingUpdate,
  availableUpdate,
  updateStatusMessage,
  text,
  isFloatingVisible,
  onToggleStartOnBoot,
  onToggleSilentStartOnBoot,
  onToggleFloatingWindow,
  onCheckForUpdates,
  onInstallUpdate,
  onUpdateAppSetting,
  onUpdateDefaultProfileSetting,
  onUpdateDefaultNumberSetting,
  onUpdateDefaultNoProxy,
}: SettingsPageProps) {
  const canConfigureSilentStartOnBoot = appSettings.startOnBoot && !isStartupSyncing;

  return (
    <section className="settings-page">
      <div className="settings-preference-grid">
        <section className="settings-section">
          <div className="settings-section-header">
            <div>
              <h2>{text.settings.languageTitle}</h2>
              <p>{text.settings.languageDescription}</p>
            </div>
          </div>
          <div className="segmented-control" role="group" aria-label={text.settings.languageAria}>
            <button
              className={appSettings.language === "zh-CN" ? "active" : ""}
              type="button"
              onClick={() => onUpdateAppSetting("language", "zh-CN")}
            >
              {text.settings.simplifiedChinese}
              <span>zh-CN</span>
            </button>
            <button
              className={appSettings.language === "en-US" ? "active" : ""}
              type="button"
              onClick={() => onUpdateAppSetting("language", "en-US")}
            >
              English
              <span>en-US</span>
            </button>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-header">
            <div>
              <h2>{text.settings.colorTitle}</h2>
              <p>{text.settings.colorDescription}</p>
            </div>
          </div>
          <div className="segmented-control three" role="group" aria-label={text.settings.colorAria}>
            {(["system", "dark", "light"] as ColorMode[]).map((mode) => (
              <button
                className={appSettings.colorMode === mode ? "active" : ""}
                type="button"
                key={mode}
                onClick={() => onUpdateAppSetting("colorMode", mode)}
              >
                {mode === "system"
                  ? text.settings.colorSystem
                  : mode === "dark"
                    ? text.settings.colorDark
                    : text.settings.colorLight}
                <span>
                  {mode === "system" ? text.settings.currentTheme(resolvedColorMode) : mode}
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="settings-section">
        <div className="settings-section-header">
          <div>
            <h2>{text.settings.behaviorTitle}</h2>
            <p>{text.settings.behaviorDescription}</p>
          </div>
        </div>
        <div className="settings-toggle-row">
          <div>
            <strong>{text.settings.startOnBoot}</strong>
            <span>{text.settings.startOnBootDescription}</span>
          </div>
          <button
            className={`switch-button ${appSettings.startOnBoot ? "active" : ""}`}
            type="button"
            role="switch"
            aria-checked={appSettings.startOnBoot}
            onClick={onToggleStartOnBoot}
            disabled={isStartupSyncing}
          >
            <span />
            <em>{appSettings.startOnBoot ? text.settings.enabled : text.settings.disabled}</em>
          </button>
        </div>
        <div className="settings-toggle-row" aria-disabled={!appSettings.startOnBoot}>
          <div>
            <strong>{text.settings.silentStartOnBoot}</strong>
            <span>{text.settings.silentStartOnBootDescription}</span>
          </div>
          <button
            className={`switch-button ${appSettings.silentStartOnBoot ? "active" : ""}`}
            type="button"
            role="switch"
            aria-checked={appSettings.silentStartOnBoot}
            onClick={onToggleSilentStartOnBoot}
            disabled={!canConfigureSilentStartOnBoot}
          >
            <span />
            <em>
              {appSettings.silentStartOnBoot ? text.settings.enabled : text.settings.disabled}
            </em>
          </button>
        </div>
        <div className="settings-toggle-row">
          <div>
            <strong>{text.settings.floatingOverlay}</strong>
            <span>{text.settings.floatingOverlayDescription}</span>
          </div>
          <button
            className={`switch-button ${isFloatingVisible ? "active" : ""}`}
            type="button"
            role="switch"
            aria-checked={isFloatingVisible}
            onClick={onToggleFloatingWindow}
          >
            <span />
            <em>{isFloatingVisible ? text.settings.enabled : text.settings.disabled}</em>
          </button>
        </div>
        <div className="settings-action-row">
          <div>
            <strong>{text.settings.updateTitle}</strong>
            <span>{text.settings.updateDescription}</span>
            {availableUpdate ? (
              <small className="update-available">
                {text.settings.updateAvailable(
                  availableUpdate.version,
                  availableUpdate.currentVersion,
                )}
              </small>
            ) : null}
            {updateStatusMessage ? <small>{updateStatusMessage}</small> : null}
          </div>
          <div className="settings-inline-actions">
            <button
              type="button"
              onClick={onCheckForUpdates}
              disabled={isCheckingForUpdate || isInstallingUpdate}
            >
              <RefreshCw size={15} />
              {isCheckingForUpdate ? text.settings.updateChecking : text.settings.checkUpdates}
            </button>
            <button
              className="save-button"
              type="button"
              onClick={onInstallUpdate}
              disabled={!availableUpdate || isCheckingForUpdate || isInstallingUpdate}
            >
              <Download size={15} />
              {isInstallingUpdate ? text.settings.updateInstalling : text.settings.installUpdate}
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <div>
            <h2>{text.settings.defaultTitle}</h2>
            <p>{text.settings.defaultDescription}</p>
          </div>
          <span>{text.settings.autosave}</span>
        </div>

        <div className="settings-field-grid">
          <label>
            {text.settings.defaultLocalPort}
            <input
              min={1}
              max={65535}
              type="number"
              value={appSettings.defaultProfile.localProxyPort}
              onChange={(event) => onUpdateDefaultNumberSetting("localProxyPort", event)}
            />
          </label>
          <label>
            {text.settings.defaultProxyMode}
            <select
              value={appSettings.defaultProfile.localProxyProtocol}
              onChange={(event) =>
                onUpdateDefaultProfileSetting(
                  "localProxyProtocol",
                  event.currentTarget.value as ProxyProtocol,
                )
              }
            >
              <option value="http">HTTP</option>
              <option value="socks5">SOCKS5</option>
            </select>
          </label>
          <label>
            {text.settings.defaultSshPort}
            <input
              min={1}
              max={65535}
              type="number"
              value={appSettings.defaultProfile.sshPort}
              onChange={(event) => onUpdateDefaultNumberSetting("sshPort", event)}
            />
          </label>
          <label>
            {text.settings.defaultAuthMethod}
            <select
              value={appSettings.defaultProfile.authMethod}
              onChange={(event) =>
                onUpdateDefaultProfileSetting("authMethod", event.currentTarget.value as AuthMethod)
              }
            >
              <option value="key">{text.auth.key}</option>
              <option value="agent">{text.auth.agent}</option>
              <option value="password">{text.auth.password}</option>
            </select>
          </label>
          <label>
            {text.settings.defaultTimeout}
            <input
              min={3}
              max={60}
              type="number"
              value={appSettings.defaultProfile.connectTimeoutSeconds}
              onChange={(event) => onUpdateDefaultNumberSetting("connectTimeoutSeconds", event)}
            />
          </label>
          <label>
            {text.settings.defaultReconnectInterval}
            <input
              min={3}
              max={3600}
              type="number"
              value={appSettings.defaultProfile.reconnectIntervalSeconds}
              disabled={!appSettings.defaultProfile.reconnectEnabled}
              onChange={(event) => onUpdateDefaultNumberSetting("reconnectIntervalSeconds", event)}
            />
          </label>
          <div className="settings-toggle-row wide-field compact-toggle-row">
            <div>
              <strong>{text.settings.defaultReconnectEnabled}</strong>
              <span>{text.editor.reconnectEnabledHint}</span>
            </div>
            <button
              className={`switch-button ${
                appSettings.defaultProfile.reconnectEnabled ? "active" : ""
              }`}
              type="button"
              role="switch"
              aria-label={text.settings.defaultReconnectEnabled}
              aria-checked={appSettings.defaultProfile.reconnectEnabled}
              onClick={() =>
                onUpdateDefaultProfileSetting(
                  "reconnectEnabled",
                  !appSettings.defaultProfile.reconnectEnabled,
                )
              }
            >
              <span />
              <em>
                {appSettings.defaultProfile.reconnectEnabled
                  ? text.settings.enabled
                  : text.settings.disabled}
              </em>
            </button>
          </div>
          {appSettings.defaultProfile.authMethod === "key" ? (
            <label className="wide-field">
              {text.settings.defaultKeyPath}
              <input
                value={appSettings.defaultProfile.privateKeyPath}
                onChange={(event) =>
                  onUpdateDefaultProfileSetting("privateKeyPath", event.currentTarget.value)
                }
                placeholder="C:\\Users\\user\\.ssh\\id_ed25519"
              />
            </label>
          ) : null}
          <label className="wide-field">
            {text.settings.defaultNoProxy}
            <input
              value={appSettings.defaultProfile.noProxy.join(",")}
              onChange={(event) => onUpdateDefaultNoProxy(event.currentTarget.value)}
              placeholder="localhost,127.0.0.1,::1"
            />
          </label>
        </div>
      </section>
    </section>
  );
}
