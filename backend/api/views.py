import json
from django.contrib.auth import authenticate, login, logout
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie, csrf_exempt
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import (
    User, Variable, Project, Workflow, Step, WorkflowMember,
    WorkflowRun, StepRun, AuditLog, AppSetting,
)
from .permissions import IsAdmin, IsAdminOrOperator, IsAuthenticatedReadOnly
from .serializers import (
    UserSerializer, UserCreateSerializer, ChangePasswordSerializer,
    VariableSerializer, ProjectSerializer,
    WorkflowSerializer, WorkflowListSerializer,
    StepSerializer, WorkflowMemberSerializer,
    WorkflowRunSerializer, WorkflowRunListSerializer,
    StepRunSerializer, AuditLogSerializer, AppSettingSerializer,
)


def _audit(request, action, obj, detail=None):
    AuditLog.objects.create(
        user=request.user if request.user.is_authenticated else None,
        action=action,
        entity_type=type(obj).__name__,
        entity_id=str(obj.pk),
        entity_name=str(obj),
        detail=detail or {},
    )


def _audit_update(request, serializer):
    """Save serializer and record which fields changed."""
    instance = serializer.instance
    # Snapshot before save
    old = {}
    for field in serializer.validated_data:
        if hasattr(instance, field):
            old[field] = getattr(instance, field)
    obj = serializer.save()
    # Compare after save
    changes = {}
    for field, old_val in old.items():
        new_val = getattr(obj, field)
        if str(old_val) != str(new_val):
            changes[field] = {"from": str(old_val), "to": str(new_val)}
    _audit(request, AuditLog.Action.UPDATE, obj, detail={"changes": changes} if changes else {})
    return obj


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"detail": "CSRF cookie set"})


@method_decorator(ensure_csrf_cookie, name="dispatch")
class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        email = request.data.get("email")
        password = request.data.get("password")
        user = authenticate(request, username=email, password=password)
        if user is None:
            return Response({"detail": "Invalid credentials"}, status=status.HTTP_401_UNAUTHORIZED)
        login(request, user)
        return Response(UserSerializer(user).data)


class LogoutView(APIView):
    def post(self, request):
        logout(request)
        return Response({"detail": "Logged out"})


class MeView(APIView):
    def get(self, request):
        return Response(UserSerializer(request.user).data)

    def patch(self, request):
        serializer = UserSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ChangePasswordView(APIView):
    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = request.user
        if not user.check_password(serializer.validated_data["current_password"]):
            return Response({"detail": "Current password incorrect"}, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(serializer.validated_data["new_password"])
        user.save(update_fields=["password"])
        return Response({"detail": "Password changed"})


# ---------------------------------------------------------------------------
# Users (Admin only)
# ---------------------------------------------------------------------------

class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all().order_by("email")
    permission_classes = [IsAuthenticated, IsAdmin]

    def get_serializer_class(self):
        if self.action == "create":
            return UserCreateSerializer
        return UserSerializer

    def perform_create(self, serializer):
        user = serializer.save()
        _audit(self.request, AuditLog.Action.CREATE, user)

    def perform_update(self, serializer):
        user = serializer.save()
        _audit(self.request, AuditLog.Action.UPDATE, user)

    def perform_destroy(self, instance):
        _audit(self.request, AuditLog.Action.DELETE, instance)
        instance.delete()


# ---------------------------------------------------------------------------
# Variables (Admin CRUD, others read)
# ---------------------------------------------------------------------------

class VariableViewSet(viewsets.ModelViewSet):
    queryset = Variable.objects.all().order_by("name")
    serializer_class = VariableSerializer
    permission_classes = [IsAuthenticated, IsAuthenticatedReadOnly]

    def perform_create(self, serializer):
        obj = serializer.save(updated_by=self.request.user)
        _audit(self.request, AuditLog.Action.CREATE, obj)

    def perform_update(self, serializer):
        obj = serializer.save(updated_by=self.request.user)
        _audit(self.request, AuditLog.Action.UPDATE, obj)

    def perform_destroy(self, instance):
        _audit(self.request, AuditLog.Action.DELETE, instance)
        instance.delete()


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

class ProjectViewSet(viewsets.ModelViewSet):
    queryset = Project.objects.all().order_by("name")
    serializer_class = ProjectSerializer
    permission_classes = [IsAuthenticated, IsAuthenticatedReadOnly]

    def perform_create(self, serializer):
        obj = serializer.save()
        _audit(self.request, AuditLog.Action.CREATE, obj)

    def perform_update(self, serializer):
        _audit_update(self.request, serializer)

    def perform_destroy(self, instance):
        _audit(self.request, AuditLog.Action.DELETE, instance)
        instance.delete()

    @action(detail=True, methods=["get"])
    def export(self, request, pk=None):
        project = self.get_object()
        data = _export_project(project)
        return Response(data)

    @action(detail=False, methods=["post"], permission_classes=[IsAuthenticated, IsAdmin])
    def import_project(self, request):
        try:
            _import_project(request.data, request.user)
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"detail": "Imported"}, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# Workflows
# ---------------------------------------------------------------------------

class WorkflowViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsAuthenticatedReadOnly]

    def get_queryset(self):
        from django.db.models import OuterRef, Subquery
        qs = Workflow.objects.select_related("project").order_by("name")
        project_id = self.request.query_params.get("project")
        if project_id:
            qs = qs.filter(project_id=project_id)
        last_run_qs = WorkflowRun.objects.filter(workflow=OuterRef("pk")).order_by("-started_at")
        qs = qs.annotate(
            _last_run_id=Subquery(last_run_qs.values("id")[:1]),
            _last_run_status=Subquery(last_run_qs.values("status")[:1]),
            _last_run_at=Subquery(last_run_qs.values("started_at")[:1]),
            _last_run_finished_at=Subquery(last_run_qs.values("finished_at")[:1]),
        )
        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return WorkflowListSerializer
        return WorkflowSerializer

    def perform_create(self, serializer):
        obj = serializer.save()
        _audit(self.request, AuditLog.Action.CREATE, obj)

    def perform_update(self, serializer):
        _audit_update(self.request, serializer)

    def perform_destroy(self, instance):
        _audit(self.request, AuditLog.Action.DELETE, instance)
        instance.delete()

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsAdminOrOperator])
    def run(self, request, pk=None):
        workflow = self.get_object()
        from scheduler.tasks import run_workflow_task
        run_workflow_task(workflow.pk, triggered_by_id=request.user.pk)
        return Response({"detail": "Workflow queued"})

    @action(detail=True, methods=["get"])
    def export(self, request, pk=None):
        workflow = self.get_object()
        data = _export_workflow(workflow)
        return Response(data)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsAdmin])
    def clone(self, request, pk=None):
        source = self.get_object()
        target_project_id = request.data.get("project", source.project_id)
        new_name = request.data.get("name", f"{source.name} (copy)")

        try:
            target_project = Project.objects.get(pk=target_project_id)
        except Project.DoesNotExist:
            return Response({"detail": "Project not found"}, status=status.HTTP_404_NOT_FOUND)

        new_wf = Workflow.objects.create(
            project=target_project,
            name=new_name,
            description=source.description,
            is_active=source.is_active,
            crontab=source.crontab,
            notify_on_success=source.notify_on_success,
            notify_on_error=source.notify_on_error,
            notification_recipients=source.notification_recipients,
        )
        for step in source.steps.order_by("order"):
            Step.objects.create(
                workflow=new_wf,
                name=step.name,
                description=step.description,
                is_active=step.is_active,
                command=step.command,
                parameters=step.parameters,
                working_directory=step.working_directory,
                use_shell=step.use_shell,
                timeout=step.timeout,
                on_success=step.on_success,
                on_success_workflow=step.on_success_workflow,
                on_error=step.on_error,
                on_error_workflow=step.on_error_workflow,
                order=step.order,
                run_parallel=step.run_parallel,
            )
        _audit(request, AuditLog.Action.CREATE, new_wf, detail={"cloned_from": source.pk})
        return Response(WorkflowSerializer(new_wf).data, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------

class StepViewSet(viewsets.ModelViewSet):
    serializer_class = StepSerializer
    permission_classes = [IsAuthenticated, IsAuthenticatedReadOnly]

    def get_queryset(self):
        from django.db.models import OuterRef, Subquery
        qs = Step.objects.select_related("workflow__project").order_by("order")
        workflow_id = self.request.query_params.get("workflow")
        if workflow_id:
            qs = qs.filter(workflow_id=workflow_id)
        last_sr_qs = StepRun.objects.filter(step=OuterRef("pk")).order_by("-id")
        qs = qs.annotate(
            _last_run_id=Subquery(last_sr_qs.values("id")[:1]),
            _last_run_status=Subquery(last_sr_qs.values("status")[:1]),
            _last_run_at=Subquery(last_sr_qs.values("started_at")[:1]),
            _last_run_finished_at=Subquery(last_sr_qs.values("finished_at")[:1]),
        )
        return qs

    def perform_create(self, serializer):
        from django.db.models import Max
        if serializer.validated_data.get("order", 0) == 0:
            workflow = serializer.validated_data.get("workflow")
            max_order = Step.objects.filter(workflow=workflow).aggregate(Max("order"))["order__max"] or 0
            obj = serializer.save(order=max_order + 1)
        else:
            obj = serializer.save()
        _audit(self.request, AuditLog.Action.CREATE, obj)

    def perform_update(self, serializer):
        _audit_update(self.request, serializer)

    def perform_destroy(self, instance):
        _audit(self.request, AuditLog.Action.DELETE, instance)
        instance.delete()

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsAdminOrOperator])
    def run(self, request, pk=None):
        step = self.get_object()
        follow_outcome = request.data.get("follow_outcome", True)
        from scheduler.tasks import run_step_standalone_task
        run_step_standalone_task(step.pk, triggered_by_id=request.user.pk, follow_outcome=follow_outcome)
        return Response({"detail": "Step queued"})

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsAdmin])
    def clone(self, request, pk=None):
        from django.db.models import Max
        source = self.get_object()
        target_workflow_id = request.data.get("workflow", source.workflow_id)
        new_name = request.data.get("name", f"{source.name} (copy)")

        try:
            target_workflow = Workflow.objects.get(pk=target_workflow_id)
        except Workflow.DoesNotExist:
            return Response({"detail": "Workflow not found"}, status=status.HTTP_404_NOT_FOUND)

        max_order = Step.objects.filter(workflow=target_workflow).aggregate(Max("order"))["order__max"] or 0
        new_step = Step.objects.create(
            workflow=target_workflow,
            name=new_name,
            description=source.description,
            is_active=source.is_active,
            command=source.command,
            parameters=source.parameters,
            working_directory=source.working_directory,
            use_shell=source.use_shell,
            timeout=source.timeout,
            on_success=source.on_success,
            on_success_workflow=source.on_success_workflow,
            on_error=source.on_error,
            on_error_workflow=source.on_error_workflow,
            order=max_order + 1,
            run_parallel=source.run_parallel,
        )
        _audit(request, AuditLog.Action.CREATE, new_step, detail={"cloned_from": source.pk})
        return Response(StepSerializer(new_step).data, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# Workflow Members (ordering / parallel config)
# ---------------------------------------------------------------------------

class WorkflowMemberViewSet(viewsets.ModelViewSet):
    queryset = WorkflowMember.objects.all()
    serializer_class = WorkflowMemberSerializer
    permission_classes = [IsAuthenticated, IsAuthenticatedReadOnly]

    def get_queryset(self):
        qs = super().get_queryset()
        parent_id = self.request.query_params.get("parent")
        if parent_id:
            qs = qs.filter(parent_id=parent_id)
        return qs


# ---------------------------------------------------------------------------
# Runs (read-only for all auth users)
# ---------------------------------------------------------------------------

class WorkflowRunViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = WorkflowRun.objects.select_related("workflow__project", "triggered_by").prefetch_related("step_runs").order_by("-started_at")
        workflow_id = self.request.query_params.get("workflow")
        if workflow_id:
            qs = qs.filter(workflow_id=workflow_id)
        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return WorkflowRunListSerializer
        return WorkflowRunSerializer

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsAdminOrOperator])
    def stop(self, request, pk=None):
        # Mark run as failed; the Huey task checks status and will stop
        run = self.get_object()
        if run.status == WorkflowRun.Status.RUNNING:
            run.status = WorkflowRun.Status.FAILED
            run.save(update_fields=["status"])
        return Response({"detail": "Stop signal sent"})


class StepRunViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = StepRunSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = StepRun.objects.select_related("step", "workflow_run").order_by("-started_at")
        workflow_run_id = self.request.query_params.get("workflow_run")
        if workflow_run_id:
            qs = qs.filter(workflow_run_id=workflow_run_id)
        step_id = self.request.query_params.get("step")
        if step_id:
            qs = qs.filter(step_id=step_id)
        return qs


# ---------------------------------------------------------------------------
# Dashboard (summary data)
# ---------------------------------------------------------------------------

class DashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from django.utils import timezone
        from datetime import datetime, timedelta

        now = timezone.now()  # UTC-aware, used for DB queries
        now_local = datetime.now()  # naive local, used for croniter
        window_minutes = int(request.query_params.get("window", 30))
        since = now - timedelta(minutes=window_minutes)

        running = WorkflowRun.objects.filter(
            status=WorkflowRun.Status.RUNNING
        ).select_related("workflow__project", "triggered_by").prefetch_related("step_runs")
        recent = WorkflowRun.objects.filter(
            finished_at__gte=since
        ).exclude(status=WorkflowRun.Status.RUNNING).order_by("-finished_at").select_related(
            "workflow__project", "triggered_by"
        ).prefetch_related("step_runs")

        # Next scheduled workflows
        from croniter import croniter
        import datetime as dt
        scheduled = []
        for wf in Workflow.objects.filter(is_active=True).exclude(crontab="").select_related("project"):
            try:
                next_run = croniter(wf.crontab, now_local).get_next(dt.datetime)
                if next_run <= now_local + timedelta(minutes=window_minutes):
                    scheduled.append({
                        "id": wf.pk,
                        "name": wf.name,
                        "project_name": wf.project.name,
                        "next_run": next_run.isoformat(),
                    })
            except Exception:
                pass
        scheduled.sort(key=lambda x: x["next_run"])

        return Response({
            "running": WorkflowRunListSerializer(running, many=True).data,
            "recent": WorkflowRunListSerializer(recent, many=True).data,
            "scheduled": scheduled,
        })


