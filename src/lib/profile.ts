import type { EnvironmentCheck, Profile } from "../types/domain";
import type { LocaleText } from "../i18n/localeText";
import { localeText } from "../i18n/localeText";
import { displayProfileName } from "./display";

export const initialChecks: EnvironmentCheck[] = [
  {
    key: "ssh",
    label: "OpenSSH Client",
    status: "pending",
    detail: "正在检测 ssh.exe",
  },
  {
    key: "sshKeyscan",
    label: "ssh-keyscan",
    status: "pending",
    detail: "正在检测 Host Key 扫描工具",
  },
  {
    key: "webview2",
    label: "WebView2 Runtime",
    status: "pending",
    detail: "正在检测桌面 Web 渲染运行时",
  },
  {
    key: "profile",
    label: "Profile Store",
    status: "pending",
    detail: "等待初始化配置存储",
  },
];

export function createProfile(overrides: Partial<Profile> = {}): Profile {
  const id =
    overrides.id ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `profile-${Date.now()}`);

  return {
    id,
    schemaVersion: 1,
    name: localeText["zh-CN"].profile.newBase,
    localProxyHost: "127.0.0.1",
    localProxyPort: 2334,
    localProxyProtocol: "http",
    sshHost: "example.com",
    sshPort: 22,
    sshUser: "appuser",
    authMethod: "key",
    privateKeyPath: "",
    connectTimeoutSeconds: 10,
    reconnectEnabled: false,
    reconnectIntervalSeconds: 10,
    rememberSshPassword: false,
    lastConnectedAt: null,
    remoteBindHost: "127.0.0.1",
    remoteProxyPort: 27890,
    noProxy: ["localhost", "127.0.0.1", "::1"],
    ...overrides,
  };
}

export const fallbackProfile = createProfile({
  id: "default",
  name: localeText["zh-CN"].profile.defaultName,
});

export function firstProfileValidationError(
  profile: Profile,
  profiles: Profile[],
  text: LocaleText,
): string | null {
  const remotePortConflict = profiles.find(
    (item) =>
      item.id !== profile.id &&
      normalizedConflictField(item.sshHost) === normalizedConflictField(profile.sshHost) &&
      item.sshPort === profile.sshPort &&
      normalizedConflictField(item.remoteBindHost) === normalizedConflictField(profile.remoteBindHost) &&
      item.remoteProxyPort === profile.remoteProxyPort,
  );

  if (!profile.name.trim()) {
    return text.messages.validation.nameRequired;
  }
  if (!profile.sshHost.trim()) {
    return text.messages.validation.hostRequired;
  }
  if (!profile.sshUser.trim()) {
    return text.messages.validation.userRequired;
  }
  if (profile.localProxyPort < 1 || profile.localProxyPort > 65535) {
    return text.messages.validation.localPortRange;
  }
  if (profile.sshPort < 1 || profile.sshPort > 65535) {
    return text.messages.validation.sshPortRange;
  }
  if (profile.remoteProxyPort < 1024 || profile.remoteProxyPort > 65535) {
    return text.messages.validation.remotePortRange;
  }
  if (profile.connectTimeoutSeconds < 3 || profile.connectTimeoutSeconds > 60) {
    return text.messages.validation.timeoutRange;
  }
  if (profile.reconnectIntervalSeconds < 3 || profile.reconnectIntervalSeconds > 3600) {
    return text.messages.validation.reconnectIntervalRange;
  }
  if (remotePortConflict) {
    return text.messages.validation.remotePortConflict(
      displayProfileName(remotePortConflict.name, text),
    );
  }
  return null;
}

export function normalizedConflictField(value: string) {
  return value.trim().toLocaleLowerCase("en-US");
}
