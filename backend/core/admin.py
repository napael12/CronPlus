from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import (
    User, Variable, Project, Workflow, Step, WorkflowMember,
    WorkflowRun, StepRun, AuditLog, AppSetting,
)


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ["email"]
    list_display = ["email", "name", "role", "is_active"]
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Info", {"fields": ("name", "role")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
    )
    add_fieldsets = (
        (None, {"fields": ("email", "name", "role", "password1", "password2")}),
    )
    search_fields = ["email", "name"]


admin.site.register(Variable)
admin.site.register(Project)
admin.site.register(Workflow)
admin.site.register(Step)
admin.site.register(WorkflowMember)
admin.site.register(WorkflowRun)
admin.site.register(StepRun)
admin.site.register(AuditLog)
admin.site.register(AppSetting)
