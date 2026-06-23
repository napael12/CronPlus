import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api, { WorkflowRun } from "@/lib/api";
import { connectRunWs, WsEvent } from "@/lib/ws";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const runId = Number(id);
  const consoleRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<{ stream: string; text: string }[]>([]);

  const { data: run } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => api.get<WorkflowRun>(`/runs/${runId}/`).then((r) => r.data),
    refetchInterval: (query) => (query.state.data?.status === "running" ? 3000 : false),
  });

  useEffect(() => {
    if (!run || run.status !== "running") return;
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

  if (!run) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Run #{run.id}</h1>
        <StatusBadge status={run.status} />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
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
            <p className="text-sm font-medium">{run.triggered_by_scheduler ? "Scheduler" : `User #${run.triggered_by}`}</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Steps</h2>
        {run.step_runs?.map((sr) => (
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
                <div
                  className="console-output max-h-60 overflow-auto rounded bg-zinc-950 p-3 text-zinc-100"
                >
                  {sr.stdout && <pre className="text-green-300">{sr.stdout}</pre>}
                  {sr.stderr && <pre className="text-red-400">{sr.stderr}</pre>}
                </div>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {run.status === "running" && lines.length > 0 && (
        <div>
          <h2 className="mb-2 text-lg font-semibold">Live Output</h2>
          <div
            ref={consoleRef}
            className="console-output h-80 overflow-auto rounded bg-zinc-950 p-3 text-zinc-100"
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
  );
}
