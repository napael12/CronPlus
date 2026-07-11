import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api, { WorkflowRun } from "@/lib/api";
import { connectRunWs, WsEvent } from "@/lib/ws";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";

interface LiveStep {
  step_name: string;
  status: string;
  exit_code?: number;
  lines: { stream: "stdout" | "stderr"; text: string }[];
}

export function RunDetailDialog({ runId, onClose }: { runId: number | null; onClose: () => void }) {
  const scrollRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [liveSteps, setLiveSteps] = useState<Map<number, LiveStep>>(new Map());

  const { data: run } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => api.get<WorkflowRun>(`/runs/${runId}/`).then((r) => r.data),
    enabled: runId != null,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 3000 : false),
  });

  useEffect(() => {
    setLiveSteps(new Map());
    scrollRefs.current = {};
  }, [runId]);

  useEffect(() => {
    if (!run || run.status !== "running" || runId == null) return;
    const ws = connectRunWs(runId, (event: WsEvent) => {
      if (event.event === "step_start") {
        setLiveSteps((prev) =>
          new Map(prev).set(event.step_run_id, {
            step_name: event.step_name,
            status: "running",
            lines: [],
          })
        );
      } else if (event.event === "output") {
        setLiveSteps((prev) => {
          const next = new Map(prev);
          const step = next.get(event.step_run_id);
          if (step)
            next.set(event.step_run_id, {
              ...step,
              lines: [...step.lines, { stream: event.stream, text: event.line }],
            });
          return next;
        });
      } else if (event.event === "step_end") {
        setLiveSteps((prev) => {
          const next = new Map(prev);
          const step = next.get(event.step_run_id);
          if (step)
            next.set(event.step_run_id, {
              ...step,
              status: event.status,
              exit_code: event.exit_code,
            });
          return next;
        });
      }
    });
    return () => ws.close();
  }, [run?.status, runId]);

  // Auto-scroll every step console when new lines arrive
  useEffect(() => {
    for (const node of Object.values(scrollRefs.current)) {
      node?.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    }
  }, [liveSteps]);

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
                  <p className="text-sm font-medium">
                    {run.started_at ? new Date(run.started_at).toLocaleString() : "—"}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Finished</p>
                  <p className="text-sm font-medium">
                    {run.finished_at ? new Date(run.finished_at).toLocaleString() : "—"}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Duration</p>
                  <p className="text-sm font-medium">
                    {run.duration_seconds != null ? `${run.duration_seconds.toFixed(1)}s` : "—"}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Triggered by</p>
                  <p className="text-sm font-medium">
                    {run.triggered_by_scheduler
                      ? "Scheduler"
                      : run.triggered_by_name ?? `User #${run.triggered_by}`}
                  </p>
                </CardContent>
              </Card>
            </div>

            {(run.step_runs && run.step_runs.length > 0) || liveSteps.size > 0 ? (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Steps</h3>

                {/* REST-driven step cards */}
                {run.step_runs?.map((sr) => {
                  const live = liveSteps.get(sr.id);
                  return (
                    <Card key={sr.id}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm">{sr.step_name}</CardTitle>
                          <div className="flex items-center gap-2">
                            <StatusBadge status={live?.status ?? sr.status} />
                            {sr.duration_seconds != null && (
                              <span className="text-xs text-muted-foreground">
                                {sr.duration_seconds.toFixed(1)}s
                              </span>
                            )}
                            {sr.peak_cpu_percent != null && (
                              <span className="text-xs text-muted-foreground">
                                CPU {sr.peak_cpu_percent.toFixed(0)}%
                              </span>
                            )}
                            {sr.peak_memory_mb != null && (
                              <span className="text-xs text-muted-foreground">
                                Mem {sr.peak_memory_mb.toFixed(1)} MB
                              </span>
                            )}
                          </div>
                        </div>
                      </CardHeader>

                      {/* Live output (step currently running) */}
                      {live && live.lines.length > 0 && (
                        <CardContent>
                          <div
                            ref={(node) => { scrollRefs.current[sr.id] = node; }}
                            className="console-output max-h-48 overflow-auto rounded bg-zinc-950 p-3 text-zinc-100"
                          >
                            {live.lines.map((l, i) => (
                              <div
                                key={i}
                                className={l.stream === "stderr" ? "text-red-400" : "text-green-300"}
                              >
                                {l.text}
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      )}

                      {/* Stored output (step already finished) */}
                      {!live && (sr.stdout || sr.stderr) && (
                        <CardContent>
                          {sr.truncated && (
                            <p className="mb-1 text-xs text-warning">
                              Output truncated (exceeded size limit)
                            </p>
                          )}
                          <div className="console-output max-h-48 overflow-auto rounded bg-zinc-950 p-3 text-zinc-100">
                            {sr.stdout && (
                              <pre className="text-green-300 whitespace-pre-wrap">{sr.stdout}</pre>
                            )}
                            {sr.stderr && (
                              <pre className="text-red-400 whitespace-pre-wrap">{sr.stderr}</pre>
                            )}
                          </div>
                        </CardContent>
                      )}

                      {/* Step output variables */}
                      {sr.output_vars && Object.keys(sr.output_vars).length > 0 && (
                        <CardContent>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Step Outputs</p>
                          <div className="rounded border bg-muted/30 px-3 py-2 font-mono text-xs space-y-0.5">
                            {Object.entries(sr.output_vars).map(([k, v]) => (
                              <div key={k}>
                                <span className="text-foreground">{k}</span>
                                <span className="text-muted-foreground"> = </span>
                                <span>{String(v)}</span>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  );
                })}

                {/* Ghost cards: steps visible via WS but not yet in REST data */}
                {[...liveSteps.entries()]
                  .filter(([id]) => !run.step_runs?.some((sr) => sr.id === id))
                  .map(([id, live]) => (
                    <Card key={id}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm">{live.step_name}</CardTitle>
                          <StatusBadge status={live.status} />
                        </div>
                      </CardHeader>
                      {live.lines.length > 0 && (
                        <CardContent>
                          <div
                            ref={(node) => { scrollRefs.current[id] = node; }}
                            className="console-output max-h-48 overflow-auto rounded bg-zinc-950 p-3 text-zinc-100"
                          >
                            {live.lines.map((l, i) => (
                              <div
                                key={i}
                                className={l.stream === "stderr" ? "text-red-400" : "text-green-300"}
                              >
                                {l.text}
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  ))}
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
