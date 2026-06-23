import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown, RefreshCw, Search, LayoutDashboard } from "lucide-react";
import api, { DashboardData, WorkflowRun, PaginatedResponse } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { RunDetailDialog } from "@/components/ui/RunDetailDialog";
import { useGlobalStatus, useLiveTick } from "@/hooks/useStatusSocket";

const WINDOWS = [
  { label: "30 min", value: 30 },
  { label: "1 hr", value: 60 },
  { label: "6 hr", value: 360 },
];

const PAGE_SIZE = 10;

function formatElapsed(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  const secs = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (secs < 0) return "—";
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

function formatDuration(seconds: number | null) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function formatTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

// ── Sort ─────────────────────────────────────────────────────────────────────

type SortDir = "asc" | "desc";

interface SortState {
  key: string;
  dir: SortDir;
}

function nextSort(current: SortState, key: string): SortState {
  if (current.key !== key) return { key, dir: "asc" };
  return { key, dir: current.dir === "asc" ? "desc" : "asc" };
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 ml-1 opacity-40 inline" />;
  return dir === "asc"
    ? <ChevronUp className="h-3 w-3 ml-1 inline" />
    : <ChevronDown className="h-3 w-3 ml-1 inline" />;
}

function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  className?: string;
}) {
  return (
    <th
      className={`px-4 py-2 font-medium text-left cursor-pointer select-none whitespace-nowrap hover:text-foreground ${className ?? ""}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      <SortIcon active={sort.key === sortKey} dir={sort.dir} />
    </th>
  );
}

function sortRuns(runs: WorkflowRun[], sort: SortState): WorkflowRun[] {
  return [...runs].sort((a, b) => {
    let va: any;
    let vb: any;
    switch (sort.key) {
      case "id":           va = a.id;                      vb = b.id;                      break;
      case "workflow":     va = a.workflow_name ?? "";      vb = b.workflow_name ?? "";      break;
      case "project":      va = a.project_name ?? "";       vb = b.project_name ?? "";       break;
      case "started_at":   va = a.started_at ?? "";         vb = b.started_at ?? "";         break;
      case "finished_at":  va = a.finished_at ?? "";        vb = b.finished_at ?? "";        break;
      case "duration":     va = a.duration_seconds ?? -1;   vb = b.duration_seconds ?? -1;   break;
      case "triggered_by": va = a.triggered_by_name ?? "";  vb = b.triggered_by_name ?? "";  break;
      case "status":       va = a.status;                   vb = b.status;                   break;
      case "step":         va = a.step_name ?? "";           vb = b.step_name ?? "";           break;
      default:             return 0;
    }
    if (va < vb) return sort.dir === "asc" ? -1 : 1;
    if (va > vb) return sort.dir === "asc" ? 1 : -1;
    return 0;
  });
}

function filterRuns(runs: WorkflowRun[], q: string): WorkflowRun[] {
  if (!q) return runs;
  const lq = q.toLowerCase();
  return runs.filter((r) =>
    String(r.id).includes(lq) ||
    (r.workflow_name ?? "").toLowerCase().includes(lq) ||
    (r.project_name ?? "").toLowerCase().includes(lq) ||
    r.status.toLowerCase().includes(lq) ||
    (r.triggered_by_name ?? "").toLowerCase().includes(lq)
  );
}

const thClass = "px-4 py-2 text-xs text-muted-foreground bg-muted/20 border-b";

// ── CollapsibleSection ────────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  count,
  filter,
  onFilterChange,
  children,
}: {
  title: string;
  count: number;
  filter: string;
  onFilterChange: (v: string) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-muted/40">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 font-semibold text-sm text-left"
        >
          {open
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          {title}
          <span className="text-xs font-normal text-muted-foreground">({count})</span>
        </button>
        {open && (
          <div className="relative">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={filter}
              onChange={(e) => onFilterChange(e.target.value)}
              placeholder="Filter…"
              className="h-7 pl-7 text-xs w-44"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}

// ── Run History Tab ───────────────────────────────────────────────────────────

function RunHistoryTab() {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "id", dir: "desc" });
  const [page, setPage] = useState(1);
  const [runDetailId, setRunDetailId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["runs-all", page],
    queryFn: () => api.get<PaginatedResponse<WorkflowRun>>(`/runs/?page=${page}`).then((r) => r.data),
    staleTime: 30_000,
  });

  const rows = useMemo(
    () => sortRuns(filterRuns(data?.results ?? [], filter), sort),
    [data?.results, filter, sort]
  );

  const handleFilterChange = (v: string) => {
    setFilter(v);
    setPage(1);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {data?.count != null ? `${data.count} total` : ""}
        </span>
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={filter}
            onChange={(e) => handleFilterChange(e.target.value)}
            placeholder="Filter…"
            className="h-7 pl-7 text-xs w-52"
          />
        </div>
      </div>
      <RunDetailDialog runId={runDetailId} onClose={() => setRunDetailId(null)} />
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className={thClass}>
              <SortableTh label="Run" sortKey="id" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} />
              <SortableTh label="Project" sortKey="project" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} />
              <SortableTh label="Workflow" sortKey="workflow" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} />
              <SortableTh label="Step" sortKey="step" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} />
              <SortableTh label="Status" sortKey="status" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} />
              <SortableTh label="Started" sortKey="started_at" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} />
              <SortableTh label="Duration" sortKey="duration" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} />
              <SortableTh label="Triggered By" sortKey="triggered_by" sort={sort} onSort={(k) => setSort(nextSort(sort, k))} />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">Loading…</td>
              </tr>
            )}
            {rows.map((run, i) => (
              <tr key={run.id} className={i % 2 === 0 ? "bg-background" : "bg-muted/10"}>
                <td className="px-4 py-2">
                  <button onClick={() => setRunDetailId(run.id)} className="text-primary hover:underline font-mono text-xs">
                    #{run.id}
                  </button>
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{run.project_name ?? "—"}</td>
                <td className="px-4 py-2 text-xs font-medium">{run.workflow_name ?? `#${run.workflow}`}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{run.step_name ?? "—"}</td>
                <td className="px-4 py-2"><StatusBadge status={run.status} /></td>
                <td className="px-4 py-2 text-xs">{formatTime(run.started_at)}</td>
                <td className="px-4 py-2 text-xs font-mono">{formatDuration(run.duration_seconds)}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{run.triggered_by_name ?? "—"}</td>
              </tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">
                  {filter ? "No matches." : "No runs yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} count={data?.count ?? 0} pageSize={PAGE_SIZE} onChange={setPage} />
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const [tab, setTab] = useState<"overview" | "history">("overview");
  const [window, setWindow] = useState(30);
  const [runDetailId, setRunDetailId] = useState<number | null>(null);

  // Server-push status updates via WebSocket
  useGlobalStatus();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["dashboard", window],
    queryFn: () => api.get<DashboardData>(`/dashboard/?window=${window}`).then((r) => r.data),
    staleTime: 30_000,
  });

  useLiveTick(1000, (data?.running?.length ?? 0) > 0);

  // Running table
  const [runningFilter, setRunningFilter] = useState("");
  const [runningSort, setRunningSort] = useState<SortState>({ key: "id", dir: "desc" });
  const [runningPage, setRunningPage] = useState(1);
  const runningRows = useMemo(
    () => sortRuns(filterRuns(data?.running ?? [], runningFilter), runningSort),
    [data?.running, runningFilter, runningSort]
  );
  const runningPageRows = runningRows.slice((runningPage - 1) * PAGE_SIZE, runningPage * PAGE_SIZE);

  const handleRunningFilterChange = (v: string) => { setRunningFilter(v); setRunningPage(1); };

  // Recent table
  const [recentFilter, setRecentFilter] = useState("");
  const [recentSort, setRecentSort] = useState<SortState>({ key: "finished_at", dir: "desc" });
  const [recentPage, setRecentPage] = useState(1);
  const recentRows = useMemo(
    () => sortRuns(filterRuns(data?.recent ?? [], recentFilter), recentSort),
    [data?.recent, recentFilter, recentSort]
  );
  const recentPageRows = recentRows.slice((recentPage - 1) * PAGE_SIZE, recentPage * PAGE_SIZE);

  const handleRecentFilterChange = (v: string) => { setRecentFilter(v); setRecentPage(1); };

  // Scheduled table
  const [schedFilter, setSchedFilter] = useState("");
  const [schedSort, setSchedSort] = useState<SortState>({ key: "next_run", dir: "asc" });
  const [schedPage, setSchedPage] = useState(1);
  const schedRows = useMemo(() => {
    const rows = data?.scheduled ?? [];
    const filtered = schedFilter
      ? rows.filter(
          (s) =>
            s.name.toLowerCase().includes(schedFilter.toLowerCase()) ||
            s.project_name.toLowerCase().includes(schedFilter.toLowerCase())
        )
      : rows;
    return [...filtered].sort((a, b) => {
      let va: any;
      let vb: any;
      if (schedSort.key === "name")         { va = a.name;         vb = b.name; }
      else if (schedSort.key === "project") { va = a.project_name; vb = b.project_name; }
      else                                  { va = a.next_run;     vb = b.next_run; }
      if (va < vb) return schedSort.dir === "asc" ? -1 : 1;
      if (va > vb) return schedSort.dir === "asc" ? 1 : -1;
      return 0;
    });
  }, [data?.scheduled, schedFilter, schedSort]);
  const schedPageRows = schedRows.slice((schedPage - 1) * PAGE_SIZE, schedPage * PAGE_SIZE);

  const handleSchedFilterChange = (v: string) => { setSchedFilter(v); setSchedPage(1); };

  return (
    <div className="space-y-4">
      <RunDetailDialog runId={runDetailId} onClose={() => setRunDetailId(null)} />
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><LayoutDashboard className="h-6 w-6" />Monitor</h1>
        {tab === "overview" && (
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {WINDOWS.map((w) => (
                <Button
                  key={w.value}
                  size="sm"
                  variant={window === w.value ? "default" : "outline"}
                  onClick={() => setWindow(w.value)}
                >
                  {w.label}
                </Button>
              ))}
            </div>
            <Button size="icon" variant="ghost" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b flex">
        {(["overview", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "overview" ? "Overview" : "Run History"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" ? (
        isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-4">

            {/* Currently Running */}
            <CollapsibleSection
              title="Currently Running"
              count={runningRows.length}
              filter={runningFilter}
              onFilterChange={handleRunningFilterChange}
            >
              {runningRows.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">
                  {runningFilter ? "No matches." : "No running workflows."}
                </p>
              ) : (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={thClass}>
                        <SortableTh label="Run" sortKey="id" sort={runningSort} onSort={(k) => setRunningSort(nextSort(runningSort, k))} />
                        <SortableTh label="Project" sortKey="project" sort={runningSort} onSort={(k) => setRunningSort(nextSort(runningSort, k))} />
                        <SortableTh label="Workflow" sortKey="workflow" sort={runningSort} onSort={(k) => setRunningSort(nextSort(runningSort, k))} />
                        <SortableTh label="Step" sortKey="step" sort={runningSort} onSort={(k) => setRunningSort(nextSort(runningSort, k))} />
                        <SortableTh label="Started" sortKey="started_at" sort={runningSort} onSort={(k) => setRunningSort(nextSort(runningSort, k))} />
                        <SortableTh label="Duration" sortKey="duration" sort={runningSort} onSort={(k) => setRunningSort(nextSort(runningSort, k))} />
                        <SortableTh label="Triggered By" sortKey="triggered_by" sort={runningSort} onSort={(k) => setRunningSort(nextSort(runningSort, k))} />
                        <SortableTh label="Status" sortKey="status" sort={runningSort} onSort={(k) => setRunningSort(nextSort(runningSort, k))} />
                      </tr>
                    </thead>
                    <tbody>
                      {runningPageRows.map((run, i) => (
                        <tr key={run.id} className={i % 2 === 0 ? "bg-background" : "bg-muted/10"}>
                          <td className="px-4 py-2">
                            <button onClick={() => setRunDetailId(run.id)} className="text-primary hover:underline font-mono text-xs">
                              #{run.id}
                            </button>
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{run.project_name ?? "—"}</td>
                          <td className="px-4 py-2 text-xs font-medium">{run.workflow_name ?? `#${run.workflow}`}</td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{run.step_name ?? "—"}</td>
                          <td className="px-4 py-2 text-xs">{formatTime(run.started_at)}</td>
                          <td className="px-4 py-2 text-xs font-mono">{formatElapsed(run.started_at)}</td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{run.triggered_by_name ?? "—"}</td>
                          <td className="px-4 py-2"><StatusBadge status={run.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pagination page={runningPage} count={runningRows.length} pageSize={PAGE_SIZE} onChange={setRunningPage} />
                </>
              )}
            </CollapsibleSection>

            {/* Recently Completed */}
            <CollapsibleSection
              title="Recently Completed"
              count={recentRows.length}
              filter={recentFilter}
              onFilterChange={handleRecentFilterChange}
            >
              {recentRows.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">
                  {recentFilter ? "No matches." : "No recent completions."}
                </p>
              ) : (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={thClass}>
                        <SortableTh label="Run" sortKey="id" sort={recentSort} onSort={(k) => setRecentSort(nextSort(recentSort, k))} />
                        <SortableTh label="Project" sortKey="project" sort={recentSort} onSort={(k) => setRecentSort(nextSort(recentSort, k))} />
                        <SortableTh label="Workflow" sortKey="workflow" sort={recentSort} onSort={(k) => setRecentSort(nextSort(recentSort, k))} />
                        <SortableTh label="Step" sortKey="step" sort={recentSort} onSort={(k) => setRecentSort(nextSort(recentSort, k))} />
                        <SortableTh label="Started" sortKey="started_at" sort={recentSort} onSort={(k) => setRecentSort(nextSort(recentSort, k))} />
                        <SortableTh label="Finished" sortKey="finished_at" sort={recentSort} onSort={(k) => setRecentSort(nextSort(recentSort, k))} />
                        <SortableTh label="Duration" sortKey="duration" sort={recentSort} onSort={(k) => setRecentSort(nextSort(recentSort, k))} />
                        <SortableTh label="Triggered By" sortKey="triggered_by" sort={recentSort} onSort={(k) => setRecentSort(nextSort(recentSort, k))} />
                        <SortableTh label="Status" sortKey="status" sort={recentSort} onSort={(k) => setRecentSort(nextSort(recentSort, k))} />
                      </tr>
                    </thead>
                    <tbody>
                      {recentPageRows.map((run, i) => (
                        <tr key={run.id} className={i % 2 === 0 ? "bg-background" : "bg-muted/10"}>
                          <td className="px-4 py-2">
                            <button onClick={() => setRunDetailId(run.id)} className="text-primary hover:underline font-mono text-xs">
                              #{run.id}
                            </button>
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{run.project_name ?? "—"}</td>
                          <td className="px-4 py-2 text-xs font-medium">{run.workflow_name ?? `#${run.workflow}`}</td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{run.step_name ?? "—"}</td>
                          <td className="px-4 py-2 text-xs">{formatTime(run.started_at)}</td>
                          <td className="px-4 py-2 text-xs">{formatTime(run.finished_at)}</td>
                          <td className="px-4 py-2 text-xs font-mono">{formatDuration(run.duration_seconds)}</td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{run.triggered_by_name ?? "—"}</td>
                          <td className="px-4 py-2"><StatusBadge status={run.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pagination page={recentPage} count={recentRows.length} pageSize={PAGE_SIZE} onChange={setRecentPage} />
                </>
              )}
            </CollapsibleSection>

            {/* Upcoming Scheduled */}
            <CollapsibleSection
              title="Upcoming Scheduled"
              count={schedRows.length}
              filter={schedFilter}
              onFilterChange={handleSchedFilterChange}
            >
              {schedRows.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">
                  {schedFilter ? "No matches." : "No upcoming scheduled runs."}
                </p>
              ) : (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={thClass}>
                        <SortableTh label="Project" sortKey="project" sort={schedSort} onSort={(k) => setSchedSort(nextSort(schedSort, k))} />
                        <SortableTh label="Workflow" sortKey="name" sort={schedSort} onSort={(k) => setSchedSort(nextSort(schedSort, k))} />
                        <SortableTh label="Next Run" sortKey="next_run" sort={schedSort} onSort={(k) => setSchedSort(nextSort(schedSort, k))} />
                      </tr>
                    </thead>
                    <tbody>
                      {schedPageRows.map((s, i) => (
                        <tr key={s.id} className={i % 2 === 0 ? "bg-background" : "bg-muted/10"}>
                          <td className="px-4 py-2 text-xs text-muted-foreground">{s.project_name}</td>
                          <td className="px-4 py-2 text-xs font-medium">
                            <Link to="/projects" className="text-primary hover:underline">
                              {s.name}
                            </Link>
                          </td>
                          <td className="px-4 py-2 text-xs font-mono">
                            {new Date(s.next_run).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pagination page={schedPage} count={schedRows.length} pageSize={PAGE_SIZE} onChange={setSchedPage} />
                </>
              )}
            </CollapsibleSection>

          </div>
        )
      ) : (
        <RunHistoryTab />
      )}
    </div>
  );
}
