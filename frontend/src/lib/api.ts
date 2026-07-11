import axios from "axios";

const api = axios.create({
  baseURL: "/api/v1",
  withCredentials: true,
});

function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

// Attach the CSRF token on every mutating request so it's always current
api.interceptors.request.use((config) => {
  const method = config.method?.toUpperCase() ?? "";
  if (!["GET", "HEAD", "OPTIONS", "TRACE"].includes(method)) {
    const token = getCsrfToken();
    if (token) config.headers["X-CSRFToken"] = token;
  }
  return config;
});

// Fetch CSRF cookie on startup
api.get("/auth/csrf/").catch(() => {});

export default api;

// ---- Type definitions ----

export type Role = "admin" | "operator" | "read_only";

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  date_joined: string;
}

export interface Variable {
  id: number;
  name: string;
  expression: string;
  description: string;
  updated_at: string;
  updated_by: number | null;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  workflow_count: number;
}

export interface Step {
  id: number;
  workflow: number;
  name: string;
  description: string;
  is_active: boolean;
  command: string;
  parameters: string;
  working_directory: string;
  use_shell: boolean;
  timeout: number;
  on_success: "continue" | "stop" | "launch_workflow";
  on_success_workflow: number | null;
  on_error: "continue" | "stop" | "launch_workflow";
  on_error_workflow: number | null;
  order: number;
  run_parallel: boolean;
  created_at: string;
  updated_at: string;
  last_run_status?: string | null;
  last_run_at?: string | null;
  last_run_id?: number | null;
  last_run_finished_at?: string | null;
}

export interface WorkflowMember {
  id: number;
  parent: number;
  step: number | null;
  child_workflow: number | null;
  order: number;
  run_parallel: boolean;
}

export interface Workflow {
  id: number;
  project: number;
  name: string;
  description: string;
  is_active: boolean;
  crontab: string;
  notify_on_success: boolean;
  notify_on_error: boolean;
  notification_recipients: string;
  created_at: string;
  updated_at: string;
  steps: Step[];
  members: WorkflowMember[];
  // list-only fields
  last_run_status?: string | null;
  last_run_at?: string | null;
  last_run_id?: number | null;
  last_run_finished_at?: string | null;
  next_run_at?: string | null;
}

export interface StepRun {
  id: number;
  workflow_run: number;
  step: number | null;
  step_name: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  peak_cpu_percent: number | null;
  peak_memory_mb: number | null;
  truncated: boolean;
  duration_seconds: number | null;
  output_vars: Record<string, string>;
}

export interface WorkflowRun {
  id: number;
  workflow: number;
  workflow_name?: string;
  project_name?: string;
  triggered_by: number | null;
  triggered_by_name?: string;
  triggered_by_scheduler: boolean;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  step_name?: string | null;
  step_runs?: StepRun[];
}

export interface AppSetting {
  id: number;
  key: string;
  label: string;
  value: string;
  description: string;
  updated_at: string;
}

export interface AuditLog {
  id: number;
  user: number | null;
  user_name: string;
  action: "create" | "update" | "delete";
  entity_type: string;
  entity_id: string;
  entity_name: string;
  detail: Record<string, unknown>;
  timestamp: string;
}

export interface DashboardData {
  running: WorkflowRun[];
  recent: WorkflowRun[];
  scheduled: { id: number; name: string; project_name: string; next_run: string }[];
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export function getApiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = (err as any)?.response?.data;
    if (!data) return err.message ?? "Request failed";
    if (typeof data === "string") return data;
    if (data.detail) return String(data.detail);
    // Field-level validation errors: { field: ["msg", ...] }
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length) {
      return entries
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
        .join("; ");
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred";
}
