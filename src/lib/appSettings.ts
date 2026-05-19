import type { AppSettings, ColorMode, DefaultProfileSettings, Profile, ResolvedColorMode } from "../types/domain";

export const APP_SETTINGS_STORAGE_KEY = "sshnet-share-settings-v1";

export const defaultAppSettings: AppSettings = {
  language: "zh-CN",
  colorMode: "system",
  startOnBoot: false,
  silentStartOnBoot: true,
  defaultProfile: {
    localProxyPort: 2334,
    localProxyProtocol: "http",
    sshPort: 22,
    authMethod: "key",
    privateKeyPath: "",
    connectTimeoutSeconds: 10,
    reconnectEnabled: false,
    reconnectIntervalSeconds: 10,
    noProxy: ["localhost", "127.0.0.1", "::1"],
  },
};

export type DefaultNumberSettingKey =
  | "localProxyPort"
  | "sshPort"
  | "connectTimeoutSeconds"
  | "reconnectIntervalSeconds";

export const defaultNumberRanges: Record<DefaultNumberSettingKey, { min: number; max: number }> = {
  localProxyPort: { min: 1, max: 65535 },
  sshPort: { min: 1, max: 65535 },
  connectTimeoutSeconds: { min: 3, max: 60 },
  reconnectIntervalSeconds: { min: 3, max: 3600 },
};

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function clampDefaultNumberSetting(key: DefaultNumberSettingKey, value: number) {
  const range = defaultNumberRanges[key];
  return clampNumber(value, range.min, range.max);
}

export function normalizeAppSettings(settings?: Partial<AppSettings> | null): AppSettings {
  const input = (settings?.defaultProfile ?? {}) as Partial<DefaultProfileSettings>;
  const fallback = defaultAppSettings.defaultProfile;
  const numberOrDefault = (value: unknown, fallbackValue: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallbackValue;

  return {
    language: settings?.language === "en-US" ? "en-US" : "zh-CN",
    colorMode:
      settings?.colorMode === "dark" || settings?.colorMode === "light"
        ? settings.colorMode
        : "system",
    startOnBoot: settings?.startOnBoot === true,
    silentStartOnBoot: settings?.silentStartOnBoot !== false,
    defaultProfile: {
      localProxyPort: clampDefaultNumberSetting(
        "localProxyPort",
        numberOrDefault(input.localProxyPort, fallback.localProxyPort),
      ),
      localProxyProtocol: input.localProxyProtocol === "socks5" ? "socks5" : "http",
      sshPort: clampDefaultNumberSetting("sshPort", numberOrDefault(input.sshPort, fallback.sshPort)),
      authMethod:
        input.authMethod === "agent" || input.authMethod === "password"
          ? input.authMethod
          : "key",
      privateKeyPath:
        typeof input.privateKeyPath === "string" ? input.privateKeyPath : fallback.privateKeyPath,
      connectTimeoutSeconds: clampDefaultNumberSetting(
        "connectTimeoutSeconds",
        numberOrDefault(input.connectTimeoutSeconds, fallback.connectTimeoutSeconds),
      ),
      reconnectEnabled: input.reconnectEnabled === true,
      reconnectIntervalSeconds: clampDefaultNumberSetting(
        "reconnectIntervalSeconds",
        numberOrDefault(input.reconnectIntervalSeconds, fallback.reconnectIntervalSeconds),
      ),
      noProxy: Array.isArray(input.noProxy) ? input.noProxy.filter(Boolean) : [...fallback.noProxy],
    },
  };
}

export function loadAppSettings(): AppSettings {
  if (typeof window === "undefined") {
    return defaultAppSettings;
  }

  try {
    const stored = window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    return normalizeAppSettings(stored ? (JSON.parse(stored) as Partial<AppSettings>) : null);
  } catch {
    return defaultAppSettings;
  }
}

export function resolveColorMode(mode: ColorMode): ResolvedColorMode {
  if (mode === "dark" || mode === "light") {
    return mode;
  }

  if (typeof window !== "undefined") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  return "dark";
}

export function defaultProfileOverrides(settings: AppSettings): Partial<Profile> {
  const defaults = settings.defaultProfile;
  return {
    localProxyPort: defaults.localProxyPort,
    localProxyProtocol: defaults.localProxyProtocol,
    sshPort: defaults.sshPort,
    authMethod: defaults.authMethod,
    privateKeyPath: defaults.privateKeyPath,
    connectTimeoutSeconds: defaults.connectTimeoutSeconds,
    reconnectEnabled: defaults.reconnectEnabled,
    reconnectIntervalSeconds: defaults.reconnectIntervalSeconds,
    noProxy: [...defaults.noProxy],
  };
}

