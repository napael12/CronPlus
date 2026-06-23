import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "./button";

export function Pagination({
  page,
  count,
  pageSize,
  onChange,
}: {
  page: number;
  count: number;
  pageSize: number;
  onChange: (page: number) => void;
}) {
  if (count <= pageSize) return null;
  const totalPages = Math.ceil(count / pageSize);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, count);

  return (
    <div className="flex items-center justify-between px-4 py-2 border-t text-xs text-muted-foreground">
      <span className="tabular-nums">{from}–{to} of {count}</span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page <= 1} onClick={() => onChange(1)}>
          <ChevronsLeft className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="px-2 tabular-nums">{page} / {totalPages}</span>
        <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={page >= totalPages} onClick={() => onChange(totalPages)}>
          <ChevronsRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
