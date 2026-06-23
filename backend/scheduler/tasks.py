"""
Huey tasks for workflow and step execution.
"""
import logging
from django.utils import timezone
from huey import crontab

from .huey_app import huey
from .executor import run_step
from .notifications import send_workflow_notification

logger = logging.getLogger(__name__)


def _detect_cycle(workflow, visited=None):
    """DFS to detect circular workflow references."""
    if visited is None:
        visited = set()
    if workflow.pk in visited:
        return True
    visited.add(workflow.pk)
    from core.models import WorkflowMember
    for member in WorkflowMember.objects.filter(parent=workflow, child_workflow__isnull=False):
        if _detect_cycle(member.child_workflow, visited.copy()):
            return True
    return False


def _create_step_run(step, workflow_run):
    from core.models import StepRun
    return StepRun.objects.create(
        workflow_run=workflow_run,
        step=step,
        step_name=step.name,
        status=StepRun.Status.PENDING,
    )


def _execute_workflow(workflow, workflow_run):
    """
    Execute active steps grouped by sequence number (order field).
    Steps sharing the same order number run in parallel; the next sequence
    number only starts after all steps in the current group have finished.

    All steps in a parallel group must declare the same on_success and on_error
    outcomes. Mismatches are logged as errors; the first step's values are used.
    """
    from core.models import Step
    import concurrent.futures
    from itertools import groupby

    steps = list(
        Step.objects.filter(workflow=workflow, is_active=True)
        .order_by("order", "id")
    )

    if not steps:
        logger.info("Workflow %s has no steps", workflow.pk)
        return True

    overall_success = True

    for order_val, group_iter in groupby(steps, key=lambda s: s.order):
        group = list(group_iter)
        representative = group[0]

        if len(group) > 1:
            # Validate that all steps in this parallel group agree on outcomes
            on_success_values = {s.on_success for s in group}
            on_error_values = {s.on_error for s in group}
            if len(on_success_values) > 1:
                logger.error(
                    "Workflow %s sequence %s: parallel steps have inconsistent "
                    "on_success outcomes %s — using %r",
                    workflow.pk, order_val, on_success_values, representative.on_success,
                )
            if len(on_error_values) > 1:
                logger.error(
                    "Workflow %s sequence %s: parallel steps have inconsistent "
                    "on_error outcomes %s — using %r",
                    workflow.pk, order_val, on_error_values, representative.on_error,
                )

            # Run all steps in this sequence concurrently then wait
            with concurrent.futures.ThreadPoolExecutor() as executor:
                futures = {
                    executor.submit(_run_step_in_workflow, s, workflow_run): s
                    for s in group
                }
                results = {
                    futures[f]: f.result()
                    for f in concurrent.futures.as_completed(futures)
                }
            all_success = all(results.values())
        else:
            # Single step in this sequence — run normally
            try:
                all_success = _run_step_in_workflow(representative, workflow_run)
            except Exception:
                logger.exception(
                    "Unexpected error in step %s (workflow run %s)",
                    representative.pk, workflow_run.pk,
                )
                all_success = False

        if not all_success:
            overall_success = False

        outcome = representative.on_success if all_success else representative.on_error
        outcome_workflow = (
            representative.on_success_workflow if all_success
            else representative.on_error_workflow
        )

        if outcome == "launch_workflow" and outcome_workflow:
            run_workflow_task(outcome_workflow.pk)
            break
        elif outcome == "stop":
            break
        # "continue" → move to the next sequence number

    return overall_success


def _run_step_in_workflow(step, workflow_run):
    if not step.is_active:
        return True
    step_run = _create_step_run(step, workflow_run)
    return run_step(step_run.pk, workflow_run.pk)


