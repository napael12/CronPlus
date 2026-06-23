import asyncio
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async


class RunLogConsumer(AsyncWebsocketConsumer):
    """
    WebSocket endpoint: ws/runs/<workflow_run_id>/
    Clients connect to receive live step output and status events for a run.
    """

    async def connect(self):
        if not self.scope["user"].is_authenticated:
            await self.close()
            return
        self.run_id = self.scope["url_route"]["kwargs"]["run_id"]
        self.group = f"run_{self.run_id}"
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group, self.channel_name)

    # Receive messages from group (sent by executor)
    async def run_log(self, event):
        await self.send(text_data=json.dumps(event))


class ProjectStatusConsumer(AsyncWebsocketConsumer):
    """
    WebSocket endpoint: ws/projects/<project_id>/status/
    Polls the DB every 5 s and pushes {"type": "status_update"} whenever
    a workflow or step last-run status/timestamp changes.
    """

    POLL_INTERVAL = 5

    async def connect(self):
        if not self.scope["user"].is_authenticated:
            await self.close()
            return
        self.project_id = int(self.scope["url_route"]["kwargs"]["project_id"])
        await self.accept()
        self._task = asyncio.create_task(self._poll_loop())

    async def disconnect(self, close_code):
        if hasattr(self, "_task"):
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _poll_loop(self):
        last = {}
        while True:
            await asyncio.sleep(self.POLL_INTERVAL)
            try:
                current = await self._fetch_snapshot()
                if current != last:
                    await self.send(text_data=json.dumps({"type": "status_update"}))
                last = current
            except Exception:
                pass  # CancelledError is BaseException, won't be swallowed here

    @database_sync_to_async
    def _fetch_snapshot(self):
        from django.db.models import OuterRef, Subquery
        from core.models import Workflow, Step, WorkflowRun, StepRun

        last_run_qs = WorkflowRun.objects.filter(workflow=OuterRef("pk")).order_by("-id")
        wf_rows = (
            Workflow.objects.filter(project_id=self.project_id)
            .annotate(
                _s=Subquery(last_run_qs.values("status")[:1]),
                _a=Subquery(last_run_qs.values("started_at")[:1]),
                _f=Subquery(last_run_qs.values("finished_at")[:1]),
            )
            .values("id", "_s", "_a", "_f")
        )

        last_sr_qs = StepRun.objects.filter(step=OuterRef("pk")).order_by("-id")
        step_rows = (
            Step.objects.filter(workflow__project_id=self.project_id)
            .annotate(
                _s=Subquery(last_sr_qs.values("status")[:1]),
                _a=Subquery(last_sr_qs.values("started_at")[:1]),
                _f=Subquery(last_sr_qs.values("finished_at")[:1]),
            )
            .values("id", "_s", "_a", "_f")
        )

        snap = {}
        for r in wf_rows:
            snap[f"w{r['id']}"] = (r["_s"], r["_a"], r["_f"])
        for r in step_rows:
            snap[f"s{r['id']}"] = (r["_s"], r["_a"], r["_f"])
        return snap


class GlobalStatusConsumer(AsyncWebsocketConsumer):
    """
    WebSocket endpoint: ws/status/
    Polls DB every 5 s and pushes {"type": "status_update"} whenever the
    set of running workflow runs or the most recently finished run changes.
    Used by the Monitor/Dashboard page.
    """

    POLL_INTERVAL = 5

    async def connect(self):
        if not self.scope["user"].is_authenticated:
            await self.close()
            return
        await self.accept()
        self._task = asyncio.create_task(self._poll_loop())

    async def disconnect(self, close_code):
        if hasattr(self, "_task"):
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _poll_loop(self):
        last = None
        while True:
            await asyncio.sleep(self.POLL_INTERVAL)
            try:
                current = await self._fetch_snapshot()
                if current != last:
                    await self.send(text_data=json.dumps({"type": "status_update"}))
                last = current
            except Exception:
                pass

    @database_sync_to_async
    def _fetch_snapshot(self):
        from core.models import WorkflowRun

        running_ids = frozenset(
            WorkflowRun.objects.filter(status="running").values_list("id", flat=True)
        )
        latest = (
            WorkflowRun.objects.exclude(finished_at=None)
            .order_by("-finished_at")
            .values("id", "finished_at")
            .first()
        )
        latest_key = (latest["id"], latest["finished_at"]) if latest else None
        return (running_ids, latest_key)
