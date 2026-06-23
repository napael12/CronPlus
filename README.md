# CronPlus

A workflow scheduling and execution manager built with Django, Huey, and React.

## Overview

CronPlus organises work into **Projects → Workflows → Steps**. Workflows can be scheduled via crontab expressions or triggered manually. Steps launch OS processes and stream live output back to the browser over WebSocket.

---

## Architecture

| Layer | Technology |
|---|---|
| Backend API | Django 4.2 + Django REST Framework |
| Task queue / scheduler | Huey 2.x (SQLite broker) |
| Real-time logs | Django Channels 4 (WebSocket, in-memory layer) |
| Frontend | React 18 + Vite + Tailwind CSS v4 + shadcn/ui |
| Database | SQLite (default) |
| Process server | Daphne (ASGI) |

---

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+

### Backend

```bash
cd backend
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser   # follow prompts — email is username
python manage.py runserver         # Django dev server on :8000
```

In a second terminal, start the Huey worker (required for scheduled and queued runs):

```bash
cd backend
python manage.py run_huey
```

### Frontend (development)

```bash
cd frontend
npm install
npm run dev    # Vite dev server on :5173 with proxy to :8000
```

Open `http://localhost:5173` and sign in with the superuser credentials you created.

### Frontend (production build)

```bash
cd frontend
npm run build   # outputs to backend/static/frontend/
```

Django's WhiteNoise middleware serves the built assets. Set `DEBUG=false` and point a reverse proxy at Daphne:

```bash
cd backend
daphne -b 0.0.0.0 -p 8000 cronplus.asgi:application
```

---

## Configuration

Settings can be overridden via environment variables (or a `.env` file in `backend/`). Additional runtime settings are stored in the database and managed via **Admin → Settings** in the UI.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SECRET_KEY` | dev key | Django secret key — change in production |
| `DEBUG` | `true` | Set `false` in production |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1` | Comma-separated allowed hosts |
| `DB_NAME` | `cronplus.db` | SQLite filename |
| `SESSION_COOKIE_AGE` | `86400` | Session lifetime in seconds |
| `LOG_RETENTION_DAYS` | `60` | Days to keep run history (env-var fallback) |
| `LOG_MAX_OUTPUT_BYTES` | `10485760` | Max captured stdout/stderr per step (10 MB) |
| `HUEY_WORKERS` | `4` | Huey worker thread count |
| `CRONPLUS_INSTANCE_NAME` | `CronPlus` | Appears in notification email subjects |
| `NOTIFICATION_PORT` | `587` | Default SMTP port (override in Settings UI) |
| `NOTIFICATION_SENDER` | _(empty)_ | Default From address (override in Settings UI) |

### Database Settings (Admin → Settings)

| Key | Label | Description |
|---|---|---|
| `notification_mailhost` | Notification mailhost:port | SMTP server in `host:port` format |
| `notification_sender` | Notification Sender | From address for notification emails |
| `notification_mailhost_user` | Mailhost User | SMTP authentication username |
| `notification_mailhost_password` | Mailhost Password | SMTP authentication password (masked in UI) |
| `default_timeout` | Default Timeout (seconds) | Default step execution timeout |
| `log_retention_days` | Retain Logs (days) | How long to keep run history |

Database settings take precedence over environment variables when both are set.

---

## Data Model

```
Project
  └── Workflow  (crontab schedule, notification settings)
        └── Step  (command, parameters, working dir, timeout, order)
```

### Projects

Projects are the top-level grouping for workflows. Each project has a name, optional description, and an active flag. Projects can be **renamed** via the pencil icon in the Projects view.

### Workflows

Each workflow belongs to a project and contains an ordered list of steps. Workflow settings:

- **Crontab** — standard 5-field cron expression (`*/5 * * * *`). Blank = no automatic schedule.
- **Active** — inactive workflows are skipped by the scheduler. Manual runs ignore this flag.
- **Notify on Success / Notify on Error** — send email notifications on completion.
- **Notification Recipients** — comma-separated email addresses.
- **Concurrent run policy** — if a workflow is already running, new triggers are silently skipped.

### Steps

Each step launches an OS subprocess:

