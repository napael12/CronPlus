from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    CsrfView, LoginView, LogoutView, MeView, ChangePasswordView,
    UserViewSet, VariableViewSet, ProjectViewSet,
    WorkflowViewSet, StepViewSet, WorkflowMemberViewSet,
    WorkflowRunViewSet, StepRunViewSet,
    DashboardView, AuditLogViewSet, AppSettingViewSet,
)

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")
router.register("variables", VariableViewSet, basename="variable")
router.register("projects", ProjectViewSet, basename="project")
router.register("workflows", WorkflowViewSet, basename="workflow")
router.register("steps", StepViewSet, basename="step")
router.register("workflow-members", WorkflowMemberViewSet, basename="workflowmember")
router.register("runs", WorkflowRunViewSet, basename="workflowrun")
router.register("step-runs", StepRunViewSet, basename="steprun")
router.register("audit-log", AuditLogViewSet, basename="auditlog")
router.register("settings", AppSettingViewSet, basename="appsetting")

urlpatterns = [
    path("auth/csrf/", CsrfView.as_view(), name="csrf"),
    path("auth/login/", LoginView.as_view(), name="login"),
    path("auth/logout/", LogoutView.as_view(), name="logout"),
    path("auth/me/", MeView.as_view(), name="me"),
    path("auth/change-password/", ChangePasswordView.as_view(), name="change-password"),
    path("dashboard/", DashboardView.as_view(), name="dashboard"),
    path("", include(router.urls)),
]