# ---------------------------------------------------------------------------
# Audit Log
# ---------------------------------------------------------------------------

class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuthenticated, IsAdminOrOperator]

    def get_queryset(self):
        from django.db.models import Q
        qs = AuditLog.objects.select_related("user").order_by("-timestamp")
        entity_type = self.request.query_params.get("entity_type")
        action = self.request.query_params.get("action")
        search = self.request.query_params.get("search", "").strip()
        if entity_type:
            qs = qs.filter(entity_type=entity_type)
        if action:
            qs = qs.filter(action=action)
        if search:
            qs = qs.filter(
                Q(entity_name__icontains=search)
                | Q(user__name__icontains=search)
                | Q(user__email__icontains=search)
            )
        return qs


# ---------------------------------------------------------------------------
# App Settings (Admin only)
# ---------------------------------------------------------------------------

class AppSettingViewSet(viewsets.ModelViewSet):
    queryset = AppSetting.objects.all().order_by("key")
    serializer_class = AppSettingSerializer
    permission_classes = [IsAuthenticated, IsAdmin]


# ---------------------------------------------------------------------------
# Import / Export helpers
# ---------------------------------------------------------------------------

def _export_workflow(workflow):
    steps = StepSerializer(workflow.steps.all(), many=True).data
    members = WorkflowMemberSerializer(workflow.members.all(), many=True).data
    return {
        "name": workflow.name,
        "description": workflow.description,
        "is_active": workflow.is_active,
        "crontab": workflow.crontab,
        "notify_on_success": workflow.notify_on_success,
        "notify_on_error": workflow.notify_on_error,
        "notification_recipients": workflow.notification_recipients,
        "steps": list(steps),
        "members": list(members),
    }


def _export_project(project):
    workflows = [_export_workflow(wf) for wf in project.workflows.all()]
    return {
        "name": project.name,
        "description": project.description,
        "is_active": project.is_active,
        "workflows": workflows,
    }


def _import_project(data, user):
    project, created = Project.objects.get_or_create(
        name=data["name"],
        defaults={
            "description": data.get("description", ""),
            "is_active": data.get("is_active", True),
        },
    )
    for wf_data in data.get("workflows", []):
        workflow, _ = Workflow.objects.get_or_create(
            project=project,
            name=wf_data["name"],
            defaults={
                "description": wf_data.get("description", ""),
                "is_active": wf_data.get("is_active", True),
                "crontab": wf_data.get("crontab", ""),
                "notify_on_success": wf_data.get("notify_on_success", False),
                "notify_on_error": wf_data.get("notify_on_error", True),
                "notification_recipients": wf_data.get("notification_recipients", ""),
            },
        )
        for step_data in wf_data.get("steps", []):
            Step.objects.get_or_create(
                workflow=workflow,
                name=step_data["name"],
                defaults={
                    "command": step_data.get("command", ""),
                    "parameters": step_data.get("parameters", ""),
                    "working_directory": step_data.get("working_directory", ""),
                    "use_shell": step_data.get("use_shell", False),
                    "timeout": step_data.get("timeout", -1),
                    "on_success": step_data.get("on_success", "continue"),
                    "on_error": step_data.get("on_error", "stop"),
                    "order": step_data.get("order", 0),
                    "run_parallel": step_data.get("run_parallel", False),
                    "is_active": step_data.get("is_active", True),
                },
            )
    _audit_import = AuditLog(
        user=user,
        action=AuditLog.Action.CREATE,
        entity_type="Project",
        entity_id=str(project.pk),
        entity_name=project.name,
        detail={"imported": True},
    )
    _audit_import.save()
