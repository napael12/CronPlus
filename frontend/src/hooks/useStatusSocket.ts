import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

function useStatusSocket(path: string | null, onUpdate: () => void): void {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!path) return;

    let active = true;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (!active) return;
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${protocol}://${window.location.host}${path}`);

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string);
          if (msg.type === "status_update") onUpdateRef.current();
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!active) return;
        timer = setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      if (ws) {
        ws.onclose = null; // prevent reconnect on intentional teardown
        ws.close();
      }
    };
  }, [path]);
}

/** Open a project-scoped status socket and invalidate workflow/step queries on change. */
export function useProjectStatus(projectId: number | null): void {
  const qc = useQueryClient();
  const path = projectId != null ? `/ws/projects/${projectId}/status/` : null;
  useStatusSocket(path, () => {
    qc.invalidateQueries({ queryKey: ["workflows", projectId] });
    qc.invalidateQueries({ queryKey: ["steps"] });
  });
}

/**
 * Forces a re-render every `ms` milliseconds while `enabled` is true.
 * Use this to animate live duration counters without any server requests.
 */
export function useLiveTick(ms: number, enabled: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms, enabled]);
}

/** Open a global status socket and invalidate dashboard/run-history queries on change. */
export function useGlobalStatus(): void {
  const qc = useQueryClient();
  useStatusSocket("/ws/status/", () => {
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["runs-all"] });
  });
}
