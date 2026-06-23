import { useMemo } from "react";
import cronstrue from "cronstrue";
import { CronExpressionParser } from "cron-parser";
import { ChevronDown, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "./input";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

const PRESET_GROUPS = [
  [
    { label: "Every minute",     value: "* * * * *" },
    { label: "Every 5 minutes",  value: "*/5 * * * *" },
    { label: "Every 15 minutes", value: "*/15 * * * *" },
    { label: "Every 30 minutes", value: "*/30 * * * *" },
  ],
  [
    { label: "Hourly",           value: "0 * * * *" },
    { label: "Every 6 hours",    value: "0 */6 * * *" },
    { label: "Every 12 hours",   value: "0 */12 * * *" },
  ],
  [
    { label: "Daily midnight",   value: "0 0 * * *" },
    { label: "Daily at noon",    value: "0 12 * * *" },
    { label: "Weekdays 9am",     value: "0 9 * * 1-5" },
  ],
  [
    { label: "Weekly (Monday)",  value: "0 0 * * 1" },
    { label: "Monthly (1st)",    value: "0 0 1 * *" },
  ],
];

function parseCron(raw: string): { description: string | null; error: boolean; nextRuns: Date[] } {
  const value = raw.trim();
  if (!value) return { description: null, error: false, nextRuns: [] };
  try {
    const description = cronstrue.toString(value, { throwExceptionOnParseError: true });
    const interval = CronExpressionParser.parse(value);
    const nextRuns: Date[] = [];
    for (let i = 0; i < 3; i++) nextRuns.push(interval.next().toDate());
    return { description, error: false, nextRuns };
  } catch {
    return { description: null, error: true, nextRuns: [] };
  }
}

export function CronInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { description, error, nextRuns } = useMemo(() => parseCron(value), [value]);

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-9 px-2.5 shrink-0 gap-1">
              <Clock className="h-3.5 w-3.5" />
              Presets
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {PRESET_GROUPS.map((group, gi) => (
              <span key={gi}>
                {gi > 0 && <DropdownMenuSeparator />}
                {group.map((p) => (
                  <DropdownMenuItem key={p.value} onClick={() => onChange(p.value)}>
                    <span className="flex-1">{p.label}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{p.value}</span>
                  </DropdownMenuItem>
                ))}
              </span>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="*/5 * * * *  (leave blank for manual only)"
          className={cn("font-mono text-xs", error && "border-destructive focus-visible:ring-destructive")}
        />
      </div>

      {(description || error) && (
        <p className={cn("text-xs pl-0.5", error ? "text-destructive" : "text-green-600 dark:text-green-400")}>
          {error ? "Invalid cron expression" : description}
        </p>
      )}

      {nextRuns.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-0.5">
          <span className="text-xs text-muted-foreground">Next:</span>
          {nextRuns.map((d, i) => (
            <span key={i} className="text-xs text-muted-foreground font-mono">
              {d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
