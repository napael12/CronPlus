import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, ChevronRight, Play, Download, Upload, Pencil, Trash2, Copy, CopyPlus, ClipboardPaste, X, Search, History, MoreHorizontal, FolderKanban, Square } from "lucide-react";
import api, { Project, Workflow, Step, WorkflowRun, StepRun, PaginatedResponse, AppSetting, getApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CronInput } from "@/components/ui/cron-input";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { useProjectStatus, useLiveTick } from "@/hooks/useStatusSocket";

function formatElapsed(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  const secs = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (secs < 0) return "—";
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

function formatRunDuration(
  status: string | null | undefined,
  startIso: string | null | undefined,
  finishIso: string | null | undefined,
): string {
  if (!startIso) return "—";
  if (status === "running") return formatElapsed(startIso);
  if (!finishIso) return "—";
  const secs = (new Date(finishIso).getTime() - new Date(startIso).getTime()) / 1000;
  if (secs < 0) return "—";
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}m ${s}s`;
}

// ── Clipboard types ───────────────────────────────────────────────────────────

interface WorkflowClip { sourceId: number; sourceName: string }
interface StepClip     { sourceId: number; sourceName: string }

// ── Forms ─────────────────────────────────────────────────────────────────────

function ProjectForm({ initial, onSave }: { initial?: Project; onSave: (d: Partial<Project>) => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label>Description</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      </div>
      <Button onClick={() => onSave({ name, description })} className="w-full" disabled={!name.trim()}>
        Save
      </Button>
    </div>
  );
}

function WorkflowForm({
  projectId,
  initial,
  onSave,
}: {
  projectId: number;
  initial?: Workflow;
  onSave: (d: Partial<Workflow>) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [crontab, setCrontab] = useState(initial?.crontab ?? "");
  const [notifySuccess, setNotifySuccess] = useState(initial?.notify_on_success ?? false);
  const [notifyError, setNotifyError] = useState(initial?.notify_on_error ?? true);
  const [recipients, setRecipients] = useState(initial?.notification_recipients ?? "");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label>Description</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      </div>
      <div className="space-y-1">
        <Label>Cron Schedule</Label>
        <CronInput value={crontab} onChange={setCrontab} />
      </div>
      <div className="space-y-1">
        <Label>Notification Recipients</Label>
        <Input
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
          placeholder="email@example.com, other@example.com"
        />
        <p className="text-xs text-muted-foreground">Supports <code>{"{var}"}</code> and <code>{"{env.NAME}"}</code></p>
      </div>
      <div className="flex gap-6 flex-wrap">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={notifySuccess} onChange={(e) => setNotifySuccess(e.target.checked)} />
          Notify on success
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={notifyError} onChange={(e) => setNotifyError(e.target.checked)} />
          Notify on error
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>
      </div>
      <Button
        onClick={() =>
          onSave({
            project: projectId,
            name,
            description,
            crontab,
            notify_on_success: notifySuccess,
            notify_on_error: notifyError,
            notification_recipients: recipients,
            is_active: isActive,
          })
        }
        className="w-full"
        disabled={!name.trim()}
      >
        Save
      </Button>
    </div>
  );
}

type StepOutcome = "continue" | "stop" | "launch_workflow";

function StepForm({
  workflowId,
  projectId,
  initial,
  onSave,
}: {
  workflowId: number;
  projectId: number;
  initial?: Partial<Step>;
  onSave: (d: Partial<Step>) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [command, setCommand] = useState(initial?.command ?? "");
  const [parameters, setParameters] = useState(initial?.parameters ?? "");
  const [workingDir, setWorkingDir] = useState(initial?.working_directory ?? "");
  const [timeout, setTimeout_] = useState(String(initial?.timeout ?? -1));
  const [onSuccess, setOnSuccess] = useState<StepOutcome>(initial?.on_success ?? "continue");
  const [onSuccessWorkflow, setOnSuccessWorkflow] = useState<number | "">(initial?.on_success_workflow ?? "");
  const [onError, setOnError] = useState<StepOutcome>(initial?.on_error ?? "stop");
  const [onErrorWorkflow, setOnErrorWorkflow] = useState<number | "">(initial?.on_error_workflow ?? "");
  const [useShell, setUseShell] = useState(initial?.use_shell ?? false);
  const [order, setOrder] = useState(String(initial?.order ?? 1));
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);

  const needsWorkflows = onSuccess === "launch_workflow" || onError === "launch_workflow";
  const { data: projectWorkflowsData } = useQuery({
    queryKey: ["workflows", projectId],
    queryFn: () =>
      api.get<PaginatedResponse<Workflow>>(`/workflows/?project=${projectId}&page_size=1000`).then((r) => r.data),
    enabled: needsWorkflows,
    staleTime: 30_000,
  });
  const projectWorkflows = projectWorkflowsData?.results ?? [];

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Step Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label>Command</Label>
        <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="python" className="font-mono" />
        <p className="text-xs text-muted-foreground">Supports <code>{"{var}"}</code>, <code>{"{env.NAME}"}</code>, and <code>{"{step.NAME}"}</code></p>
      </div>
      <div className="space-y-1">
        <Label>Parameters</Label>
        <Textarea value={parameters} onChange={(e) => setParameters(e.target.value)} placeholder='-c "print(1)"' className="font-mono text-sm" rows={4} />
        <p className="text-xs text-muted-foreground">Supports <code>{"{var}"}</code>, <code>{"{env.NAME}"}</code>, and <code>{"{step.NAME}"}</code>. Print <code>{"::set-var NAME=value"}</code> to stdout to export a value for later steps.</p>
      </div>
      <div className="space-y-1">
        <Label>Working Directory</Label>
        <Input value={workingDir} onChange={(e) => setWorkingDir(e.target.value)} placeholder="Leave blank for default" className="font-mono" />
        <p className="text-xs text-muted-foreground">Supports <code>{"{var}"}</code>, <code>{"{env.NAME}"}</code>, and <code>{"{step.NAME}"}</code></p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Sequence</Label>
          <Input type="number" min={1} value={order} onChange={(e) => setOrder(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Timeout (seconds)</Label>
          <Input type="number" value={timeout} onChange={(e) => setTimeout_(e.target.value)} placeholder="-1 = no timeout" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>On Success</Label>
          <select
            value={onSuccess}
            onChange={(e) => setOnSuccess(e.target.value as StepOutcome)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
          >
            <option value="continue">Go to Next Step</option>
            <option value="stop">Stop Processing</option>
            <option value="launch_workflow">Launch Workflow</option>
          </select>
          {onSuccess === "launch_workflow" && (
            <select
              value={onSuccessWorkflow}
              onChange={(e) => setOnSuccessWorkflow(Number(e.target.value))}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm mt-1"
            >
              <option value="">— select workflow —</option>
              {projectWorkflows.map((wf) => (
                <option key={wf.id} value={wf.id}>{wf.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="space-y-1">
          <Label>On Error</Label>
          <select
            value={onError}
            onChange={(e) => setOnError(e.target.value as StepOutcome)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
          >
            <option value="continue">Go to Next Step</option>
            <option value="stop">Stop Processing</option>
            <option value="launch_workflow">Launch Workflow</option>
          </select>
          {onError === "launch_workflow" && (
            <select
              value={onErrorWorkflow}
              onChange={(e) => setOnErrorWorkflow(Number(e.target.value))}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm mt-1"
            >
              <option value="">— select workflow —</option>
              {projectWorkflows.map((wf) => (
                <option key={wf.id} value={wf.id}>{wf.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>
      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={useShell} onChange={(e) => setUseShell(e.target.checked)} />
          Run via OS shell
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>
      </div>
      <Button
        onClick={() =>
          onSave({
            workflow: workflowId,
            name,
            command,
            parameters,
            working_directory: workingDir,
            timeout: parseInt(timeout, 10),
            on_success: onSuccess,
            on_success_workflow: onSuccess === "launch_workflow" && onSuccessWorkflow ? Number(onSuccessWorkflow) : null,
            on_error: onError,
            on_error_workflow: onError === "launch_workflow" && onErrorWorkflow ? Number(onErrorWorkflow) : null,
            use_shell: useShell,
            order: parseInt(order, 10),
            is_active: isActive,
          })
        }
        className="w-full"
        disabled={!name.trim() || !command.trim()}
      >
        Save
      </Button>
    </div>
  );
}

// ── Clipboard Banner ──────────────────────────────────────────────────────────

function ClipBanner({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-blue-300 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 px-3 py-1.5 text-xs text-blue-700 dark:text-blue-300">
      <ClipboardPaste className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">{label}</span>
      <button onClick={onClear} className="opacity-60 hover:opacity-100">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Run History dialog ────────────────────────────────────────────────────────

type HistoryTarget = { type: "workflow" | "step"; id: number; name: string; initialRunId?: number };

function WorkflowRunDetail({ runId }: { runId: number }) {
  const { data: run, isLoading } = useQuery({
    queryKey: ["run-detail", runId],
    queryFn: () => api.get<WorkflowRun>(`/runs/${runId}/`).then((r) => r.data),
    staleTime: 30_000,
  });

  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (!run) return null;

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="font-mono font-medium">Run #{run.id}</span>
        <StatusBadge status={run.status} />
        {run.started_at && <span>Started: {new Date(run.started_at).toLocaleString()}</span>}
        {run.duration_seconds != null && <span>Duration: {run.duration_seconds.toFixed(1)}s</span>}
      </div>

      {run.step_runs && run.step_runs.length > 0 ? (
        run.step_runs.map((sr) => (
          <div key={sr.id} className="border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-muted/30">
              <span className="text-xs font-medium">{sr.step_name}</span>
              <div className="flex items-center gap-2">
                <StatusBadge status={sr.status} />
                {sr.duration_seconds != null && (
                  <span className="text-xs text-muted-foreground">{sr.duration_seconds.toFixed(1)}s</span>
                )}
                {sr.exit_code != null && (
                  <span className="text-xs text-muted-foreground">exit {sr.exit_code}</span>
                )}
              </div>
            </div>
            {(sr.stdout || sr.stderr) && (
              <div className="bg-zinc-950 max-h-48 overflow-auto p-3">
                {sr.truncated && (
                  <p className="text-xs text-yellow-400 mb-1">Output truncated</p>
                )}
                {sr.stdout && (
                  <pre className="text-xs text-green-300 whitespace-pre-wrap font-mono">{sr.stdout}</pre>
                )}
                {sr.stderr && (
                  <pre className="text-xs text-red-400 whitespace-pre-wrap font-mono">{sr.stderr}</pre>
                )}
              </div>
            )}
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">No step runs recorded for this run.</p>
      )}
    </div>
  );
}

function StepRunDetail({ stepRun }: { stepRun: StepRun }) {
  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="font-mono font-medium">Step Run #{stepRun.id}</span>
        <StatusBadge status={stepRun.status} />
        {stepRun.exit_code != null && <span>Exit: {stepRun.exit_code}</span>}
        {stepRun.duration_seconds != null && <span>Duration: {stepRun.duration_seconds.toFixed(1)}s</span>}
        {stepRun.peak_cpu_percent != null && <span>Peak CPU: {stepRun.peak_cpu_percent.toFixed(0)}%</span>}
        {stepRun.peak_memory_mb != null && <span>Peak Mem: {stepRun.peak_memory_mb.toFixed(1)} MB</span>}
      </div>

      {stepRun.stdout || stepRun.stderr ? (
        <div className="bg-zinc-950 rounded-lg overflow-auto max-h-72 p-3">
          {stepRun.truncated && (
            <p className="text-xs text-yellow-400 mb-1">Output truncated</p>
          )}
          {stepRun.stdout && (
            <pre className="text-xs text-green-300 whitespace-pre-wrap font-mono">{stepRun.stdout}</pre>
          )}
          {stepRun.stderr && (
            <pre className="text-xs text-red-400 whitespace-pre-wrap font-mono">{stepRun.stderr}</pre>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No output captured.</p>
      )}
    </div>
  );
}

function RunHistoryDialog({
  target,
  onClose,
}: {
  target: HistoryTarget | null;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [histPage, setHistPage] = useState(1);

  useEffect(() => {
    setSelectedId(target?.initialRunId ?? null);
    setHistPage(1);
  }, [target?.id, target?.type, target?.initialRunId]);

  const isWorkflow = target?.type === "workflow";

  const { data: wfRunsData } = useQuery({
    queryKey: ["wf-history", target?.id, histPage],
    queryFn: () =>
      api.get<PaginatedResponse<WorkflowRun>>(`/runs/?workflow=${target!.id}&page=${histPage}`).then((r) => r.data),
    enabled: !!target && isWorkflow,
    staleTime: 10_000,
    refetchInterval: (query) => {
      const data = query.state.data as PaginatedResponse<WorkflowRun> | undefined;
      return data?.results?.some((r) => r.status === "running") ? 3000 : false;
    },
  });

  const { data: stepRunsData } = useQuery({
    queryKey: ["step-history", target?.id, histPage],
    queryFn: () =>
      api.get<PaginatedResponse<StepRun>>(`/step-runs/?step=${target!.id}&page=${histPage}`).then((r) => r.data),
    enabled: !!target && !isWorkflow,
    staleTime: 10_000,
    refetchInterval: (query) => {
      const data = query.state.data as PaginatedResponse<StepRun> | undefined;
      return data?.results?.some((r) => r.status === "running") ? 3000 : false;
    },
  });

  const runs = isWorkflow ? (wfRunsData?.results ?? []) : (stepRunsData?.results ?? []);
  const totalCount = isWorkflow ? wfRunsData?.count : stepRunsData?.count;
  const selectedStepRun = !isWorkflow
    ? (stepRunsData?.results ?? []).find((r) => r.id === selectedId)
    : undefined;

  const thClass = "px-3 py-2 text-left text-xs font-medium text-muted-foreground bg-muted/30";

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-5xl h-[82vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-3.5 border-b shrink-0">
          <DialogTitle className="text-base">
            {isWorkflow ? "Workflow" : "Step"} History
            <span className="ml-2 font-normal text-muted-foreground">— {target?.name}</span>
            {totalCount != null && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">({totalCount} runs)</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Top pane — runs list */}
        <div className="h-[200px] shrink-0 overflow-auto border-b">
          {runs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              No runs found.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr>
                  <th className={thClass}>Run #</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}>Started</th>
                  <th className={thClass}>Finished</th>
                  <th className={thClass}>Duration</th>
                  {isWorkflow ? (
                    <th className={thClass}>Triggered By</th>
                  ) : (
                    <>
                      <th className={thClass}>Step</th>
                      <th className={thClass}>Exit Code</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}
                    className={cn(
                      "border-t cursor-pointer hover:bg-muted/30 transition-colors",
                      selectedId === r.id && "bg-primary/10"
                    )}
                  >
                    <td className="px-3 py-1.5 font-mono font-medium">#{r.id}</td>
                    <td className="px-3 py-1.5"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {r.started_at ? new Date(r.started_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {r.finished_at ? new Date(r.finished_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {r.duration_seconds != null ? `${r.duration_seconds.toFixed(1)}s` : "—"}
                    </td>
                    {isWorkflow ? (
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {(r as WorkflowRun).triggered_by_name ??
                          ((r as WorkflowRun).triggered_by_scheduler ? "Scheduler" : "—")}
                      </td>
                    ) : (
                      <>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {(r as StepRun).step_name || "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          {(r as StepRun).exit_code != null ? (r as StepRun).exit_code : "—"}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Top pane pagination */}
        {totalCount != null && totalCount > 10 && (
          <div className="shrink-0 border-b">
            <Pagination
              page={histPage}
              count={totalCount}
              pageSize={10}
              onChange={(p) => { setHistPage(p); setSelectedId(null); }}
            />
          </div>
        )}

        {/* Bottom pane — run detail */}
        <div className="flex-1 overflow-auto min-h-0">
          {selectedId == null ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Select a run above to view details
            </div>
          ) : isWorkflow ? (
            <WorkflowRunDetail runId={selectedId} />
          ) : selectedStepRun ? (
            <StepRunDetail stepRun={selectedStepRun} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Steps sub-table ───────────────────────────────────────────────────────────

function WorkflowSteps({
  workflow,
  canEdit,
  canRun,
  stepClip,
  onCopyStep,
  onViewHistory,
  requestNewStep,
  onNewStepHandled,
}: {
  workflow: Workflow;
  canEdit: boolean;
  canRun: boolean;
  stepClip: StepClip | null;
  onCopyStep: (step: Step) => void;
  onViewHistory: (step: Step, initialRunId?: number) => void;
  requestNewStep?: boolean;
  onNewStepHandled?: () => void;
}) {
  const qc = useQueryClient();
  const { addToast } = useToast();
  const [stepDialogOpen, setStepDialogOpen] = useState(false);
  const [editStep, setEditStep] = useState<Step | null>(null);
  const [pasteDialog, setPasteDialog] = useState({ open: false, name: "" });
  const [stepPage, setStepPage] = useState(1);

  useEffect(() => {
    if (requestNewStep) {
      setStepDialogOpen(true);
      onNewStepHandled?.();
    }
  }, [requestNewStep]);

  const { data: stepsData } = useQuery({
    queryKey: ["steps", workflow.id, stepPage],
    queryFn: () =>
      api.get<PaginatedResponse<Step>>(`/steps/?workflow=${workflow.id}&page=${stepPage}`).then((r) => r.data),
    staleTime: 30_000,
  });
  const steps = stepsData?.results;
  useLiveTick(1000, !!steps?.some((s) => s.last_run_status === "running"));

  const { data: settingsData } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<PaginatedResponse<AppSetting>>("/settings/").then((r) => r.data),
    staleTime: 300_000,
  });
  const defaultTimeout = parseInt(
    settingsData?.results?.find((s) => s.key === "default_timeout")?.value ?? "-1",
    10,
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ["steps", workflow.id] });

  const createStep = useMutation({
    mutationFn: (d: Partial<Step>) => api.post("/steps/", d),
    onSuccess: () => { invalidate(); setStepDialogOpen(false); addToast("Step created", "success"); },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  const updateStep = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Step> }) => api.patch(`/steps/${id}/`, data),
    onSuccess: () => { invalidate(); setEditStep(null); addToast("Step updated", "success"); },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  const deleteStep = useMutation({
    mutationFn: (id: number) => api.delete(`/steps/${id}/`),
    onSuccess: () => { invalidate(); addToast("Step deleted", "success"); },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  const runStep = useMutation({
    mutationFn: (id: number) => api.post(`/steps/${id}/run/`),
    onSuccess: () => { invalidate(); addToast("Step queued", "success"); },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  const stopStepRun = useMutation({
    mutationFn: (stepRunId: number) => api.post(`/step-runs/${stepRunId}/stop/`),
    onSuccess: () => { invalidate(); addToast("Stop signal sent", "success"); },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  const cloneStep = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      api.post(`/steps/${id}/clone/`, { workflow: workflow.id, name }),
    onSuccess: () => { invalidate(); addToast("Step cloned", "success"); },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  const pasteStep = useMutation({
    mutationFn: ({ sourceId, name }: { sourceId: number; name: string }) =>
      api.post(`/steps/${sourceId}/clone/`, { workflow: workflow.id, name }),
    onSuccess: () => {
      invalidate();
      setPasteDialog({ open: false, name: "" });
      addToast("Step pasted", "success");
    },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  return (
    <tr>
      <td colSpan={8} className="bg-muted/30 border-t-2 border-border/60 pl-[54px] pr-6 pb-3 pt-2">
        {canEdit && stepClip && (
          <div className="flex justify-end mb-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
              onClick={() => setPasteDialog({ open: true, name: `${stepClip.sourceName} (copy)` })}
            >
              <ClipboardPaste className="h-3 w-3 mr-1" />Paste "{stepClip.sourceName}"
            </Button>
          </div>
        )}

        {steps && steps.length > 0 ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left pb-1 pr-3 font-medium w-6" title="Steps sharing the same sequence number run in parallel">Seq</th>
                <th className="text-left pb-1 pr-3 font-medium">Step</th>
                <th className="text-left pb-1 pr-3 font-medium">Command</th>
                <th className="text-left pb-1 pr-3 font-medium">Timeout</th>
                <th className="text-left pb-1 pr-3 font-medium">On Success</th>
                <th className="text-left pb-1 pr-3 font-medium">On Error</th>
                <th className="text-left pb-1 pr-3 font-medium">Active</th>
                <th className="text-left pb-1 pr-3 font-medium">Last Run</th>
                <th className="text-left pb-1 pr-3 font-medium">Last Finished</th>
                <th className="text-left pb-1 pr-3 font-medium">Duration</th>
                <th className="text-left pb-1 pr-3 font-medium">Status</th>
                <th className="text-left pb-1 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((s) => (
                <tr key={s.id} className="border-t border-border/50">
                  <td className="py-1.5 pr-3 text-muted-foreground">{s.order}</td>
                  <td className="py-1.5 pr-3 font-medium">{s.name}</td>
                  <td className="py-1.5 pr-3 font-mono truncate max-w-xs">{s.command} {s.parameters}</td>
                  <td className="py-1.5 pr-3">{s.timeout === -1 ? "∞" : `${s.timeout}s`}</td>
                  <td className="py-1.5 pr-3">{s.on_success === "launch_workflow" ? "Launch WF" : s.on_success === "stop" ? "Stop" : "Continue"}</td>
                  <td className="py-1.5 pr-3">{s.on_error === "launch_workflow" ? "Launch WF" : s.on_error === "stop" ? "Stop" : "Continue"}</td>
                  <td className="py-1.5 pr-3">
                    <span className={s.is_active ? "text-green-600" : "text-muted-foreground"}>
                      {s.is_active ? "Yes" : "No"}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-muted-foreground text-xs">
                    {s.last_run_at ? new Date(s.last_run_at).toLocaleString() : "—"}
                  </td>
                  <td className="py-1.5 pr-3 text-muted-foreground text-xs">
                    {s.last_run_finished_at ? new Date(s.last_run_finished_at).toLocaleString() : "—"}
                  </td>
                  <td className="py-1.5 pr-3 font-mono">
                    {formatRunDuration(s.last_run_status, s.last_run_at, s.last_run_finished_at)}
                  </td>
                  <td className="py-1.5 pr-3">
                    {s.last_run_status ? (
                      <button
                        className="cursor-pointer hover:opacity-80"
                        onClick={() => onViewHistory(s, s.last_run_id ?? undefined)}
                        title="View latest run"
                      >
                        <StatusBadge status={s.last_run_status} />
                      </button>
                    ) : "—"}
                  </td>
                  <td className="py-1.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      {canEdit && (
                        <Button size="icon" variant="ghost" className="h-6 w-6" title="Edit" onClick={() => setEditStep(s)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-6 w-6">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canRun && (
                            <DropdownMenuItem onClick={() => runStep.mutate(s.id)} disabled={runStep.isPending}>
                              <Play className="h-3.5 w-3.5" />Run
                            </DropdownMenuItem>
                          )}
                          {canRun && s.last_run_status === "running" && s.last_run_id != null && (
                            <DropdownMenuItem
                              destructive
                              onClick={() => {
                                if (confirm(`Stop currently running step "${s.name}"? This will also stop all subsequent steps in the workflow.`))
                                  stopStepRun.mutate(s.last_run_id!);
                              }}
                              disabled={stopStepRun.isPending}
                            >
                              <Square className="h-3.5 w-3.5" />Stop Process
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => onViewHistory(s)}>
                            <History className="h-3.5 w-3.5" />History
                          </DropdownMenuItem>
                          {canEdit && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => cloneStep.mutate({ id: s.id, name: `${s.name} (copy)` })} disabled={cloneStep.isPending}>
                                <CopyPlus className="h-3.5 w-3.5" />Clone
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => { onCopyStep(s); addToast(`"${s.name}" copied`, "info"); }}>
                                <Copy className="h-3.5 w-3.5" />Copy to Clipboard
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem destructive onClick={() => { if (confirm(`Delete step "${s.name}"?`)) deleteStep.mutate(s.id); }}>
                                <Trash2 className="h-3.5 w-3.5" />Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-muted-foreground py-1">No steps yet.</p>
        )}
        {stepsData && stepsData.count > 10 && (
          <div className="mt-1 border rounded-md">
            <Pagination page={stepPage} count={stepsData.count} pageSize={10} onChange={setStepPage} />
          </div>
        )}

        {/* New step dialog */}
        <Dialog open={stepDialogOpen} onOpenChange={setStepDialogOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>New Step — {workflow.name}</DialogTitle></DialogHeader>
            <StepForm workflowId={workflow.id} projectId={workflow.project} initial={{ order: 1, timeout: defaultTimeout }} onSave={(d) => createStep.mutate(d)} />
          </DialogContent>
        </Dialog>

        {/* Edit step dialog */}
        <Dialog open={!!editStep} onOpenChange={(open) => { if (!open) setEditStep(null); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit Step — {editStep?.name}</DialogTitle></DialogHeader>
            {editStep && (
              <StepForm
                workflowId={workflow.id}
                projectId={workflow.project}
                initial={editStep}
                onSave={(d) => updateStep.mutate({ id: editStep.id, data: d })}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* Paste step dialog */}
        <Dialog open={pasteDialog.open} onOpenChange={(open) => { if (!open) setPasteDialog({ open: false, name: "" }); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Paste Step into "{workflow.name}"</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Step Name</Label>
                <Input
                  value={pasteDialog.name}
                  onChange={(e) => setPasteDialog((d) => ({ ...d, name: e.target.value }))}
                  autoFocus
                />
              </div>
              <Button
                className="w-full"
                disabled={!pasteDialog.name.trim() || pasteStep.isPending}
                onClick={() => stepClip && pasteStep.mutate({ sourceId: stepClip.sourceId, name: pasteDialog.name })}
              >
                <ClipboardPaste className="h-4 w-4 mr-2" />Paste Step
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ProjectsPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const qc = useQueryClient();
  const canEdit = user?.role === "admin";
  const canRun = user?.role === "admin" || user?.role === "operator";

  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [selectedProjectName, setSelectedProjectName] = useState<string | null>(null);
  const [expandedWorkflow, setExpandedWorkflow] = useState<number | null>(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [workflowDialogOpen, setWorkflowDialogOpen] = useState(false);
  const [editWorkflow, setEditWorkflow] = useState<Workflow | null>(null);

  const [projectFilter, setProjectFilter] = useState("");
  const [projectPage, setProjectPage] = useState(1);
  const [workflowPage, setWorkflowPage] = useState(1);

  // Clipboard state
  const [workflowClip, setWorkflowClip] = useState<WorkflowClip | null>(null);
  const [stepClip, setStepClip] = useState<StepClip | null>(null);

  // Run history dialog
  const [historyTarget, setHistoryTarget] = useState<HistoryTarget | null>(null);

  // Paste workflow dialog
  const [pasteWfDialog, setPasteWfDialog] = useState<{ open: boolean; name: string; targetProjectId: number | null }>({
    open: false, name: "", targetProjectId: null,
  });

  // New step triggered from workflow action dropdown
  const [newStepForWorkflow, setNewStepForWorkflow] = useState<number | null>(null);

  // Server-push status updates via WebSocket
  useProjectStatus(selectedProject);

  const { data: projectsData } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<PaginatedResponse<Project>>("/projects/?page_size=1000").then((r) => r.data),
  });
  const projects = projectsData?.results;

  const { data: workflowsData } = useQuery({
    queryKey: ["workflows", selectedProject, workflowPage],
    queryFn: () =>
      api.get<PaginatedResponse<Workflow>>(`/workflows/?project=${selectedProject}&page=${workflowPage}`)
        .then((r) => r.data),
    enabled: selectedProject !== null,
    staleTime: 30_000,
  });
  const workflows = workflowsData?.results;
  useLiveTick(1000, !!workflows?.some((wf) => wf.last_run_status === "running"));

  const invalidateWorkflows = () => {
    qc.invalidateQueries({ queryKey: ["workflows", selectedProject] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const createProject = useMutation({
    mutationFn: (d: Partial<Project>) => api.post("/projects/", d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projects"] }); setProjectDialogOpen(false); addToast("Project created", "success"); },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  const createWorkflow = useMutation({
    mutationFn: (d: Partial<Workflow>) => api.post("/workflows/", d),
    onSuccess: () => { invalidateWorkflows(); setWorkflowDialogOpen(false); addToast("Workflow created", "success"); },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  const updateWorkflow = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Workflow> }) => api.patch(`/workflows/${id}/`, data),
    onSuccess: () => { invalidateWorkflows(); setEditWorkflow(null); addToast("Workflow updated", "success"); },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  const [deleteProjectTarget, setDeleteProjectTarget] = useState<{ id: number; name: string } | null>(null);
  const [editProject, setEditProject] = useState<Project | null>(null);

  const deleteProject = useMutation({
    mutationFn: (id: number) => api.delete(`/projects/${id}/`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      if (selectedProject === id) {
        setSelectedProject(null);
        setSelectedProjectName(null);
        setExpandedWorkflow(null);
      }
      addToast("Project deleted", "success");
      setDeleteProjectTarget(null);
    },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  const updateProject = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Project> }) =>
      api.patch<Project>(`/projects/${id}/`, data),
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      if (selectedProject === vars.id) setSelectedProjectName(res.data.name);
      setEditProject(null);
      addToast("Project renamed", "success");
    },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  const deleteWorkflow = useMutation({
    mutationFn: (id: number) => api.delete(`/workflows/${id}/`),
    onSuccess: () => { invalidateWorkflows(); setExpandedWorkflow(null); addToast("Workflow deleted", "success"); },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  const runWorkflow = useMutation({
    mutationFn: (id: number) => api.post(`/workflows/${id}/run/`),
    onSuccess: () => { invalidateWorkflows(); addToast("Workflow queued", "success"); },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  const stopWorkflowRun = useMutation({
    mutationFn: (runId: number) => api.post(`/runs/${runId}/stop/`),
    onSuccess: () => { invalidateWorkflows(); addToast("Stop signal sent", "success"); },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  const cloneWorkflow = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      api.post(`/workflows/${id}/clone/`, { project: selectedProject, name }),
    onSuccess: () => { invalidateWorkflows(); addToast("Workflow cloned", "success"); },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  const pasteWorkflow = useMutation({
    mutationFn: ({ sourceId, name, projectId }: { sourceId: number; name: string; projectId: number }) =>
      api.post(`/workflows/${sourceId}/clone/`, { project: projectId, name }),
    onSuccess: (_, vars) => {
      // Refresh the target project's workflows if it's currently selected
      if (vars.projectId === selectedProject) invalidateWorkflows();
      qc.invalidateQueries({ queryKey: ["projects"] });
      setPasteWfDialog({ open: false, name: "", targetProjectId: null });
      addToast("Workflow pasted", "success");
    },
    onError: (err) => addToast(getApiError(err), "error"),
  });

  const exportProject = async (id: number) => {
    try {
      const { data } = await api.get(`/projects/${id}/export/`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `project-${id}.json`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      addToast(getApiError(err), "error");
    }
  };

  const uploadInputRef = useRef<HTMLInputElement>(null);

  const importProject = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await api.post("/projects/import_project/", data);
      qc.invalidateQueries({ queryKey: ["projects"] });
      addToast(`Project "${data.name ?? file.name}" imported`, "success");
    } catch (err) {
      addToast(getApiError(err), "error");
    } finally {
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  };

  const openPasteWfDialog = () => {
    if (!workflowClip) return;
    setPasteWfDialog({
      open: true,
      name: `${workflowClip.sourceName} (copy)`,
      targetProjectId: selectedProject,
    });
  };

  const filteredProjects = projects?.filter((p) => {
    const q = projectFilter.toLowerCase();
    return !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
  }) ?? [];
  const filteredProjectsPage = filteredProjects.slice((projectPage - 1) * 10, projectPage * 10);

  const handleProjectFilterChange = (v: string) => {
    setProjectFilter(v);
    setProjectPage(1);
  };

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-3rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0">
        <h1 className="text-2xl font-bold shrink-0 flex items-center gap-2"><FolderKanban className="h-6 w-6" />Projects</h1>
      </div>

      {/* Clipboard banners */}
      {(workflowClip || stepClip) && (
        <div className="flex flex-wrap gap-2 shrink-0">
          {workflowClip && (
            <ClipBanner
              label={`Workflow "${workflowClip.sourceName}" copied — select a project and click Paste`}
              onClear={() => setWorkflowClip(null)}
            />
          )}
          {stepClip && (
            <ClipBanner
              label={`Step "${stepClip.sourceName}" copied — expand a workflow and click Paste`}
              onClear={() => setStepClip(null)}
            />
          )}
        </div>
      )}

      {/* Delete project confirmation dialog */}
      <Dialog open={!!deleteProjectTarget} onOpenChange={(open) => { if (!open) setDeleteProjectTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete <span className="font-medium text-foreground">"{deleteProjectTarget?.name}"</span>?
            This will permanently remove all its workflows, steps, and run history.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteProjectTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteProject.isPending}
              onClick={() => deleteProjectTarget && deleteProject.mutate(deleteProjectTarget.id)}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Two-panel grid */}
      <div className="flex gap-4 flex-1 min-h-0">

        {/* Left panel — project list */}
        <div className="w-64 shrink-0 flex flex-col border rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b shrink-0">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex-1">
              Projects
              {filteredProjects.length > 0 && (
                <span className="ml-1 font-normal">({filteredProjects.length})</span>
              )}
            </span>
            {canEdit && (
              <>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) importProject(file);
                  }}
                />
                <button
                  onClick={() => setProjectDialogOpen(true)}
                  title="New project"
                  className="rounded p-0.5 hover:bg-accent"
                >
                  <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <button
                  onClick={() => uploadInputRef.current?.click()}
                  title="Import project from JSON"
                  className="rounded p-0.5 hover:bg-accent"
                >
                  <Upload className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </>
            )}
          </div>

          {/* Search */}
          <div className="px-2 py-1.5 border-b shrink-0">
            <div className="relative">
              <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={projectFilter}
                onChange={(e) => handleProjectFilterChange(e.target.value)}
                placeholder="Filter…"
                className="h-7 pl-7 text-xs"
              />
            </div>
          </div>

          {/* Project rows */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {filteredProjects.length === 0 ? (
              <p className="px-3 py-6 text-xs text-muted-foreground text-center">
                {projectFilter ? "No matches." : "No projects yet."}
              </p>
            ) : (
              filteredProjectsPage.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    const next = p.id === selectedProject ? null : p.id;
                    setSelectedProject(next);
                    setSelectedProjectName(next ? p.name : null);
                    setExpandedWorkflow(null);
                    setWorkflowPage(1);
                  }}
                  className={cn(
                    "w-full flex items-start gap-2 px-3 py-2.5 text-left border-b border-border/50 hover:bg-muted/40 transition-colors",
                    selectedProject === p.id && "bg-primary/10 border-l-2 border-l-primary"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-xs font-medium truncate", selectedProject === p.id && "text-primary")}>
                      {p.name}
                    </p>
                    {p.description && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{p.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">{p.workflow_count} workflow{p.workflow_count !== 1 ? "s" : ""}</p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0 mt-0.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => exportProject(p.id)}
                      title="Export"
                      className="rounded p-0.5 hover:bg-accent"
                    >
                      <Download className="h-3 w-3 text-muted-foreground" />
                    </button>
                    {canEdit && (
                      <button
                        onClick={() => setEditProject(p)}
                        title="Rename project"
                        className="rounded p-0.5 hover:bg-accent"
                      >
                        <Pencil className="h-3 w-3 text-muted-foreground" />
                      </button>
                    )}
                    {canEdit && (
                      <button
                        onClick={() => setDeleteProjectTarget({ id: p.id, name: p.name })}
                        title="Delete project"
                        className="rounded p-0.5 hover:bg-accent"
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </button>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
          <Pagination page={projectPage} count={filteredProjects.length} pageSize={10} onChange={setProjectPage} />
        </div>

        {/* Right panel — workflows */}
        <div className="flex-1 min-w-0 flex flex-col">
          {!selectedProject ? (
            <div className="flex-1 flex items-center justify-center border rounded-lg text-sm text-muted-foreground">
              Select a project to view its workflows
            </div>
          ) : (
            <div className="flex flex-col flex-1 min-h-0">
              {/* Workflows header */}
              <div className="flex items-center justify-between mb-3 gap-2 shrink-0">
                <h2 className="text-lg font-semibold">
                  {selectedProjectName}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">— Workflows</span>
                </h2>
                <div className="flex items-center gap-1.5">
                  {canEdit && workflowClip && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-blue-300 text-blue-700 hover:bg-blue-50"
                      onClick={openPasteWfDialog}
                    >
                      <ClipboardPaste className="h-4 w-4 mr-1" />Paste "{workflowClip.sourceName}"
                    </Button>
                  )}
                  {canEdit && (
                    <Button size="sm" onClick={() => setWorkflowDialogOpen(true)}>
                      <Plus className="h-4 w-4 mr-1" />New Workflow
                    </Button>
                  )}
                </div>
              </div>

              {/* Workflows table */}
              <div className="overflow-auto rounded-lg border flex-1">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium w-6" />
                      <th className="px-4 py-2 text-left font-medium">Name</th>
                      <th className="px-4 py-2 text-left font-medium">Schedule</th>
                      <th className="px-4 py-2 text-left font-medium">Next Run</th>
                      <th className="px-4 py-2 text-left font-medium">Last Run</th>
                      <th className="px-4 py-2 text-left font-medium">Last Finished</th>
                      <th className="px-4 py-2 text-left font-medium">Duration</th>
                      <th className="px-4 py-2 text-left font-medium">Last Status</th>
                      <th className="px-4 py-2 text-left font-medium">Active</th>
                      <th className="px-4 py-2 text-left font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workflows?.map((wf) => (
                      <>
                        <tr
                          key={wf.id}
                          className="border-t hover:bg-muted/20 cursor-pointer"
                          onClick={() => setExpandedWorkflow(expandedWorkflow === wf.id ? null : wf.id)}
                        >
                          <td className="px-3 py-2">
                            <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expandedWorkflow === wf.id ? "rotate-90" : ""}`} />
                          </td>
                          <td className="px-4 py-2 font-medium">
                            <div className="flex items-center gap-2">
                              {wf.last_run_status === "running" && (
                                <span className="inline-block h-2 w-2 rounded-full bg-blue-500 animate-pulse shrink-0" />
                              )}
                              {wf.name}
                            </div>
                          </td>
                          <td className="px-4 py-2 font-mono text-xs">{wf.crontab || "—"}</td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">
                            {wf.next_run_at ? new Date(wf.next_run_at).toLocaleString() : "—"}
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">
                            {wf.last_run_at ? new Date(wf.last_run_at).toLocaleString() : "—"}
                          </td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">
                            {wf.last_run_finished_at ? new Date(wf.last_run_finished_at).toLocaleString() : "—"}
                          </td>
                          <td className="px-4 py-2 text-xs font-mono">
                            {formatRunDuration(wf.last_run_status, wf.last_run_at, wf.last_run_finished_at)}
                          </td>
                          <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                            {wf.last_run_status ? (
                              <button
                                className="cursor-pointer hover:opacity-80"
                                onClick={() => setHistoryTarget({ type: "workflow", id: wf.id, name: wf.name, initialRunId: wf.last_run_id ?? undefined })}
                                title="View latest run"
                              >
                                <StatusBadge status={wf.last_run_status} />
                              </button>
                            ) : "—"}
                          </td>
                          <td className="px-4 py-2">
                            <span className={wf.is_active ? "text-green-600" : "text-muted-foreground"}>
                              {wf.is_active ? "Yes" : "No"}
                            </span>
                          </td>
                          <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1">
                              {canEdit && (
                                <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => setEditWorkflow(wf)}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="icon" variant="ghost" className="h-7 w-7">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {canRun && (
                                    <DropdownMenuItem onClick={() => runWorkflow.mutate(wf.id)} disabled={runWorkflow.isPending}>
                                      <Play className="h-3.5 w-3.5" />Run
                                    </DropdownMenuItem>
                                  )}
                                  {canRun && wf.last_run_status === "running" && wf.last_run_id != null && (
                                    <DropdownMenuItem
                                      destructive
                                      onClick={() => {
                                        if (confirm(`Stop currently running workflow "${wf.name}"? All subsequent steps will be cancelled.`))
                                          stopWorkflowRun.mutate(wf.last_run_id!);
                                      }}
                                      disabled={stopWorkflowRun.isPending}
                                    >
                                      <Square className="h-3.5 w-3.5" />Stop Process
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem onClick={() => setHistoryTarget({ type: "workflow", id: wf.id, name: wf.name })}>
                                    <History className="h-3.5 w-3.5" />History
                                  </DropdownMenuItem>
                                  {canEdit && (
                                    <DropdownMenuItem onClick={() => {
                                      setExpandedWorkflow(wf.id);
                                      setNewStepForWorkflow(wf.id);
                                    }}>
                                      <Plus className="h-3.5 w-3.5" />New Step
                                    </DropdownMenuItem>
                                  )}
                                  {canEdit && (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem onClick={() => cloneWorkflow.mutate({ id: wf.id, name: `${wf.name} (copy)` })} disabled={cloneWorkflow.isPending}>
                                        <CopyPlus className="h-3.5 w-3.5" />Clone
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => { setWorkflowClip({ sourceId: wf.id, sourceName: wf.name }); addToast(`"${wf.name}" copied`, "info"); }}>
                                        <Copy className="h-3.5 w-3.5" />Copy to Clipboard
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem destructive onClick={() => { if (confirm(`Delete workflow "${wf.name}"?`)) deleteWorkflow.mutate(wf.id); }}>
                                        <Trash2 className="h-3.5 w-3.5" />Delete
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </td>
                        </tr>

                        {expandedWorkflow === wf.id && (
                          <WorkflowSteps
                            workflow={wf}
                            canEdit={canEdit}
                            canRun={canRun}
                            stepClip={stepClip}
                            onCopyStep={(s) => setStepClip({ sourceId: s.id, sourceName: s.name })}
                            onViewHistory={(s, initialRunId) => setHistoryTarget({ type: "step", id: s.id, name: s.name, initialRunId })}
                            requestNewStep={newStepForWorkflow === wf.id}
                            onNewStepHandled={() => setNewStepForWorkflow(null)}
                          />
                        )}
                      </>
                    ))}
                    {workflows?.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-4 py-6 text-center text-muted-foreground">
                          No workflows yet. Click "New Workflow" to add one.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <Pagination page={workflowPage} count={workflowsData?.count ?? 0} pageSize={10} onChange={setWorkflowPage} />
              </div>
            </div>
          )}
        </div>

      </div>

      {/* New project dialog */}
      <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Project</DialogTitle></DialogHeader>
          <ProjectForm onSave={(d) => createProject.mutate(d)} />
        </DialogContent>
      </Dialog>

      {/* Edit project dialog */}
      <Dialog open={!!editProject} onOpenChange={(open) => { if (!open) setEditProject(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename Project — {editProject?.name}</DialogTitle></DialogHeader>
          {editProject && (
            <ProjectForm
              initial={editProject}
              onSave={(d) => updateProject.mutate({ id: editProject.id, data: d })}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* New workflow dialog */}
      {selectedProject && (
        <Dialog open={workflowDialogOpen} onOpenChange={setWorkflowDialogOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>New Workflow</DialogTitle></DialogHeader>
            <WorkflowForm projectId={selectedProject} onSave={(d) => createWorkflow.mutate(d)} />
          </DialogContent>
        </Dialog>
      )}

      {/* Edit workflow dialog */}
      {selectedProject && (
        <Dialog open={!!editWorkflow} onOpenChange={(open) => { if (!open) setEditWorkflow(null); }}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit Workflow — {editWorkflow?.name}</DialogTitle></DialogHeader>
            {editWorkflow && (
              <WorkflowForm
                projectId={selectedProject}
                initial={editWorkflow}
                onSave={(d) => updateWorkflow.mutate({ id: editWorkflow.id, data: d })}
              />
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* Paste workflow dialog */}
      <Dialog open={pasteWfDialog.open} onOpenChange={(open) => { if (!open) setPasteWfDialog({ open: false, name: "", targetProjectId: null }); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Paste Workflow</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Workflow Name</Label>
              <Input
                value={pasteWfDialog.name}
                onChange={(e) => setPasteWfDialog((d) => ({ ...d, name: e.target.value }))}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label>Target Project</Label>
              <select
                value={pasteWfDialog.targetProjectId ?? ""}
                onChange={(e) => setPasteWfDialog((d) => ({ ...d, targetProjectId: Number(e.target.value) }))}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                {projects?.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <Button
              className="w-full"
              disabled={!pasteWfDialog.name.trim() || !pasteWfDialog.targetProjectId || pasteWorkflow.isPending}
              onClick={() =>
                workflowClip &&
                pasteWfDialog.targetProjectId &&
                pasteWorkflow.mutate({
                  sourceId: workflowClip.sourceId,
                  name: pasteWfDialog.name,
                  projectId: pasteWfDialog.targetProjectId,
                })
              }
            >
              <ClipboardPaste className="h-4 w-4 mr-2" />Paste Workflow
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Run history dialog */}
      <RunHistoryDialog
        target={historyTarget}
        onClose={() => setHistoryTarget(null)}
      />
    </div>
  );
}
