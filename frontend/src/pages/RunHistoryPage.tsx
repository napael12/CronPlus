import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import api, { WorkflowRun, PaginatedResponse } from "@/lib/api";
import { StatusBadge } from "@/components/ui/badge";

export function RunHistoryPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["runs"],
    queryFn: () => api.get<PaginatedResponse<WorkflowRun>>("/runs/").then((r) => r.data),
    refetchInterval: 10000,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Run History</h1>
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Run #</th>
              <th className="px-4 py-2 text-left font-medium">Workflow</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-left font-medium">Started</th>
              <th className="px-4 py-2 text-left font-medium">Duration</th>
              <th className="px-4 py-2 text-left font-medium">Triggered by</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {data?.results.map((run) => (
              <tr key={run.id} className="border-t hover:bg-muted/20">
                <td className="px-4 py-2">
                  <Link to={`/runs/${run.id}`} className="text-primary hover:underline font-medium">
                    #{run.id}
                  </Link>
                </td>
                <td className="px-4 py-2">{run.workflow_name ?? `#${run.workflow}`}</td>
                <td className="px-4 py-2"><StatusBadge status={run.status} /></td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {run.started_at ? new Date(run.started_at).toLocaleString() : "—"}
                </td>
                <td className="px-4 py-2 text-xs">
                  {run.duration_seconds != null ? `${run.duration_seconds.toFixed(1)}s` : "—"}
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {run.triggered_by_name ?? (run.triggered_by_scheduler ? "Scheduler" : `User #${run.triggered_by}`)}
                </td>
              </tr>
            ))}
            {data?.results.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No runs yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