| Field | Description |
|---|---|
| **Command** | Executable path or name |
| **Parameters** | Arguments appended to the command (supports `{variable}` substitution) |
| **Working Directory** | Optional `cwd` for the process |
| **Use Shell** | Run via OS shell — enables pipes, globs, shell builtins |
| **Timeout** | Seconds before the process is killed; `-1` = no timeout |
| **Sequence** | Order of execution. Steps with the **same sequence number run in parallel**. |
| **On Success** | What to do when the step succeeds: `continue`, `stop`, or `launch_workflow` |
| **On Error** | What to do when the step fails: `continue`, `stop`, or `launch_workflow` |

---

## Parallel Execution

Steps sharing the same **Sequence** (order) number are launched concurrently. The next sequence number starts only after all steps in the current group have finished.

**Example: three-stage pipeline with parallel tasks**

```
Seq 1:  Extract Data          (sequential — must complete first)
Seq 2:  Transform Orders      (parallel —┐
Seq 2:  Transform Customers   (parallel —┘ both run at the same time)
Seq 3:  Load to Data Warehouse (sequential — waits for both Seq 2 steps)
```

All steps in a parallel group must declare the same **On Success** and **On Error** outcomes. If they differ, CronPlus logs an error and uses the first step's values to route the outcome.

```
Seq 2:  Transform Orders    on_success=continue  on_error=stop
Seq 2:  Transform Customers on_success=continue  on_error=stop   ✓ consistent
```

```
Seq 2:  Transform Orders    on_success=continue  on_error=stop
Seq 2:  Transform Customers on_success=stop      on_error=stop   ✗ ERROR logged
```

---

## Variables

Variables provide dynamic substitution in Step and Workflow fields.

Define variables in **Variables → New Variable**. Use them in any text field with `{variable_name}` syntax.

The **Expression** field accepts:

| Type | Example expression | Resolved value |
|---|---|---|
| Plain text | `production` | `production` |
| Date stamp | `datetime.datetime.now().strftime("%Y%m%d")` | `20260101` |
| Math | `1024 * 10` | `10240` |
| Conditional | `"yes" if 1 > 0 else "no"` | `yes` |

Evaluation is sandboxed — only `datetime`, `math`, standard types, and string operations are available. Arbitrary imports and file access are blocked.

**Example step with variable substitution:**

```
Command:    python
Parameters: scripts/export.py --date {run_date} --env {environment}
```

If `run_date` resolves to `20260101` and `environment` resolves to `production`, the subprocess receives:

```
python scripts/export.py --date 20260101 --env production
```

---

## Notifications

Configure SMTP in **Admin → Settings**:

1. Set **Notification mailhost:port** (e.g. `smtp.example.com:587`)
2. Set **Notification Sender** (e.g. `cronplus@example.com`)
3. Optionally set **Mailhost User** and **Mailhost Password** for authenticated SMTP

On each workflow, enable **Notify on Success** and/or **Notify on Error**, then enter comma-separated email addresses in **Notification Recipients**.

Email subject format: `CronPlus {instance} - {workflow}: {STATUS}`

The email body includes workflow name, project, status, start/end times, duration, and — for failed runs — the first 500 characters of stderr from the failing step.

---

## Monitor / Dashboard

The Monitor page shows live and recent execution state across four grids:

| Grid | Content |
|---|---|
| **Currently Running** | Workflows actively executing, with current Step name |
| **Recently Completed** | Last N workflow runs, with final Step name |
| **Upcoming Scheduled** | Next scheduled runs for active workflows with crontabs |
| **Run History** | Full paginated run history, filterable and sortable |

All grids show a **Step** column (the step currently executing or last executed). Live status updates stream over WebSocket without page refresh.

---

## Import / Export

Projects and Workflows can be exported as JSON from their respective views. Imports are accepted at `POST /api/v1/projects/import_project/`.

On import:
- Duplicate names are skipped (existing records retained).
- Unresolved `{variable}` references are imported as-is with a warning.

Workflows can also be cloned within a project using the **Clone** action, or steps can be copied between workflows using the clipboard (copy/paste) controls.

---

## Access Control

| Role | View | Start / Stop runs | Create / Edit / Delete |
|---|---|---|---|
| Admin | ✓ | ✓ | ✓ |
| Operator | ✓ | ✓ | ✗ |
| Read Only | ✓ | ✗ | ✗ |

User management is available in **Admin → Users** (Admin role only). Login uses email address as username.

---

## Audit Log

