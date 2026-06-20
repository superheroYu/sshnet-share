import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppSettings, Profile, ResolvedColorMode, TunnelStatus } from "../types/domain";
import { loadAppSettings, resolveColorMode } from "../lib/appSettings";
import { localeText } from "../i18n/localeText";

type TunnelStatusChangedEvent = {
  profileId: string;
  status: TunnelStatus;
};

const STATUS_POLL_INTERVAL_MS = 3000;

/**
 * Self-contained data source for the floating status overlay window.
 *
 * The overlay runs in its own webview, so it independently loads the saved
 * profiles, subscribes to live tunnel status changes, and mirrors the language
 * and color mode chosen in the main window (synced via `sshnet-settings-changed`).
 */
export function useFloatingController() {
  const [appSettings, setAppSettings] = useState<AppSettings>(() => loadAppSettings());
  const [resolvedColorMode, setResolvedColorMode] = useState<ResolvedColorMode>(() =>
    resolveColorMode(appSettings.colorMode),
  );
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [tunnelStatuses, setTunnelStatuses] = useState<Record<string, TunnelStatus>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());

  const text = localeText[appSettings.language];

  // Keep language / color mode in sync with the main window.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<AppSettings>("sshnet-settings-changed", ({ payload }) => {
      if (payload) {
        setAppSettings(payload);
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

  // Resolve "system" color mode and follow OS changes.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const update = () => setResolvedColorMode(resolveColorMode(appSettings.colorMode));
    update();
    if (appSettings.colorMode !== "system") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [appSettings.colorMode]);

  // Load profiles + poll statuses, and react to live status events.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    async function refreshStatuses(targetProfiles: Profile[]) {
      const pairs = await Promise.all(
        targetProfiles.map(async (profile) => {
          try {
            const status = await invoke<TunnelStatus>("get_tunnel_status", {
              profileId: profile.id,
            });
            return [profile.id, status] as const;
          } catch {
            return null;
          }
        }),
      );
      if (disposed) {
        return;
      }
      const incoming = Object.fromEntries(pairs.filter(Boolean) as [string, TunnelStatus][]);
      setTunnelStatuses((current) => ({ ...current, ...incoming }));
    }

    async function loadProfiles() {
      try {
        const stored = await invoke<Profile[]>("load_profiles");
        if (disposed) {
          return;
        }
        setProfiles(stored);
        void refreshStatuses(stored);
      } catch {
        // Leave the overlay empty until the next poll succeeds.
      }
    }

    void loadProfiles();

    void listen<TunnelStatusChangedEvent>("sshnet-status-changed", ({ payload }) => {
      if (!payload?.profileId || !payload.status) {
        return;
      }
      setTunnelStatuses((current) => ({
        ...current,
        [payload.profileId]: payload.status,
      }));
    }).then((handler) => {
      if (disposed) {
        handler();
      } else {
        unlisten = handler;
      }
    });

    const timer = window.setInterval(() => {
      void loadProfiles();
    }, STATUS_POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      unlisten?.();
      window.clearInterval(timer);
    };
  }, []);

  // Tick once per second so running durations stay live.
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const runningCount = useMemo(
    () => profiles.filter((profile) => tunnelStatuses[profile.id]?.status === "running").length,
    [profiles, tunnelStatuses],
  );

  return { appSettings, resolvedColorMode, profiles, tunnelStatuses, runningCount, nowMs, text };
}
