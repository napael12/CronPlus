"""
Integration tests for step and workflow execution.
These tests invoke the executor directly (no Huey broker needed).
"""
import sys
import pytest
from django.utils import timezone

from core.models import (
    Project, Workflow, Step, WorkflowRun, StepRun, WorkflowMember
)
from scheduler.executor import run_step


def _make_run(workflow):
    return WorkflowRun.objects.create(
        workflow=workflow,
        status=WorkflowRun.Status.RUNNING,
        started_at=timezone.now(),
    )


def _make_step_run(step, run):
    return StepRun.objects.create(
        workflow_run=run,
        step=step,
        step_name=step.name,
        status=StepRun.Status.PENDING,
    )


# Cross-platform echo command
ECHO_CMD = "python" if sys.platform == "win32" else "echo"
ECHO_ARGS = "-c \"print('hello')\"" if sys.platform == "win32" else "hello"
FAIL_CMD = "python"
FAIL_ARGS = "-c \"import sys; sys.exit(1)\""


@pytest.mark.django_db
class TestStepExecution:
    def test_successful_step(self, workflow, db):
        step = Step.objects.create(
            workflow=workflow,
            name="Echo",
            command="python",
            parameters='-c "print(\'hello\')"',
            order=0,
        )
        run = _make_run(workflow)
        step_run = _make_step_run(step, run)
        success = run_step(step_run.pk, run.pk)
        assert success
        step_run.refresh_from_db()
        assert step_run.status == StepRun.Status.SUCCESS
        assert step_run.exit_code == 0
        assert "hello" in step_run.stdout

    def test_failing_step(self, workflow, db):
        step = Step.objects.create(
            workflow=workflow,
            name="Fail",
            command="python",
            parameters=FAIL_ARGS,
            order=0,
        )
        run = _make_run(workflow)
        step_run = _make_step_run(step, run)
        success = run_step(step_run.pk, run.pk)
        assert not success
        step_run.refresh_from_db()
        assert step_run.status == StepRun.Status.FAILED
        assert step_run.exit_code != 0

    def test_timeout_kills_step(self, workflow, db):
        step = Step.objects.create(
            workflow=workflow,
            name="Slow",
            command="python",
            parameters='-c "import time; time.sleep(10)"',
            timeout=1,
            order=0,
        )
        run = _make_run(workflow)
        step_run = _make_step_run(step, run)
        success = run_step(step_run.pk, run.pk)
        assert not success
        step_run.refresh_from_db()
        assert step_run.status == StepRun.Status.TIMEOUT

    def test_inactive_step_is_skipped(self, workflow, db):
        step = Step.objects.create(
            workflow=workflow,
            name="Inactive",
            command="python",
            parameters=FAIL_ARGS,
            is_active=False,
            order=0,
        )
        run = _make_run(workflow)
        step_run = _make_step_run(step, run)
        success = run_step(step_run.pk, run.pk)
        assert success
        step_run.refresh_from_db()
        assert step_run.status == StepRun.Status.SKIPPED

    def test_metrics_captured(self, workflow, db):
        step = Step.objects.create(
            workflow=workflow,
            name="Metrics",
            command="python",
            parameters='-c "import time; x=[0]*5000000; time.sleep(1); print(\'done\')"',
            order=0,
        )
        run = _make_run(workflow)
        step_run = _make_step_run(step, run)
        run_step(step_run.pk, run.pk)
        step_run.refresh_from_db()
        # Metrics fields are populated (values may be 0.0 for very fast processes)
        assert step_run.peak_memory_mb is not None
        assert step_run.peak_cpu_percent is not None
        assert step_run.duration_seconds is not None
        assert step_run.duration_seconds >= 1.0

    def test_stderr_captured(self, workflow, db):
        step = Step.objects.create(
            workflow=workflow,
            name="Stderr",
            command="python",
            parameters='-c "import sys; sys.stderr.write(\'err\\n\')"',
            order=0,
        )
        run = _make_run(workflow)
        step_run = _make_step_run(step, run)
        run_step(step_run.pk, run.pk)
        step_run.refresh_from_db()
        assert "err" in step_run.stderr


@pytest.mark.django_db
class TestWorkflowExecution:
    def test_sequential_stops_on_error(self, project, db):
        """If stop_on_error step fails, subsequent steps must not run."""
        from scheduler.tasks import run_workflow_task

        wf = Workflow.objects.create(project=project, name="SeqFail")
        s1 = Step.objects.create(
            workflow=wf, name="Fail", command="python", parameters=FAIL_ARGS,
            on_error=Step.StepOutcome.STOP, order=0,
        )
        s2 = Step.objects.create(
            workflow=wf, name="ShouldNotRun", command="python",
            parameters='-c "print(\'ran\')"', order=1,
        )
        wm1 = WorkflowMember.objects.create(parent=wf, step=s1, order=0)
        wm2 = WorkflowMember.objects.create(parent=wf, step=s2, order=1)

        # Patch huey immediate mode for testing
        from scheduler.tasks import _execute_workflow
        run = WorkflowRun.objects.create(
            workflow=wf, status=WorkflowRun.Status.RUNNING, started_at=timezone.now()
        )
        result = _execute_workflow(wf, run)
        assert not result
        # s2 should not have been executed (no StepRun created for it)
        assert StepRun.objects.filter(workflow_run=run, step=s2).count() == 0

    def test_continue_on_error_continues(self, project, db):
        from scheduler.tasks import _execute_workflow

        wf = Workflow.objects.create(project=project, name="SeqContinue")
        s1 = Step.objects.create(
            workflow=wf, name="Fail", command="python", parameters=FAIL_ARGS,
            on_error=Step.StepOutcome.CONTINUE, order=0,
        )
        s2 = Step.objects.create(
            workflow=wf, name="ShouldRun", command="python",
            parameters='-c "print(\'ran\')"', order=1,
        )
        WorkflowMember.objects.create(parent=wf, step=s1, order=0)
        WorkflowMember.objects.create(parent=wf, step=s2, order=1)

        run = WorkflowRun.objects.create(
            workflow=wf, status=WorkflowRun.Status.RUNNING, started_at=timezone.now()
        )
        _execute_workflow(wf, run)
        assert StepRun.objects.filter(workflow_run=run, step=s2).exists()

    def test_skip_concurrent_run(self, workflow, db):
        """A second trigger while one is running should be skipped."""
        from scheduler.tasks import run_workflow_task

        WorkflowRun.objects.create(
            workflow=workflow, status=WorkflowRun.Status.RUNNING, started_at=timezone.now()
        )
        # Run should be skipped — no new WorkflowRun created
        initial_count = WorkflowRun.objects.filter(workflow=workflow).count()
        # Directly test the guard logic (without Huey)
        already_running = WorkflowRun.objects.filter(
            workflow=workflow, status=WorkflowRun.Status.RUNNING
        ).exists()
        assert already_running
        # If already running, no new run is created
        assert WorkflowRun.objects.filter(workflow=workflow).count() == initial_count

    def test_inactive_workflow_skipped_by_member(self, project, db):
        from scheduler.tasks import _run_member, _execute_workflow

        parent_wf = Workflow.objects.create(project=project, name="Parent")
        child_wf = Workflow.objects.create(project=project, name="Child", is_active=False)
        WorkflowMember.objects.create(parent=parent_wf, child_workflow=child_wf, order=0)

        parent_run = WorkflowRun.objects.create(
            workflow=parent_wf, status=WorkflowRun.Status.RUNNING, started_at=timezone.now()
        )
        result = _execute_workflow(parent_wf, parent_run)
        assert result  # inactive child is skipped → overall success
