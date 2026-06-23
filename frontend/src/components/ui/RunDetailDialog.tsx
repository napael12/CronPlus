import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api, { WorkflowRun } from "@/lib/api";
import { connectRunWs, WsEvent } from "@/lib/ws";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";

export function RunDetailDialog({ runId, onClose }: { runId: number | null; onClose: () => void }) {
  const consoleRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<{ stream: string; text: string }[]>([]);

  const { data: run } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => api.get<WorkflowRun>(`/runs/${runId}/`).then((r) => r.data),
    enabled: runId != null,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 3000 : false),
  });

  useEffect(() => {
    setLines([]);
  }, [runId]);

  useEffect(() => {
    if (!run || run.status !== "running" || runId == null) return;
    const ws = connectRunWs(runId, (event: WsEvent) => {
      if (event.event === "output") {
        setLines((prev) => [...prev, { stream: event.stream, text: event.line }]);
        setTimeout(() => {
          consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight, behavior: "smooth" });
        }, 0);
      }
    });
    return () => ws.close();
  }, [run?.status, runId]);

  return (
    <Dialog open={runId != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            Run #{runId}
            {run && <StatusBadge status={run.status} />}
          </DialogTitle>
        </DialogHeader>
        {!run ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Started</p>
                  <p className="text-sm font-medium">{run.started_at ? new Date(run.started_at).toLocaleString() : "—"}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Finished</p>
                  <p className="text-sm font-medium">{run.finished_at ? new Date(run.finished_at).toLocaleString() : "—"}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Duration</p>
                  <p className="text-sm font-medium">{run.duration_seconds != null ? `${run.duration_seconds.toFixed(1)}s` : "—"}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Triggered by</p>
                  <p className="text-sm font-medium">{run.triggered_by_scheduler ? "Scheduler" : run.triggered_by_name ?? `User #${run.triggered_by}`}</p>
                </CardContent>
              </Card>
            </div>

            {run.step_runs && run.step_runs.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Steps</h3>
                {run.step_runs.map((sr) => (
                  <Card key={sr.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">{sr.step_name}</CardTitle>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={sr.status} />
                          {sr.duration_seconds != null && (
                            <span className="text-xs text-muted-foreground">{sr.duration_seconds.toFixed(1)}s</span>
                          )}
                          {sr.peak_cpu_percent != null && (
                            <span className="text-xs text-muted-foreground">CPU {sr.peak_cpu_percent.toFixed(0)}%</span>
                          )}
                          {sr.peak_memory_mb != null && (
                            <span className="text-xs text-muted-foreground">Mem {sr.peak_memory_mb.toFixed(1)} MB</span>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    {(sr.stdout || sr.stderr) && (
                      <CardContent>
                        {sr.truncated && (
                          <p className="mb-1 text-xs text-warning">Output truncated (exceeded size limit)</p>
                        )}
                        <div className="console-output max-h-48 overflow-auto rounded bg-zinc-950 p-3 text-zinc-100">
                          {sr.stdout && <pre className="text-green-300 whitespace-pre-wrap">{sr.stdout}</pre>}
                          {sr.stderr && <pre className="text-red-400 whitespace-pre-wrap">{sr.stderr}</pre>}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            )}

            {run.status === "running" && lines.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Live Output</h3>
                <div
                  ref={consoleRef}
                  className="console-output h-64 overflow-auto rounded bg-zinc-950 p-3 text-zinc-100"
                >
                  {lines.map((l, i) => (
                    <div key={i} className={l.stream === "stderr" ? "text-red-400" : "text-green-300"}>
                      {l.text}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
