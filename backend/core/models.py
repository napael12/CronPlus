from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone


# ---------------------------------------------------------------------------
# User & Auth
# ---------------------------------------------------------------------------

class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra):
        if not email:
            raise ValueError("Email is required")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("role", User.Role.ADMIN)
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        return self.create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    class Role(models.TextChoices):
        ADMIN = "admin", "Admin"
        OPERATOR = "operator", "Operator"
        READ_ONLY = "read_only", "Read Only"

    email = models.EmailField(unique=True)
    name = models.CharField(max_length=150, blank=True)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.READ_ONLY)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []
    objects = UserManager()

    def __str__(self):
        return self.email


# ---------------------------------------------------------------------------
# Variables
# ---------------------------------------------------------------------------

class Variable(models.Model):
    name = models.CharField(max_length=100, unique=True)
    expression = models.TextField(help_text="Plain value or Python expression evaluated at runtime")
    description = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="+")

    def __str__(self):
        return self.name


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

class Project(models.Model):
    name = models.CharField(max_length=200, unique=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


# ---------------------------------------------------------------------------
# Workflows
# ---------------------------------------------------------------------------

class Workflow(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="workflows")
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    crontab = models.CharField(max_length=100, blank=True, help_text="Cron expression; blank = no schedule")
    notify_on_success = models.BooleanField(default=False)
    notify_on_error = models.BooleanField(default=True)
    notification_recipients = models.TextField(
        blank=True, help_text="Comma-separated email addresses"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("project", "name")

    def __str__(self):
        return f"{self.project.name} / {self.name}"


# ---------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------

class Step(models.Model):
    class StepOutcome(models.TextChoices):
        CONTINUE = "continue", "Go to Next Step"
        STOP = "stop", "Stop Processing"
        LAUNCH_WORKFLOW = "launch_workflow", "Launch Workflow"

    workflow = models.ForeignKey(Workflow, on_delete=models.CASCADE, related_name="steps")
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    command = models.TextField()
    parameters = models.TextField(blank=True)
    working_directory = models.CharField(max_length=500, blank=True)
    use_shell = models.BooleanField(default=False, help_text="Run command via OS shell")
    timeout = models.IntegerField(default=-1, help_text="Seconds; -1 = no timeout")
    on_success = models.CharField(
        max_length=20, choices=StepOutcome.choices, default=StepOutcome.CONTINUE
    )
    on_success_workflow = models.ForeignKey(
        Workflow, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="triggered_on_step_success",
    )
    on_error = models.CharField(
        max_length=20, choices=StepOutcome.choices, default=StepOutcome.STOP
    )
    on_error_workflow = models.ForeignKey(
        Workflow, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="triggered_on_step_error",
    )
    order = models.PositiveIntegerField(default=0)
    run_parallel = models.BooleanField(
        default=False, help_text="Run concurrently with other parallel-flagged steps"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return f"{self.workflow} / {self.name}"


# ---------------------------------------------------------------------------
# Nested Workflow members (a Workflow can include child Workflows)
# ---------------------------------------------------------------------------

class WorkflowMember(models.Model):
    """Ordered sequence entry in a parent workflow — either a Step or a child Workflow."""

    parent = models.ForeignKey(Workflow, on_delete=models.CASCADE, related_name="members")
    # Exactly one of step / child_workflow must be set
    step = models.ForeignKey(Step, null=True, blank=True, on_delete=models.CASCADE, related_name="memberships")
    child_workflow = models.ForeignKey(
        Workflow, null=True, blank=True, on_delete=models.CASCADE, related_name="parent_memberships"
    )
    order = models.PositiveIntegerField(default=0)
    run_parallel = models.BooleanField(default=False)

    class Meta:
        ordering = ["order"]

    def clean(self):
        from django.core.exceptions import ValidationError
        if bool(self.step) == bool(self.child_workflow):
            raise ValidationError("Exactly one of step or child_workflow must be set.")

    def __str__(self):
        target = self.step or self.child_workflow
        return f"{self.parent} → {target} (order={self.order})"


# ---------------------------------------------------------------------------
# Workflow & Step Runs (execution history)
# ---------------------------------------------------------------------------

class WorkflowRun(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        SUCCESS = "success", "Success"
        FAILED = "failed", "Failed"
        STOPPED = "stopped", "Stopped"
        SKIPPED = "skipped", "Skipped"

    workflow = models.ForeignKey(Workflow, on_delete=models.CASCADE, related_name="runs")
    triggered_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="triggered_runs"
    )
    triggered_by_scheduler = models.BooleanField(default=False)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    runtime_vars = models.JSONField(default=dict, blank=True)

    @property
    def duration_seconds(self):
        if self.started_at and self.finished_at:
            return (self.finished_at - self.started_at).total_seconds()
        return None

    def __str__(self):
        return f"Run #{self.pk} of {self.workflow} [{self.status}]"


class StepRun(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        SUCCESS = "success", "Success"
        FAILED = "failed", "Failed"
        TIMEOUT = "timeout", "Timeout"
        STOPPED = "stopped", "Stopped"
        SKIPPED = "skipped", "Skipped"

    workflow_run = models.ForeignKey(WorkflowRun, on_delete=models.CASCADE, related_name="step_runs")
    step = models.ForeignKey(Step, null=True, on_delete=models.SET_NULL, related_name="runs")
    step_name = models.CharField(max_length=200)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    stdout = models.TextField(blank=True)
    stderr = models.TextField(blank=True)
    exit_code = models.IntegerField(null=True, blank=True)
    peak_cpu_percent = models.FloatField(null=True, blank=True)
    peak_memory_mb = models.FloatField(null=True, blank=True)
    truncated = models.BooleanField(default=False)
    output_vars = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["id"]

    @property
    def duration_seconds(self):
        if self.started_at and self.finished_at:
            return (self.finished_at - self.started_at).total_seconds()
        return None

    def __str__(self):
        return f"StepRun #{self.pk} [{self.step_name}] [{self.status}]"


# ---------------------------------------------------------------------------
# Audit Log
# ---------------------------------------------------------------------------

class AuditLog(models.Model):
    class Action(models.TextChoices):
        CREATE = "create", "Create"
        UPDATE = "update", "Update"
        DELETE = "delete", "Delete"

    user = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="+")
    action = models.CharField(max_length=20, choices=Action.choices)
    entity_type = models.CharField(max_length=50)
    entity_id = models.CharField(max_length=50)
    entity_name = models.CharField(max_length=200, blank=True)
    detail = models.JSONField(default=dict)
    timestamp = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-timestamp"]

    def __str__(self):
        return f"{self.timestamp} {self.user} {self.action} {self.entity_type}#{self.entity_id}"


# ---------------------------------------------------------------------------
# App Settings (DB-stored runtime configuration)
# ---------------------------------------------------------------------------

class AppSetting(models.Model):
    key = models.CharField(max_length=100, unique=True)
    label = models.CharField(max_length=200, blank=True)
    value = models.TextField()
    description = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.label or self.key
