import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppEvent } from "../types/domain";

const MAX_EVENTS = 100;

export function useAppEvents() {
  const [appEvents, setAppEvents] = useState<AppEvent[]>([]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    async function startEventStream() {
      try {
        const handler = await listen<AppEvent>("sshnet-event", (event) => {
          setAppEvents((current) => appendEvent(current, event.payload));
        });
        if (disposed) {
          void handler();
          return;
        }
        unlisten = () => void handler();
      } catch {
        // Keep loading the local snapshot even if event subscription is unavailable.
      }

      try {
        const events = await invoke<AppEvent[]>("get_app_events");
        if (!disposed) {
          setAppEvents((current) => normalizeEvents([...current, ...events]));
        }
      } catch {
        // The notification center can stay empty until the next pushed event.
      }
    }

    void startEventStream();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return { appEvents };
}

function appendEvent(current: AppEvent[], event: AppEvent) {
  if (current.some((item) => item.id === event.id)) {
    return current;
  }
  return normalizeEvents([...current, event]);
}

function normalizeEvents(events: AppEvent[]) {
  return [...events].sort((first, second) => first.id - second.id).slice(-MAX_EVENTS);
}