@huey.task()
def run_workflow_task(workflow_id: int, triggered_by_id=None, triggered_by_scheduler=False):
    from core.models import Workflow, WorkflowRun
    from django.utils import timezone as tz

    try:
        workflow = Workflow.objects.get(pk=workflow_id)
    except Workflow.DoesNotExist:
        logger.error("Workflow %s not found", workflow_id)
        return

    if not workflow.is_active:
        logger.info("Workflow %s is inactive, skipping", workflow_id)
        return

    # Skip if already running (concurrent run policy = skip)
    if WorkflowRun.objects.filter(workflow=workflow, status=WorkflowRun.Status.RUNNING).exists():
        logger.info("Workflow %s already running, skipping concurrent trigger", workflow_id)
        return

    triggered_by = None
    if triggered_by_id:
        from core.models import User
        try:
            triggered_by = User.objects.get(pk=triggered_by_id)
        except User.DoesNotExist:
            pass

    run = WorkflowRun.objects.create(
        workflow=workflow,
        triggered_by=triggered_by,
        triggered_by_scheduler=triggered_by_scheduler,
        status=WorkflowRun.Status.RUNNING,
        started_at=tz.now(),
    )

    try:
        success = _execute_workflow(workflow, run)
    except Exception as exc:
        logger.exception("Unhandled error in workflow %s run %s", workflow_id, run.pk)
        run.status = WorkflowRun.Status.FAILED
        run.finished_at = tz.now()
        run.save(update_fields=["status", "finished_at"])
        _maybe_notify(workflow, run)
        raise

    run.status = WorkflowRun.Status.SUCCESS if success else WorkflowRun.Status.FAILED
    run.finished_at = tz.now()
    run.save(update_fields=["status", "finished_at"])
    _maybe_notify(workflow, run)


@huey.task()
def run_step_standalone_task(step_id: int, triggered_by_id=None, follow_outcome: bool = True):
    """Run a single step outside of a workflow (manual individual step execution)."""
    from core.models import Step, Workflow, WorkflowRun, StepRun
    from django.utils import timezone as tz

    try:
        step = Step.objects.select_related("workflow__project").get(pk=step_id)
    except Step.DoesNotExist:
        logger.error("Step %s not found", step_id)
        return

    triggered_by = None
    if triggered_by_id:
        from core.models import User
        try:
            triggered_by = User.objects.get(pk=triggered_by_id)
        except User.DoesNotExist:
            pass

    # Create a transient WorkflowRun to anchor the StepRun
    run = WorkflowRun.objects.create(
        workflow=step.workflow,
        triggered_by=triggered_by,
        triggered_by_scheduler=False,
        status=WorkflowRun.Status.RUNNING,
        started_at=tz.now(),
    )
    step_run = _create_step_run(step, run)
    success = run_step(step_run.pk, run.pk)

    if follow_outcome:
        outcome = step.on_success if success else step.on_error
        outcome_workflow = step.on_success_workflow if success else step.on_error_workflow
        if outcome == "launch_workflow" and outcome_workflow:
            run_workflow_task(outcome_workflow.pk)
    run.status = WorkflowRun.Status.SUCCESS if success else WorkflowRun.Status.FAILED

    run.finished_at = tz.now()
    run.save(update_fields=["status", "finished_at"])


def _maybe_notify(workflow, run):
    try:
        if run.status == WorkflowRun.Status.SUCCESS and workflow.notify_on_success:
            send_workflow_notification(run)
        elif run.status == WorkflowRun.Status.FAILED and workflow.notify_on_error:
            send_workflow_notification(run)
    except Exception as exc:
        logger.error("Notification error for run %s: %s", run.pk, exc)


def schedule_workflows():
    """
    Called by Huey's periodic task scheduler.
    Enqueues any workflow whose crontab expression matches the current UTC minute.
    """
    from core.models import Workflow
    from croniter import croniter
    from datetime import datetime, timezone

    # Use naive local datetime so cron expressions match the OS clock, not UTC
    now = datetime.now().replace(second=0, microsecond=0)
    for workflow in Workflow.objects.filter(is_active=True).exclude(crontab=""):
        try:
            if croniter.match(workflow.crontab, now):
                run_workflow_task(workflow.pk, triggered_by_scheduler=True)
                logger.info("Scheduled workflow %s (%s) triggered by cron", workflow.pk, workflow.name)
        except Exception as exc:
            logger.error("Cron error for workflow %s: %s", workflow.pk, exc)


@huey.periodic_task(crontab(minute="*"))
def cron_dispatcher():
    schedule_workflows()


@huey.periodic_task(crontab(hour="2", minute="0"))
def cleanup_old_logs():
    from core.models import WorkflowRun, AppSetting
    from datetime import timedelta

    try:
        days = int(AppSetting.objects.get(key="log_retention_days").value)
    except (AppSetting.DoesNotExist, ValueError):
        days = 30

    cutoff = timezone.now() - timedelta(days=days)
    deleted, _ = WorkflowRun.objects.filter(
        status__in=["success", "failed", "timeout"],
        finished_at__lt=cutoff,
    ).delete()
    logger.info("Log cleanup: deleted %d workflow runs older than %d days", deleted, days)
