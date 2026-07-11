# Plan: Switch CronPlus from SQLite to PostgreSQL

## Context

CronPlus currently uses SQLite for all application data (models, migrations, run history, settings). SQLite is fine for development but has limitations for production: no concurrent writes, single-file storage, no network access from multiple hosts. The user wants to understand and apply what it takes to migrate to PostgreSQL.

The good news: **the entire codebase uses pure Django ORM with no raw SQL**, so no application code changes are needed — only configuration and a driver install.

There are two separate databases to consider:
- **Main DB** (Django models) — the migration target
- **Huey broker DB** (`huey.db`) — the task queue; Huey has no official PostgreSQL backend, so it stays on SQLite or moves to Redis independently

---

## What Changes

### 1. Install PostgreSQL driver

Add to `backend/requirements.txt`:
```
psycopg2-binary==2.9.10
```
(`psycopg2-binary` is the self-contained wheel, no system libpq needed. Use `psycopg2` without `-binary` in production if you prefer to compile against the system library.)

### 2. Update `DATABASES` in `backend/cronplus/settings.py`

Replace:
```python
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / os.getenv("DB_NAME", "cronplus.db"),
    }
}
```

With:
```python
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME":     os.getenv("DB_NAME",     "cronplus"),
        "USER":     os.getenv("DB_USER",     "cronplus"),
        "PASSWORD": os.getenv("DB_PASSWORD", ""),
        "HOST":     os.getenv("DB_HOST",     "localhost"),
        "PORT":     os.getenv("DB_PORT",     "5432"),
    }
}
```

### 3. Add environment variables

In `backend/.env` (create if absent) or the deployment environment:
```
DB_NAME=cronplus
DB_USER=cronplus
DB_PASSWORD=secret
DB_HOST=localhost
DB_PORT=5432
```

### 4. Provision the PostgreSQL database

```sql
CREATE USER cronplus WITH PASSWORD 'secret';
CREATE DATABASE cronplus OWNER cronplus;
```

### 5. Run migrations against PostgreSQL

```bash
cd backend
python manage.py migrate
```

All 7 existing migrations (`0001_initial` through `0007_stopped_status`) use only standard Django ORM operations and will apply cleanly to PostgreSQL without modification.

### 6. Create superuser on the new database

```bash
python manage.py createsuperuser
```

### 7. (Optional) Seed AppSettings

After migration, seed `notification_mailhost`, `notification_sender`, etc. by running:
```bash
python manage.py loaddata   # or re-run the app which auto-seeds from config/settings.json
```
The seeding logic lives in migration `0003_appsetting_label_seed.py` and will run automatically as part of `migrate`.

---

## What Does NOT Change

| Item | Why unchanged |
|---|---|
| Application code (`views.py`, `models.py`, `tasks.py`) | Pure Django ORM — no raw SQL |
| Migrations | Standard Django operations; compatible with all supported backends |
| Huey task queue (`huey.db`) | Huey has no PostgreSQL backend; keep `SqliteHuey` or switch to Redis separately |
| Frontend | No database awareness |
| WebSocket consumers | No database awareness |

---

## Huey Broker (separate consideration)

Huey's SQLite broker (`huey.db`) is independent of the main Django DB. Options:
- **Keep on SQLite** — works fine; the broker only stores pending tasks, not application data
- **Switch to Redis** — for multi-host deployments; requires adding `redis` to requirements.txt and changing `huey_class` to `huey.RedisHuey` in settings.py with `"url": "redis://localhost:6379/0"`

---

## Verification

1. `pip install psycopg2-binary` completes without error
2. `python manage.py migrate` applies all 7 migrations cleanly to PostgreSQL
3. `python manage.py runserver` starts without DB errors
4. Login works (session stored in PostgreSQL via `django.contrib.sessions`)
5. Create a Project, Workflow, Step — confirm they persist
6. Run a Workflow — confirm WorkflowRun and StepRun records appear in Monitor
7. Check Audit Log — confirm entries are written
8. `python manage.py run_huey` starts normally (still uses `huey.db` for the broker)
