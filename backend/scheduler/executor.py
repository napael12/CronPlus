"""
Low-level step executor: runs an OS process for a Step, streams output over
WebSocket, captures metrics, enforces timeout, and writes the StepRun record.
"""
import os
import re
import shlex
import threading
import subprocess
import time
from datetime import datetime, timezone

import psutil
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings

from .variable_resolver import resolve


_MAX_BYTES = settings.LOG_MAX_OUTPUT_BYTES
_CHANNEL_GROUP_PREFIX = "run_"
_SETVAR_RE = re.compile(r"^::set-var (\w+)=(.*)")


def _ws_group(workflow_run_id: int) -> str:
    return f"{_CHANNEL_GROUP_PREFIX}{workflow_run_id}"


def _send_ws(workflow_run_id: int, payload: dict):
    try:
        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            _ws_group(workflow_run_id),
            {"type": "run.log", **payload},
        )
    except Exception:
        pass


def _collect_metrics(pid: int, stop_event: threading.Event):
    """Background thread: poll psutil for peak CPU/memory."""
    peak_cpu = 0.0
    peak_mem = 0.0
    try:
        proc = psutil.Process(pid)
        while not stop_event.is_set():
            try:
                cpu = proc.cpu_percent(interval=0.5)
                mem = proc.memory_info().rss / (1024 * 1024)
                peak_cpu = max(peak_cpu, cpu)
                peak_mem = max(peak_mem, mem)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                break
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        pass
    return peak_cpu, peak_mem


def run_step(step_run_id: int, workflow_run_id: int) -> bool:
    """
    Execute the step associated with step_run_id.
    Returns True on success, False on failure/timeout.
    """
    from core.models import StepRun, Step
    from django.utils import timezone as tz

    step_run = StepRun.objects.select_related("step").get(pk=step_run_id)
    step = step_run.step

    if step is None or not step.is_active:
        step_run.status = StepRun.Status.SKIPPED
        step_run.save(update_fields=["status"])
        return True

    # Load accumulated runtime vars from previous steps in this workflow run
    try:
        from core.models import WorkflowRun as _WR
        _wr = _WR.objects.only("runtime_vars").get(pk=workflow_run_id)
        runtime_vars = _wr.runtime_vars or {}
    except Exception:
        runtime_vars = {}

    # Resolve variables in command, parameters, and working_directory
    command = resolve(step.command, runtime_vars=runtime_vars)
    parameters = resolve(step.parameters, runtime_vars=runtime_vars)
    working_dir = resolve(step.working_directory, runtime_vars=runtime_vars) or None
    full_cmd = f"{command} {parameters}".strip()

    step_run.status = StepRun.Status.RUNNING
    step_run.started_at = tz.now()
    step_run.save(update_fields=["status", "started_at"])

    _send_ws(workflow_run_id, {
        "event": "step_start",
        "step_run_id": step_run_id,
        "step_name": step_run.step_name,
    })

    if step.use_shell:
        cmd_arg = full_cmd
    else:
        try:
            cmd_arg = shlex.split(full_cmd)
        except ValueError:
            cmd_arg = full_cmd

    stdout_buf = []
    stderr_buf = []
    captured_vars: dict = {}
    total_bytes = 0
    truncated = False

    try:
        proc = subprocess.Popen(
            cmd_arg,
            shell=step.use_shell,
            cwd=working_dir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
    except Exception as exc:
        step_run.status = StepRun.Status.FAILED
        step_run.stderr = str(exc)
        step_run.finished_at = tz.now()
        step_run.save(update_fields=["status", "stderr", "finished_at"])
        _send_ws(workflow_run_id, {"event": "step_end", "step_run_id": step_run_id, "status": "failed"})
        return False

    # Metrics collection thread
    stop_metrics = threading.Event()
    metrics_result = [0.0, 0.0]

    def _metrics_runner():
        metrics_result[0], metrics_result[1] = _collect_metrics(proc.pid, stop_metrics)

    metrics_thread = threading.Thread(target=_metrics_runner, daemon=True)
    metrics_thread.start()

    # Stream stdout/stderr; intercept ::set-var lines from stdout
    def _read_stream(stream, buf, label):
        nonlocal total_bytes, truncated
        for line in stream:
            if label == "stdout":
                m = _SETVAR_RE.match(line.rstrip("\n"))
                if m:
                    captured_vars[m.group(1)] = m.group(2)
                    continue  # control line: not stored, not sent over WS
            if total_bytes >= _MAX_BYTES:
                truncated = True
                break
            buf.append(line)
            total_bytes += len(line.encode())
            _send_ws(workflow_run_id, {
                "event": "output",
                "step_run_id": step_run_id,
                "stream": label,
                "line": line.rstrip("\n"),
            })

    stdout_thread = threading.Thread(target=_read_stream, args=(proc.stdout, stdout_buf, "stdout"), daemon=True)
    stderr_thread = threading.Thread(target=_read_stream, args=(proc.stderr, stderr_buf, "stderr"), daemon=True)
    stdout_thread.start()
    stderr_thread.start()

    if step.timeout != -1:
        timeout = step.timeout
    else:
        try:
            from core.models import AppSetting
            timeout = int(AppSetting.objects.get(key="default_timeout").value)
        except (AppSetting.DoesNotExist, ValueError):
            timeout = 600

    deadline = (time.monotonic() + timeout) if timeout != -1 else None
    timed_out = False
    cancelled = False
    while proc.poll() is None:
        if deadline is not None and time.monotonic() >= deadline:
            proc.kill()
            proc.wait()
            timed_out = True
            break
        try:
            from core.models import WorkflowRun as _WR
            wr = _WR.objects.only("status").get(pk=workflow_run_id)
            if wr.status == _WR.Status.STOPPED:
                proc.kill()
                proc.wait()
                cancelled = True
                break
        except Exception:
            pass
        time.sleep(0.5)

    stdout_thread.join(timeout=5)
    stderr_thread.join(timeout=5)
    stop_metrics.set()
    metrics_thread.join(timeout=5)

    exit_code = proc.returncode
    step_run.stdout = "".join(stdout_buf)
    step_run.stderr = "".join(stderr_buf)
    step_run.exit_code = exit_code
    step_run.truncated = truncated
    step_run.peak_cpu_percent = metrics_result[0]
    step_run.peak_memory_mb = metrics_result[1]
    step_run.output_vars = captured_vars
    step_run.finished_at = tz.now()

    if timed_out:
        step_run.status = StepRun.Status.TIMEOUT
        success = False
    elif cancelled:
        step_run.status = StepRun.Status.STOPPED
        success = False
    elif exit_code == 0:
        step_run.status = StepRun.Status.SUCCESS
        success = True
    else:
        step_run.status = StepRun.Status.FAILED
        success = False

    step_run.save()
    _send_ws(workflow_run_id, {
        "event": "step_end",
        "step_run_id": step_run_id,
        "status": step_run.status,
        "exit_code": exit_code,
    })
    return success
