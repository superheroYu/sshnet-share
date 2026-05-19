export type CheckStatus = "ready" | "warning" | "pending" | "error";
export type ProxyProtocol = "http" | "socks5";
export type AuthMethod = "key" | "agent" | "password";
export type SectionKey = "profiles" | "connections" | "logs" | "settings";
export type EditorTab = "general" | "advanced";
export type LanguageSetting = "zh-CN" | "en-US";
export type ColorMode = "system" | "dark" | "light";
export type ResolvedColorMode = "dark" | "light";
export type RuntimeLogMode = "hidden" | "dock" | "expanded";
export type LogLevelFilter = "INFO" | "WARN" | "ERROR";
export type LogProfileFilter = "all" | "app" | string;
export type AppEventLevel = "INFO" | "WARN" | "ERROR";
export type AppEventCategory =
  | "tray"
  | "tunnel"
  | "hostKey"
  | "logs"
  | "diagnostics"
  | "updates";

export interface EnvironmentCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface ProxyProbeResult {
  reachable: boolean;
  protocol: ProxyProtocol | null;
  detail: string;
}

export interface LocalProxyCandidate {
  host: string;
  port: number;
  protocol: ProxyProtocol;
  source: string;
  detail: string;
}

export interface LocalProxyDiscoveryResult {
  candidates: LocalProxyCandidate[];
  scannedPorts: number[];
  detail: string;
}

export interface TunnelStatus {
  status:
    | "connecting"
    | "authenticating"
    | "running"
    | "stopping"
    | "reconnecting"
    | "stopped"
    | "failed";
  detail: string;
  pid: number | null;
  lastConnectedAt?: number | null;
}

export const TRANSIENT_TUNNEL_STATUS_HOLD_MS = 30_000;
export const FAILED_TUNNEL_STATUS_HOLD_MS = 8_000;

export function isProtectedTunnelStatus(status: TunnelStatus["status"] | undefined) {
  return (
    status === "connecting" ||
    status === "authenticating" ||
    status === "stopping" ||
    status === "reconnecting" ||
    status === "failed"
  );
}

export function isTerminalTunnelStatus(status: TunnelStatus["status"] | undefined) {
  return status === "running" || status === "stopped" || status === "failed";
}

export interface TunnelLogEntry {
  id: number;
  timestampMs: number;
  level: string;
  source: string;
  profileId?: string | null;
  message: string;
}

export interface LogExportResult {
  path: string;
  directory: string;
  lineCount: number;
  redactionCount: number;
  detail: string;
}

export interface AppEvent {
  id: number;
  timestampMs: number;
  level: AppEventLevel;
  category: AppEventCategory | string;
  title: string;
  message: string;
  profileId?: string | null;
}

export interface LogPreviewResult {
  lineCount: number;
  redactionCount: number;
  previewLines: string[];
}

export interface LogStorageInfo {
  logDir: string;
  currentFile: string;
  totalBytes: number;
  fileCount: number;
}

export interface DiagnosticBundleResult {
  path: string;
  directory: string;
  detail: string;
}

export interface AvailableUpdateInfo {
  version: string;
  currentVersion: string;
  date?: string | null;
  body?: string | null;
}

export interface LogLineViewModel {
  key: string;
  text: string;
  timestamp: string;
  body: string;
  level: LogLevelFilter;
  profileId: string | null;
  profileLabel: string;
  source: string;
}

export interface KnownHostKeyInfo {
  host: string;
  algorithm: string;
  fingerprint: string;
  keyId: string;
}

export interface KnownHostsStatus {
  status: "trusted" | "missing" | "error";
  detail: string;
  marker: string;
  path: string;
  trustedKeys: KnownHostKeyInfo[];
  trustedKeySetId: string;
}

export interface HostKeyScanResult {
  profileId: string;
  marker: string;
  host: string;
  port: number;
  hostKeys: string[];
  fingerprints: KnownHostKeyInfo[];
  existingKeys: KnownHostKeyInfo[];
  existingKeySetId: string;
  scannedKeySetId: string;
  trustAction: "new" | "unchanged" | "replace";
  scannedAt: number;
  detail: string;
}

export interface HostKeyScanState {
  profileId: string;
  sshHost: string;
  sshPort: number;
  result: HostKeyScanResult;
}

export interface SshConfigHost {
  alias: string;
  hostName?: string | null;
  user?: string | null;
  port?: number | null;
  identityFile?: string | null;
}

export interface Profile {
  id: string;
  schemaVersion: number;
  name: string;
  localProxyHost: "127.0.0.1";
  localProxyPort: number;
  localProxyProtocol: ProxyProtocol;
  sshHost: string;
  sshPort: number;
  sshUser: string;
  authMethod: AuthMethod;
  privateKeyPath: string;
  connectTimeoutSeconds: number;
  reconnectEnabled: boolean;
  reconnectIntervalSeconds: number;
  rememberSshPassword: boolean;
  lastConnectedAt?: number | null;
  remoteBindHost: "127.0.0.1";
  remoteProxyPort: number;
  noProxy: string[];
}

export interface DefaultProfileSettings {
  localProxyPort: number;
  localProxyProtocol: ProxyProtocol;
  sshPort: number;
  authMethod: AuthMethod;
  privateKeyPath: string;
  connectTimeoutSeconds: number;
  reconnectEnabled: boolean;
  reconnectIntervalSeconds: number;
  noProxy: string[];
}

export interface AppSettings {
  language: LanguageSetting;
  colorMode: ColorMode;
  startOnBoot: boolean;
  silentStartOnBoot: boolean;
  defaultProfile: DefaultProfileSettings;
}

export interface StartupPreferences {
  silentStartOnBoot: boolean;
}

export interface PasswordPromptState {
  profile: Profile;
  resolve: (password: string | null) => void;
}

