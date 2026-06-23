from rest_framework.permissions import BasePermission
from core.models import User


class IsAdmin(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == User.Role.ADMIN


class IsAdminOrOperator(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role in (
            User.Role.ADMIN, User.Role.OPERATOR
        )


class IsAuthenticatedReadOnly(BasePermission):
    """All authenticated users can read; only Admin can create/edit/delete."""

    SAFE_METHODS = ("GET", "HEAD", "OPTIONS")

    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.method in self.SAFE_METHODS:
            return True
        return request.user.role == User.Role.ADMIN
