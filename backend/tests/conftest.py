import pytest
from django.contrib.auth import get_user_model

User = get_user_model()


@pytest.fixture
def admin_user(db):
    return User.objects.create_user(email="admin@test.com", password="password1", role="admin")


@pytest.fixture
def operator_user(db):
    return User.objects.create_user(email="operator@test.com", password="password1", role="operator")


@pytest.fixture
def readonly_user(db):
    return User.objects.create_user(email="readonly@test.com", password="password1", role="read_only")


@pytest.fixture
def project(db):
    from core.models import Project
    return Project.objects.create(name="Test Project")


@pytest.fixture
def workflow(project):
    from core.models import Workflow
    return Workflow.objects.create(project=project, name="Test Workflow")


@pytest.fixture
def step(workflow):
    from core.models import Step
    return Step.objects.create(
        workflow=workflow,
        name="Test Step",
        command="echo",
        parameters="hello",
        order=0,
    )