Every create, update, and delete action is recorded in **Admin → Audit Log**, including which user performed it and a JSON diff of changed fields.

---

## API

All endpoints are versioned at `/api/v1/`.

### Auth

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/auth/csrf/` | Set CSRF cookie |
| `POST` | `/api/v1/auth/login/` | Login `{email, password}` |
| `POST` | `/api/v1/auth/logout/` | Logout |
| `GET` | `/api/v1/auth/me/` | Current user |
| `PATCH` | `/api/v1/auth/me/` | Update name |
| `POST` | `/api/v1/auth/change-password/` | Change password |

### Resources (standard CRUD)

`/api/v1/projects/`, `/api/v1/workflows/`, `/api/v1/steps/`, `/api/v1/variables/`, `/api/v1/users/`, `/api/v1/settings/`

### Run triggers

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/workflows/{id}/run/` | Queue workflow run |
| `POST` | `/api/v1/steps/{id}/run/` | Run single step |
| `POST` | `/api/v1/runs/{id}/stop/` | Stop a running workflow |

### Dashboard

`GET /api/v1/dashboard/?window=30` — returns `{running, recent, scheduled}` for the given minute window.

### WebSocket

Connect to `ws://<host>/ws/runs/<run_id>/` to receive live step output events:

```json
{ "event": "step_start", "step_run_id": 1, "step_name": "Extract Data" }
{ "event": "output", "step_run_id": 1, "stream": "stdout", "line": "Connecting to source..." }
{ "event": "step_end", "step_run_id": 1, "status": "success", "exit_code": 0 }
```

WebSocket connections require an active session cookie (authenticate via `/api/v1/auth/login/` first).

---

## Running Tests

```bash
cd backend
python -m pytest tests/ -v
```

The test suite covers:

- Model validation (users, projects, workflows, steps, variable uniqueness)
- Variable resolution and sandboxed Python expression evaluation
- Step execution: success, failure, timeout, skipped (inactive), metrics, stderr capture
- Workflow execution: sequential, parallel grouping, stop-on-error, continue-on-error, concurrent run skipping
- API permissions: role-based access for all endpoints
- Import / export

---

## Example: Data Pipeline Workflow

This example shows a three-stage ETL workflow using parallel extraction steps and variable substitution.

**Variables:**
- `run_date` → `datetime.datetime.now().strftime("%Y%m%d")`
- `db_host` → `warehouse.internal`

**Steps:**

| Seq | Step Name | Command | Parameters |
|---|---|---|---|
| 1 | Validate Source | `python` | `scripts/validate.py --date {run_date}` |
| 2 | Extract Orders | `python` | `scripts/extract.py --table orders --date {run_date}` |
| 2 | Extract Customers | `python` | `scripts/extract.py --table customers --date {run_date}` |
| 3 | Load Warehouse | `python` | `scripts/load.py --host {db_host} --date {run_date}` |

Sequences 1 and 3 are sequential. The two Seq 2 steps run in parallel — Load Warehouse starts only after both Extract steps finish.

**Notification setup:**
- Notify on Error: enabled
- Recipients: `data-team@example.com`
- Settings → Notification mailhost:port: `smtp.example.com:587`
- Settings → Mailhost User: `alerts@example.com`
- Settings → Mailhost Password: _(stored masked in database)_

---

## Project Structure

```
CronPlus/
  backend/
    cronplus/          Django project settings, URLs, ASGI config
    core/              Models: User, Project, Workflow, Step,
                              WorkflowRun, StepRun, Variable, AuditLog, AppSetting
    api/               REST API: serializers, views, permissions, URLs
    scheduler/         Huey tasks, step executor, variable resolver, notifications
    ws/                WebSocket consumers (live log streaming)
    config/            settings.json — seed data for database settings
    tests/             pytest test suite
    manage.py
    requirements.txt
  frontend/
    src/
      components/      UI components (shadcn/ui-compatible)
      contexts/        AuthContext (session management)
      hooks/           useStatusSocket (WebSocket live updates)
      lib/             api.ts (Axios client), ws.ts (WebSocket helper)
      pages/           Dashboard, Projects, Variables, RunHistory, RunDetail,
                       Users, Settings, Login
    vite.config.ts     Proxy → :8000 in dev; build → backend/static/frontend/
  scripts/             Sample scripts for testing (sample1.py)
  specs/               Original design specifications
  README.md
```
