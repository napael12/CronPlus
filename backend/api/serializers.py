from rest_framework import serializers
from core.models import (
    User, Variable, Project, Workflow, Step, WorkflowMember,
    WorkflowRun, StepRun, AuditLog, AppSetting,
)


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "name", "role", "is_active", "date_joined"]
        read_only_fields = ["id", "date_joined"]


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ["email", "name", "role", "password"]

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)


class VariableSerializer(serializers.ModelSerializer):
    class Meta:
        model = Variable
        fields = ["id", "name", "expression", "description", "updated_at", "updated_by"]
        read_only_fields = ["id", "updated_at", "updated_by"]


class ProjectSerializer(serializers.ModelSerializer):
    workflow_count = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = ["id", "name", "description", "is_active", "created_at", "updated_at", "workflow_count"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_workflow_count(self, obj):
        return obj.workflows.count()


class StepSerializer(serializers.ModelSerializer):
    last_run_status = serializers.SerializerMethodField()
    last_run_at = serializers.SerializerMethodField()
    last_run_id = serializers.SerializerMethodField()
    last_run_finished_at = serializers.SerializerMethodField()

    class Meta:
        model = Step
        fields = [
            "id", "workflow", "name", "description", "is_active",
            "command", "parameters", "working_directory", "use_shell",
            "timeout", "on_success", "on_success_workflow", "on_error", "on_error_workflow",
            "order", "run_parallel",
            "created_at", "updated_at",
            "last_run_status", "last_run_at", "last_run_id", "last_run_finished_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def _last_sr(self, obj):
        return obj.runs.order_by("-id").first()

    def get_last_run_status(self, obj):
        if hasattr(obj, "_last_run_status"):
            return obj._last_run_status
        sr = self._last_sr(obj)
        return sr.status if sr else None

    def get_last_run_at(self, obj):
        if hasattr(obj, "_last_run_at"):
            return obj._last_run_at
        sr = self._last_sr(obj)
        return sr.started_at if sr else None

    def get_last_run_id(self, obj):
        if hasattr(obj, "_last_run_id"):
            return obj._last_run_id
        sr = self._last_sr(obj)
        return sr.pk if sr else None

    def get_last_run_finished_at(self, obj):
        if hasattr(obj, "_last_run_finished_at"):
            return obj._last_run_finished_at
        sr = self._last_sr(obj)
        return sr.finished_at if sr else None


class WorkflowMemberSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkflowMember
        fields = ["id", "parent", "step", "child_workflow", "order", "run_parallel"]
        read_only_fields = ["id"]

    def validate(self, data):
        if bool(data.get("step")) == bool(data.get("child_workflow")):
            raise serializers.ValidationError("Exactly one of step or child_workflow must be set.")
        return data


class WorkflowSerializer(serializers.ModelSerializer):
    steps = StepSerializer(many=True, read_only=True)
    members = WorkflowMemberSerializer(many=True, read_only=True)

    class Meta:
        model = Workflow
        fields = [
            "id", "project", "name", "description", "is_active",
            "crontab", "notify_on_success", "notify_on_error",
            "notification_recipients", "created_at", "updated_at",
            "steps", "members",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class WorkflowListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list views (no nested steps)."""
    last_run_status = serializers.SerializerMethodField()
    last_run_at = serializers.SerializerMethodField()
    last_run_id = serializers.SerializerMethodField()
    last_run_finished_at = serializers.SerializerMethodField()
    next_run_at = serializers.SerializerMethodField()

    class Meta:
        model = Workflow
        fields = [
            "id", "project", "name", "description", "is_active",
            "crontab", "notify_on_success", "notify_on_error", "notification_recipients",
            "created_at", "updated_at",
            "last_run_status", "last_run_at", "last_run_id", "last_run_finished_at", "next_run_at",
        ]

    def _last_run(self, obj):
        return obj.runs.order_by("-started_at").first()

    def get_last_run_status(self, obj):
        if hasattr(obj, "_last_run_status"):
            return obj._last_run_status
        run = self._last_run(obj)
        return run.status if run else None

    def get_last_run_at(self, obj):
        if hasattr(obj, "_last_run_at"):
            return obj._last_run_at
        run = self._last_run(obj)
        return run.started_at if run else None

    def get_last_run_id(self, obj):
        if hasattr(obj, "_last_run_id"):
            return obj._last_run_id
        run = self._last_run(obj)
        return run.pk if run else None

    def get_last_run_finished_at(self, obj):
        if hasattr(obj, "_last_run_finished_at"):
            return obj._last_run_finished_at
        run = self._last_run(obj)
        return run.finished_at if run else None

    def get_next_run_at(self, obj):
        if not obj.crontab:
            return None
        try:
            from croniter import croniter
            from datetime import datetime
            return croniter(obj.crontab, datetime.now()).get_next(datetime).isoformat()
        except Exception:
            return None


class StepRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = StepRun
        fields = [
            "id", "workflow_run", "step", "step_name", "status",
            "started_at", "finished_at", "stdout", "stderr",
            "exit_code", "peak_cpu_percent", "peak_memory_mb",
            "truncated", "duration_seconds", "output_vars",
        ]
        read_only_fields = fields


class WorkflowRunSerializer(serializers.ModelSerializer):
    step_runs = StepRunSerializer(many=True, read_only=True)
    duration_seconds = serializers.FloatField(read_only=True)

    class Meta:
        model = WorkflowRun
        fields = [
            "id", "workflow", "triggered_by", "triggered_by_scheduler",
            "status", "started_at", "finished_at", "duration_seconds", "step_runs",
        ]
        read_only_fields = fields


class WorkflowRunListSerializer(serializers.ModelSerializer):
    duration_seconds = serializers.FloatField(read_only=True)
    workflow_name = serializers.CharField(source="workflow.name", read_only=True)
    project_name = serializers.CharField(source="workflow.project.name", read_only=True)
    triggered_by_name = serializers.SerializerMethodField()
    step_name = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowRun
        fields = [
            "id", "workflow", "workflow_name", "project_name",
            "triggered_by", "triggered_by_name", "triggered_by_scheduler",
            "status", "started_at", "finished_at", "duration_seconds",
            "step_name",
        ]
        read_only_fields = fields

    def get_triggered_by_name(self, obj):
        if obj.triggered_by_scheduler:
            return "Scheduler"
        if obj.triggered_by:
            return obj.triggered_by.name or obj.triggered_by.email
        return "—"

    def get_step_name(self, obj):
        step_runs = obj.step_runs.all()
        running = next((sr for sr in step_runs if sr.status == "running"), None)
        if running:
            return running.step_name
        last = max(step_runs, key=lambda sr: sr.started_at or "", default=None)
        return last.step_name if last else None


class AuditLogSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = ["id", "user", "user_name", "action", "entity_type", "entity_id", "entity_name", "detail", "timestamp"]
        read_only_fields = fields

    def get_user_name(self, obj):
        if obj.user:
            return obj.user.name or obj.user.email
        return "System"


class AppSettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = AppSetting
        fields = ["id", "key", "label", "value", "description", "updated_at"]
        read_only_fields = ["id", "key", "label", "description", "updated_at"]
