import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
  type FilterFn,
  type SortingState,
  type ColumnFiltersState,
  type Column,
} from "@tanstack/react-table";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsUpDown,
  RefreshCw,
  Search,
  LayoutDashboard,
  Square,
  X,
} from "lucide-react";
import api, { DashboardData, WorkflowRun, PaginatedResponse, getApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { RunDetailDialog } from "@/components/ui/RunDetailDialog";
import { useGlobalStatus, useLiveTick } from "@/hooks/useStatusSocket";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/AuthContext";

const WINDOWS = [
  { label: "30 min", value: 30 },
  { label: "1 hr", value: 60 },
  { label: "6 hr", value: 360 },
];

const PAGE_SIZE = 10;
const RUN_STATUSES = ["running", "success", "failed", "stopped", "pending", "skipped"];

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
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ── TanStack Table filter functions ──────────────────────────────────────────

const workflowRunGlobalFilter: FilterFn<WorkflowRun> = (row, _columnId, filterValue: string) => {
  const r = row.original;
  const lq = filterValue.toLowerCase();
  return (
    String(r.id).includes(lq) ||
    (r.workflow_name ?? "").toLowerCase().includes(lq) ||
    (r.project_name ?? "").toLowerCase().includes(lq) ||
    r.status.toLowerCase().includes(lq) ||
    (r.triggered_by_name ?? "").toLowerCase().includes(lq)
  );
};
workflowRunGlobalFilter.autoRemove = (val) => !val;

type ScheduledItem = DashboardData["scheduled"][number];

const schedGlobalFilter: FilterFn<ScheduledItem> = (row, _columnId, filterValue: string) => {
  const s = row.original;
  const lq = filterValue.toLowerCase();
  return s.name.toLowerCase().includes(lq) || s.project_name.toLowerCase().includes(lq);
};
schedGlobalFilter.autoRemove = (val) => !val;

const startedAtFilter: FilterFn<WorkflowRun> = (row, columnId, filterValue: string) => {
  const val = row.getValue<string | null>(columnId);
  if (!val) return false;
  return formatTime(val).includes(filterValue);
};
startedAtFilter.autoRemove = (val) => !val;

const stepNameFilter: FilterFn<WorkflowRun> = (row, columnId, filterValue: string) => {
  const val = row.getValue<string | null>(columnId);
  return (val ?? "").toLowerCase().includes(filterValue.toLowerCase());
};
stepNameFilter.autoRemove = (val) => !val;

// ── Column helpers (module-level, typed) ──────────────────────────────────────

const runHelper = createColumnHelper<WorkflowRun>();
const schedHelper = createColumnHelper<ScheduledItem>();

// ── SortHeader ────────────────────────────────────────────────────────────────

function SortHeader({
  column,
  children,
}: {
  column: Column<any, unknown>;
  children: React.ReactNode;
}) {
  const sorted = column.getIsSorted();
  return (
    <button
      className="flex items-center gap-1 font-medium cursor-pointer select-none whitespace-nowrap hover:text-foreground text-left"
      onClick={column.getToggleSortingHandler()}
    >
      {children}
      {sorted === "asc" ? (
        <ChevronUp className="h-3 w-3 shrink-0" />
      ) : sorted === "desc" ? (
        <ChevronDown className="h-3 w-3 shrink-0" />
      ) : (
        <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-40" />
      )}
    </button>
  );
}

const thClass = "px-4 py-2 text-xs text-muted-foreground bg-muted/20 border-b";
const filterInputClass =
  "h-6 text-xs px-1.5 w-full rounded border border-input bg-background placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring";

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
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
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

// ── RunningSection ────────────────────────────────────────────────────────────

function RunningSection({
  runs,
  canRun,
  onStop,
  isPending,
  onDetail,
}: {
  runs: WorkflowRun[];
  canRun: boolean;
  onStop: (id: number) => void;
  isPending: boolean;
  onDetail: (id: number) => void;
}) {
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "id", desc: true }]);

  const columns = useMemo(
    () => [
      runHelper.accessor("id", {
        header: ({ column }) => <SortHeader column={column}>Run</SortHeader>,
        cell: ({ getValue }) => (
          <button
            onClick={() => onDetail(getValue())}
            className="text-primary hover:underline font-mono text-xs"
          >
            #{getValue()}
          </button>
        ),
      }),
      runHelper.accessor("project_name", {
        id: "project",
        header: ({ column }) => <SortHeader column={column}>Project</SortHeader>,
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">{getValue() ?? "—"}</span>
        ),
      }),
      runHelper.accessor("workflow_name", {
        id: "workflow",
        header: ({ column }) => <SortHeader column={column}>Workflow</SortHeader>,
        cell: ({ row, getValue }) => (
          <span className="text-xs font-medium">{getValue() ?? `#${row.original.workflow}`}</span>
        ),
      }),
      runHelper.accessor("step_name", {
        id: "step",
        header: ({ column }) => <SortHeader column={column}>Step</SortHeader>,
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">{getValue() ?? "—"}</span>
        ),
      }),
      runHelper.accessor("started_at", {
        id: "started_at",
        header: ({ column }) => <SortHeader column={column}>Started</SortHeader>,
        cell: ({ getValue }) => <span className="text-xs">{formatTime(getValue())}</span>,
      }),
      runHelper.accessor("duration_seconds", {
        id: "duration",
        header: ({ column }) => <SortHeader column={column}>Duration</SortHeader>,
        cell: ({ row }) => (
          <span className="text-xs font-mono">{formatElapsed(row.original.started_at)}</span>
        ),
      }),
      runHelper.accessor("triggered_by_name", {
        id: "triggered_by",
        header: ({ column }) => <SortHeader column={column}>Triggered By</SortHeader>,
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">{getValue() ?? "—"}</span>
        ),
      }),
      runHelper.accessor("status", {
        header: ({ column }) => <SortHeader column={column}>Status</SortHeader>,
        cell: ({ getValue }) => <StatusBadge status={getValue()} />,
      }),
      ...(canRun
        ? [
            runHelper.display({
              id: "stop",
              header: () => null,
              cell: ({ row }) => (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                  disabled={isPending}
                  onClick={() => {
                    if (
                      confirm(
                        `Stop workflow run #${row.original.id} (${row.original.workflow_name ?? ""})?`
                      )
                    )
                      onStop(row.original.id);
                  }}
                >
                  <Square className="h-3 w-3 mr-1" />Stop
                </Button>
              ),
            }),
          ]
        : []),
    ],
    [canRun, onStop, isPending, onDetail]
  );

  const table = useReactTable({
    data: runs,
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    globalFilterFn: workflowRunGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
    initialState: { pagination: { pageSize: PAGE_SIZE } },
  });

  const filteredCount = table.getFilteredRowModel().rows.length;

  return (
    <CollapsibleSection
      title="Currently Running"
      count={filteredCount}
      filter={filter}
      onFilterChange={(v) => {
        setFilter(v);
        table.setPageIndex(0);
      }}
    >
      {filteredCount === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {filter ? "No matches." : "No running workflows."}
        </p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className={thClass}>
                {table.getHeaderGroups()[0].headers.map((header) => (
                  <th key={header.id} className="px-4 py-2 text-left">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.getPaginationRowModel().rows.map((row, i) => (
                <tr key={row.id} className={i % 2 === 0 ? "bg-background" : "bg-muted/10"}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-2">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={table.getState().pagination.pageIndex + 1}
            count={filteredCount}
            pageSize={PAGE_SIZE}
            onChange={(p) => table.setPageIndex(p - 1)}
          />
        </>
      )}
    </CollapsibleSection>
  );
}

// ── RecentSection ─────────────────────────────────────────────────────────────

function RecentSection({
  runs,
  onDetail,
}: {
  runs: WorkflowRun[];
  onDetail: (id: number) => void;
}) {
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "finished_at", desc: true }]);

  const columns = useMemo(
    () => [
      runHelper.accessor("id", {
        header: ({ column }) => <SortHeader column={column}>Run</SortHeader>,
        cell: ({ getValue }) => (
          <button
            onClick={() => onDetail(getValue())}
            className="text-primary hover:underline font-mono text-xs"
          >
            #{getValue()}
          </button>
        ),
      }),
      runHelper.accessor("project_name", {
        id: "project",
        header: ({ column }) => <SortHeader column={column}>Project</SortHeader>,
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">{getValue() ?? "—"}</span>
        ),
      }),
      runHelper.accessor("workflow_name", {
        id: "workflow",
        header: ({ column }) => <SortHeader column={column}>Workflow</SortHeader>,
        cell: ({ row, getValue }) => (
          <span className="text-xs font-medium">{getValue() ?? `#${row.original.workflow}`}</span>
        ),
      }),
      runHelper.accessor("step_name", {
        id: "step",
        header: ({ column }) => <SortHeader column={column}>Step</SortHeader>,
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">{getValue() ?? "—"}</span>
        ),
      }),
      runHelper.accessor("started_at", {
        id: "started_at",
        header: ({ column }) => <SortHeader column={column}>Started</SortHeader>,
        cell: ({ getValue }) => <span className="text-xs">{formatTime(getValue())}</span>,
      }),
      runHelper.accessor("finished_at", {
        id: "finished_at",
        header: ({ column }) => <SortHeader column={column}>Finished</SortHeader>,
        cell: ({ getValue }) => <span className="text-xs">{formatTime(getValue())}</span>,
      }),
      runHelper.accessor("duration_seconds", {
        id: "duration",
        header: ({ column }) => <SortHeader column={column}>Duration</SortHeader>,
        cell: ({ getValue }) => <span className="text-xs font-mono">{formatDuration(getValue())}</span>,
      }),
      runHelper.accessor("triggered_by_name", {
        id: "triggered_by",
        header: ({ column }) => <SortHeader column={column}>Triggered By</SortHeader>,
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">{getValue() ?? "—"}</span>
        ),
      }),
      runHelper.accessor("status", {
        header: ({ column }) => <SortHeader column={column}>Status</SortHeader>,
        cell: ({ getValue }) => <StatusBadge status={getValue()} />,
      }),
    ],
    [onDetail]
  );

  const table = useReactTable({
    data: runs,
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    globalFilterFn: workflowRunGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
    initialState: { pagination: { pageSize: PAGE_SIZE } },
  });

  const filteredCount = table.getFilteredRowModel().rows.length;

  return (
    <CollapsibleSection
      title="Recently Completed"
      count={filteredCount}
      filter={filter}
      onFilterChange={(v) => {
        setFilter(v);
        table.setPageIndex(0);
      }}
    >
      {filteredCount === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {filter ? "No matches." : "No recent completions."}
        </p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className={thClass}>
                {table.getHeaderGroups()[0].headers.map((header) => (
                  <th key={header.id} className="px-4 py-2 text-left">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.getPaginationRowModel().rows.map((row, i) => (
                <tr key={row.id} className={i % 2 === 0 ? "bg-background" : "bg-muted/10"}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-2">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={table.getState().pagination.pageIndex + 1}
            count={filteredCount}
            pageSize={PAGE_SIZE}
            onChange={(p) => table.setPageIndex(p - 1)}
          />
        </>
      )}
    </CollapsibleSection>
  );
}

// ── ScheduledSection ──────────────────────────────────────────────────────────

function ScheduledSection({ scheduled }: { scheduled: DashboardData["scheduled"] }) {
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "next_run", desc: false }]);

  const columns = useMemo(
    () => [
      schedHelper.accessor("project_name", {
        id: "project",
        header: ({ column }) => <SortHeader column={column}>Project</SortHeader>,
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">{getValue()}</span>
        ),
      }),
      schedHelper.accessor("name", {
        id: "name",
        header: ({ column }) => <SortHeader column={column}>Workflow</SortHeader>,
        cell: ({ getValue }) => (
          <Link to="/projects" className="text-xs font-medium text-primary hover:underline">
            {getValue()}
          </Link>
        ),
      }),
      schedHelper.accessor("next_run", {
        id: "next_run",
        header: ({ column }) => <SortHeader column={column}>Next Run</SortHeader>,
        cell: ({ getValue }) => (
          <span className="text-xs font-mono">{new Date(getValue()).toLocaleString()}</span>
        ),
      }),
    ],
    []
  );

  const table = useReactTable({
    data: scheduled,
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    globalFilterFn: schedGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
    initialState: { pagination: { pageSize: PAGE_SIZE } },
  });

  const filteredCount = table.getFilteredRowModel().rows.length;

  return (
    <CollapsibleSection
      title="Upcoming Scheduled"
      count={filteredCount}
      filter={filter}
      onFilterChange={(v) => {
        setFilter(v);
        table.setPageIndex(0);
      }}
    >
      {filteredCount === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {filter ? "No matches." : "No upcoming scheduled runs."}
        </p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className={thClass}>
                {table.getHeaderGroups()[0].headers.map((header) => (
                  <th key={header.id} className="px-4 py-2 text-left">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.getPaginationRowModel().rows.map((row, i) => (
                <tr key={row.id} className={i % 2 === 0 ? "bg-background" : "bg-muted/10"}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-2">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination
            page={table.getState().pagination.pageIndex + 1}
            count={filteredCount}
            pageSize={PAGE_SIZE}
            onChange={(p) => table.setPageIndex(p - 1)}
          />
        </>
      )}
    </CollapsibleSection>
  );
}

// ── RunHistoryTab ─────────────────────────────────────────────────────────────

function RunHistoryTab() {
  const [page, setPage] = useState(1);
  const [runDetailId, setRunDetailId] = useState<number | null>(null);

  // Text inputs — what the user sees immediately
  const [inputProject, setInputProject] = useState("");
  const [inputWorkflow, setInputWorkflow] = useState("");
  const [inputTriggeredBy, setInputTriggeredBy] = useState("");

  // Server-side filter params (debounced from inputs)
  const [qProject, setQProject] = useState("");
  const [qWorkflow, setQWorkflow] = useState("");
  const [qTriggeredBy, setQTriggeredBy] = useState("");
  const [qStatus, setQStatus] = useState("");

  // TanStack Table state — client-side filters within current page
  const [sorting, setSorting] = useState<SortingState>([{ id: "id", desc: true }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  useEffect(() => {
    const t = setTimeout(() => {
      setQProject(inputProject);
      setQWorkflow(inputWorkflow);
      setQTriggeredBy(inputTriggeredBy);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [inputProject, inputWorkflow, inputTriggeredBy]);

  const { data, isLoading } = useQuery({
    queryKey: ["runs-all", page, qProject, qWorkflow, qStatus, qTriggeredBy],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page) });
      if (qProject) p.set("project", qProject);
      if (qWorkflow) p.set("workflow_name", qWorkflow);
      if (qStatus) p.set("status", qStatus);
      if (qTriggeredBy) p.set("triggered_by", qTriggeredBy);
      return api.get<PaginatedResponse<WorkflowRun>>(`/runs/?${p}`).then((r) => r.data);
    },
    staleTime: 30_000,
  });

  const columns = useMemo(
    () => [
      runHelper.accessor("id", {
        header: ({ column }) => <SortHeader column={column}>Run</SortHeader>,
        cell: ({ getValue }) => (
          <button
            onClick={() => setRunDetailId(getValue())}
            className="text-primary hover:underline font-mono text-xs"
          >
            #{getValue()}
          </button>
        ),
      }),
      runHelper.accessor("project_name", {
        id: "project",
        header: ({ column }) => <SortHeader column={column}>Project</SortHeader>,
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">{getValue() ?? "—"}</span>
        ),
        enableColumnFilter: false,
      }),
      runHelper.accessor("workflow_name", {
        id: "workflow",
        header: ({ column }) => <SortHeader column={column}>Workflow</SortHeader>,
        cell: ({ row, getValue }) => (
          <span className="text-xs font-medium">{getValue() ?? `#${row.original.workflow}`}</span>
        ),
        enableColumnFilter: false,
      }),
      runHelper.accessor("step_name", {
        id: "step",
        header: ({ column }) => <SortHeader column={column}>Step</SortHeader>,
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">{getValue() ?? "—"}</span>
        ),
        filterFn: stepNameFilter,
      }),
      runHelper.accessor("status", {
        header: ({ column }) => <SortHeader column={column}>Status</SortHeader>,
        cell: ({ getValue }) => <StatusBadge status={getValue()} />,
        enableColumnFilter: false,
      }),
      runHelper.accessor("started_at", {
        id: "started",
        header: ({ column }) => <SortHeader column={column}>Started</SortHeader>,
        cell: ({ getValue }) => <span className="text-xs">{formatTime(getValue())}</span>,
        filterFn: startedAtFilter,
      }),
      runHelper.accessor("duration_seconds", {
        id: "duration",
        header: ({ column }) => <SortHeader column={column}>Duration</SortHeader>,
        cell: ({ getValue }) => <span className="text-xs font-mono">{formatDuration(getValue())}</span>,
        enableColumnFilter: false,
      }),
      runHelper.accessor("triggered_by_name", {
        id: "triggered_by",
        header: ({ column }) => <SortHeader column={column}>Triggered By</SortHeader>,
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">{getValue() ?? "—"}</span>
        ),
        enableColumnFilter: false,
      }),
    ],
    []
  );

  const table = useReactTable({
    data: data?.results ?? [],
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    manualPagination: true,
    pageCount: data?.count != null ? Math.ceil(data.count / PAGE_SIZE) : -1,
  });

  const stepFilterValue = (table.getColumn("step")?.getFilterValue() as string) ?? "";
  const startedFilterValue = (table.getColumn("started")?.getFilterValue() as string) ?? "";

  const hasFilters =
    inputProject ||
    inputWorkflow ||
    inputTriggeredBy ||
    qStatus ||
    stepFilterValue ||
    startedFilterValue;

  const clearFilters = () => {
    setInputProject(""); setInputWorkflow(""); setInputTriggeredBy("");
    setQProject(""); setQWorkflow(""); setQTriggeredBy("");
    setQStatus("");
    table.getColumn("step")?.setFilterValue("");
    table.getColumn("started")?.setFilterValue("");
    setPage(1);
  };

  const rows = table.getFilteredRowModel().rows;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {data?.count != null ? `${data.count} total` : ""}
        </span>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <X className="h-3 w-3" />Clear filters
          </button>
        )}
      </div>
      <RunDetailDialog runId={runDetailId} onClose={() => setRunDetailId(null)} />
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className={thClass}>
              {table.getHeaderGroups()[0].headers.map((header) => (
                <th key={header.id} className="px-4 py-2 text-left">
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
            <tr className="border-b bg-muted/5">
              <td className="px-4 py-1" />
              <td className="px-2 py-1">
                <input
                  value={inputProject}
                  onChange={(e) => setInputProject(e.target.value)}
                  placeholder="Project…"
                  className={filterInputClass}
                />
              </td>
              <td className="px-2 py-1">
                <input
                  value={inputWorkflow}
                  onChange={(e) => setInputWorkflow(e.target.value)}
                  placeholder="Workflow…"
                  className={filterInputClass}
                />
              </td>
              <td className="px-2 py-1">
                <input
                  value={stepFilterValue}
                  onChange={(e) => table.getColumn("step")?.setFilterValue(e.target.value)}
                  placeholder="Step…"
                  className={filterInputClass}
                />
              </td>
              <td className="px-2 py-1">
                <select
                  value={qStatus}
                  onChange={(e) => { setQStatus(e.target.value); setPage(1); }}
                  className={filterInputClass}
                >
                  <option value="">All</option>
                  {RUN_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </td>
              <td className="px-2 py-1">
                <input
                  value={startedFilterValue}
                  onChange={(e) => table.getColumn("started")?.setFilterValue(e.target.value)}
                  placeholder="yyyy-MM-dd…"
                  className={filterInputClass}
                />
              </td>
              <td className="px-4 py-1" />
              <td className="px-2 py-1">
                <input
                  value={inputTriggeredBy}
                  onChange={(e) => setInputTriggeredBy(e.target.value)}
                  placeholder="Triggered by…"
                  className={filterInputClass}
                />
              </td>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={row.id} className={i % 2 === 0 ? "bg-background" : "bg-muted/10"}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">
                  {hasFilters ? "No matches." : "No runs yet."}
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
  const { addToast } = useToast();
  const { user } = useAuth();
  const canRun = user?.role === "admin" || user?.role === "operator";
  const qc = useQueryClient();

  useGlobalStatus();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["dashboard", window],
    queryFn: () => api.get<DashboardData>(`/dashboard/?window=${window}`).then((r) => r.data),
    staleTime: 30_000,
  });

  const stopRun = useMutation({
    mutationFn: (runId: number) => api.post(`/runs/${runId}/stop/`),
    onSuccess: () => {
      refetch();
      qc.invalidateQueries({ queryKey: ["runs-all"] });
      addToast("Stop signal sent", "success");
    },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  useLiveTick(1000, (data?.running?.length ?? 0) > 0);

  return (
    <div className="space-y-4">
      <RunDetailDialog runId={runDetailId} onClose={() => setRunDetailId(null)} />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <LayoutDashboard className="h-6 w-6" />Monitor
        </h1>
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

      {tab === "overview" ? (
        isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-4">
            <RunningSection
              runs={data?.running ?? []}
              canRun={canRun}
              onStop={(id) => stopRun.mutate(id)}
              isPending={stopRun.isPending}
              onDetail={setRunDetailId}
            />
            <RecentSection runs={data?.recent ?? []} onDetail={setRunDetailId} />
            <ScheduledSection scheduled={data?.scheduled ?? []} />
          </div>
        )
      ) : (
        <RunHistoryTab />
      )}
    </div>
  );
}
