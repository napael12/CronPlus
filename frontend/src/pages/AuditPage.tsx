import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ClipboardList } from "lucide-react";
import api, { AuditLog, PaginatedResponse } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

const ACTION_LABELS: Record<string, { label: string; className: string }> = {
  create: { label: "Create", className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  update: { label: "Update", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  delete: { label: "Delete", className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
};

const ENTITY_TYPES = ["Project", "Workflow", "Step", "User", "Variable"];

function ActionBadge({ action }: { action: string }) {
  const cfg = ACTION_LABELS[action] ?? { label: action, className: "bg-muted text-muted-foreground" };
  return (
    <span className={cn("inline-block rounded px-1.5 py-0.5 text-xs font-medium", cfg.className)}>
      {cfg.label}
    </span>
  );
}

function DetailCell({ log }: { log: AuditLog }) {
  const { action, detail } = log;

  if (action === "create") {
    if (detail.cloned_from != null) return <span className="text-xs text-muted-foreground">Cloned from #{String(detail.cloned_from)}</span>;
    if (detail.imported) return <span className="text-xs text-muted-foreground">Imported</span>;
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  if (action === "delete") return <span className="text-xs text-muted-foreground">—</span>;

  // update
  const changes = detail.changes as Record<string, { from: string; to: string }> | undefined;
  if (!changes || Object.keys(changes).length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <div className="space-y-0.5">
      {Object.entries(changes).map(([field, { from, to }]) => (
        <div key={field} className="text-xs">
          <span className="font-medium text-muted-foreground">{field}:</span>{" "}
          <span className="text-red-600 dark:text-red-400 font-mono">{truncate(from)}</span>
          {" → "}
          <span className="text-green-700 dark:text-green-400 font-mono">{truncate(to)}</span>
        </div>
      ))}
    </div>
  );
}

function truncate(s: string, max = 60): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function formatTs(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export function AuditPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);

  // Debounce search to avoid a request per keystroke
  const handleSearch = (v: string) => {
    setSearch(v);
    clearTimeout((handleSearch as unknown as { _t?: ReturnType<typeof setTimeout> })._t);
    (handleSearch as unknown as { _t?: ReturnType<typeof setTimeout> })._t = setTimeout(() => {
      setDebouncedSearch(v);
      setPage(1);
    }, 300);
  };

  const { data, isLoading } = useQuery({
    queryKey: ["audit-log", { entityType, action, search: debouncedSearch, page }],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (entityType) params.set("entity_type", entityType);
      if (action) params.set("action", action);
      if (debouncedSearch) params.set("search", debouncedSearch);
      return api.get<PaginatedResponse<AuditLog>>(`/audit-log/?${params}`).then((r) => r.data);
    },
    staleTime: 15_000,
  });

  const rows = data?.results ?? [];
  const thClass = "px-3 py-2 text-left text-xs font-medium text-muted-foreground bg-muted/30 whitespace-nowrap";

  return (
    <div className="p-6 space-y-4 h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between shrink-0">
        <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardList className="h-6 w-6" />Audit Log</h1>
        {data?.count != null && (
          <span className="text-sm text-muted-foreground">{data.count} records</span>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search name or user…"
            className="h-8 pl-8 text-sm w-56"
          />
        </div>
        <select
          value={entityType}
          onChange={(e) => { setEntityType(e.target.value); setPage(1); }}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">All entity types</option>
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(1); }}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">All actions</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-auto flex-1 min-h-0">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={thClass}>Date / Time</th>
              <th className={thClass}>User</th>
              <th className={thClass}>Action</th>
              <th className={thClass}>Entity Type</th>
              <th className={thClass}>Entity</th>
              <th className={thClass}>Changes</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading…</td>
              </tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No records found.</td>
              </tr>
            )}
            {rows.map((log, i) => (
              <tr key={log.id} className={i % 2 === 0 ? "bg-background" : "bg-muted/10"}>
                <td className="px-3 py-2 text-xs font-mono whitespace-nowrap">{formatTs(log.timestamp)}</td>
                <td className="px-3 py-2 text-xs">{log.user_name}</td>
                <td className="px-3 py-2"><ActionBadge action={log.action} /></td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{log.entity_type}</td>
                <td className="px-3 py-2 text-xs font-medium max-w-[180px] truncate" title={log.entity_name}>
                  {log.entity_name}
                </td>
                <td className="px-3 py-2 max-w-xs">
                  <DetailCell log={log} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="shrink-0">
        <Pagination page={page} count={data?.count ?? 0} pageSize={PAGE_SIZE} onChange={setPage} />
      </div>
    </div>
  );
}
