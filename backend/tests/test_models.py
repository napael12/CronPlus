import pytest
from django.core.exceptions import ValidationError
from core.models import User, Project, Workflow, Step, WorkflowMember, Variable


@pytest.mark.django_db
class TestUserModel:
    def test_create_user_email_as_username(self):
        user = User.objects.create_user(email="u@example.com", password="pass1234")
        assert user.email == "u@example.com"
        assert user.check_password("pass1234")
        assert user.role == User.Role.READ_ONLY

    def test_create_superuser_is_admin(self):
        user = User.objects.create_superuser(email="su@example.com", password="pass1234")
        assert user.role == User.Role.ADMIN
        assert user.is_staff
        assert user.is_superuser

    def test_email_required(self):
        with pytest.raises(ValueError):
            User.objects.create_user(email="", password="pass1234")


@pytest.mark.django_db
class TestProjectModel:
    def test_project_creation(self, project):
        assert project.name == "Test Project"
        assert project.is_active

    def test_project_unique_name(self, project):
        with pytest.raises(Exception):
            Project.objects.create(name="Test Project")


@pytest.mark.django_db
class TestWorkflowModel:
    def test_workflow_str(self, workflow):
        assert "Test Project" in str(workflow)
        assert "Test Workflow" in str(workflow)

    def test_workflow_unique_per_project(self, workflow, project):
        with pytest.raises(Exception):
            Workflow.objects.create(project=project, name="Test Workflow")

    def test_workflow_defaults(self, workflow):
        assert workflow.is_active
        assert workflow.crontab == ""
        assert workflow.notify_on_error
        assert not workflow.notify_on_success


@pytest.mark.django_db
class TestStepModel:
    def test_step_defaults(self, step):
        assert step.is_active
        assert step.timeout == -1
        assert step.on_success == Step.StepOutcome.CONTINUE
        assert step.on_error == Step.StepOutcome.STOP
        assert not step.use_shell

    def test_step_ordering(self, workflow):
        s1 = Step.objects.create(workflow=workflow, name="S1", command="echo", order=2)
        s2 = Step.objects.create(workflow=workflow, name="S2", command="echo", order=1)
        steps = list(workflow.steps.all())
        assert steps[0].pk == s2.pk
        assert steps[1].pk == s1.pk


@pytest.mark.django_db
class TestWorkflowMember:
    def test_member_requires_exactly_one_target(self, workflow, step):
        member = WorkflowMember(parent=workflow)
        with pytest.raises(ValidationError):
            member.full_clean()

    def test_member_with_step(self, workflow, step):
        member = WorkflowMember.objects.create(parent=workflow, step=step, order=0)
        assert member.step == step
        assert member.child_workflow is None

    def test_member_cannot_have_both(self, workflow, step, project):
        child_wf = Workflow.objects.create(project=project, name="Child")
        member = WorkflowMember(parent=workflow, step=step, child_workflow=child_wf)
        with pytest.raises(ValidationError):
            member.full_clean()


@pytest.mark.django_db
class TestVariableModel:
    def test_variable_unique_name(self, db):
        Variable.objects.create(name="MY_VAR", expression="hello")
        with pytest.raises(Exception):
            Variable.objects.create(name="MY_VAR", expression="world")
