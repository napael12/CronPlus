"""
API endpoint tests: auth, permissions, CRUD operations.
"""
import pytest
from django.test import Client


@pytest.fixture
def client():
    return Client()


def _login(client, user):
    client.force_login(user)
    return client


@pytest.mark.django_db
class TestAuthEndpoints:
    def test_login_success(self, client, admin_user):
        resp = client.post(
            "/api/v1/auth/login/",
            {"email": "admin@test.com", "password": "password1"},
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "admin@test.com"

    def test_login_wrong_password(self, client, admin_user):
        resp = client.post(
            "/api/v1/auth/login/",
            {"email": "admin@test.com", "password": "wrongpass"},
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_me_requires_auth(self, client):
        resp = client.get("/api/v1/auth/me/")
        assert resp.status_code == 403

    def test_me_returns_user(self, client, admin_user):
        _login(client, admin_user)
        resp = client.get("/api/v1/auth/me/")
        assert resp.status_code == 200
        assert resp.json()["email"] == "admin@test.com"

    def test_logout(self, client, admin_user):
        _login(client, admin_user)
        resp = client.post("/api/v1/auth/logout/")
        assert resp.status_code == 200
        # Now me should fail
        resp2 = client.get("/api/v1/auth/me/")
        assert resp2.status_code == 403


@pytest.mark.django_db
class TestProjectPermissions:
    def test_readonly_can_list_projects(self, client, readonly_user, project):
        _login(client, readonly_user)
        resp = client.get("/api/v1/projects/")
        assert resp.status_code == 200

    def test_readonly_cannot_create_project(self, client, readonly_user):
        _login(client, readonly_user)
        resp = client.post(
            "/api/v1/projects/",
            {"name": "New", "description": ""},
            content_type="application/json",
        )
        assert resp.status_code == 403

    def test_operator_cannot_create_project(self, client, operator_user):
        _login(client, operator_user)
        resp = client.post(
            "/api/v1/projects/",
            {"name": "New", "description": ""},
            content_type="application/json",
        )
        assert resp.status_code == 403

    def test_admin_can_create_project(self, client, admin_user):
        _login(client, admin_user)
        resp = client.post(
            "/api/v1/projects/",
            {"name": "New Project", "description": ""},
            content_type="application/json",
        )
        assert resp.status_code == 201


@pytest.mark.django_db
class TestWorkflowRun:
    def test_operator_can_trigger_workflow(self, client, operator_user, workflow):
        _login(client, operator_user)
        resp = client.post(f"/api/v1/workflows/{workflow.id}/run/")
        assert resp.status_code == 200

    def test_readonly_cannot_trigger_workflow(self, client, readonly_user, workflow):
        _login(client, readonly_user)
        resp = client.post(f"/api/v1/workflows/{workflow.id}/run/")
        assert resp.status_code == 403

    def test_readonly_cannot_trigger_step(self, client, readonly_user, step):
        _login(client, readonly_user)
        resp = client.post(f"/api/v1/steps/{step.id}/run/")
        assert resp.status_code == 403


@pytest.mark.django_db
class TestVariableAPI:
    def test_admin_can_create_variable(self, client, admin_user):
        _login(client, admin_user)
        resp = client.post(
            "/api/v1/variables/",
            {"name": "TEST_VAR", "expression": "42", "description": ""},
            content_type="application/json",
        )
        assert resp.status_code == 201

    def test_readonly_cannot_create_variable(self, client, readonly_user):
        _login(client, readonly_user)
        resp = client.post(
            "/api/v1/variables/",
            {"name": "X", "expression": "1", "description": ""},
            content_type="application/json",
        )
        assert resp.status_code == 403

    def test_operator_cannot_create_variable(self, client, operator_user):
        _login(client, operator_user)
        resp = client.post(
            "/api/v1/variables/",
            {"name": "X", "expression": "1", "description": ""},
            content_type="application/json",
        )
        assert resp.status_code == 403


@pytest.mark.django_db
class TestUserManagement:
    def test_admin_can_list_users(self, client, admin_user):
        _login(client, admin_user)
        resp = client.get("/api/v1/users/")
        assert resp.status_code == 200

    def test_operator_cannot_list_users(self, client, operator_user):
        _login(client, operator_user)
        resp = client.get("/api/v1/users/")
        assert resp.status_code == 403

    def test_readonly_cannot_list_users(self, client, readonly_user):
        _login(client, readonly_user)
        resp = client.get("/api/v1/users/")
        assert resp.status_code == 403


@pytest.mark.django_db
class TestDashboard:
    def test_dashboard_requires_auth(self, client):
        resp = client.get("/api/v1/dashboard/")
        assert resp.status_code == 403

    def test_dashboard_returns_sections(self, client, readonly_user):
        _login(client, readonly_user)
        resp = client.get("/api/v1/dashboard/")
        assert resp.status_code == 200
        data = resp.json()
        assert "running" in data
        assert "recent" in data
        assert "scheduled" in data


@pytest.mark.django_db
class TestProjectExport:
    def test_export_project(self, client, admin_user, project, workflow, step):
        _login(client, admin_user)
        resp = client.get(f"/api/v1/projects/{project.id}/export/")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == project.name
        assert len(data["workflows"]) == 1
        assert data["workflows"][0]["name"] == workflow.name
