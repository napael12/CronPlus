export type WsEvent =
  | { event: "step_start"; step_run_id: number; step_name: string }
  | { event: "output"; step_run_id: number; stream: "stdout" | "stderr"; line: string }
  | { event: "step_end"; step_run_id: number; status: string; exit_code?: number };

export function connectRunWs(runId: number, onMessage: (e: WsEvent) => void): WebSocket {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.host;
  const ws = new WebSocket(`${protocol}://${host}/ws/runs/${runId}/`);
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data) as WsEvent);
    } catch {
      // ignore malformed messages
    }
  };
  return ws;
}
