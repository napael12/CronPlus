import pytest
from scheduler.variable_resolver import resolve, _safe_eval


class TestSafeEval:
    def test_plain_string(self):
        assert _safe_eval("hello") == "hello"

    def test_arithmetic(self):
        assert _safe_eval("1 + 1") == 2

    def test_math_module(self):
        import math
        assert _safe_eval("math.floor(3.7)") == 3

    def test_disallows_import(self):
        # Should not raise but return expression string (eval fails safely)
        result = _safe_eval("__import__('os').getcwd()")
        # No builtins means __import__ is not available — result is the expression itself
        assert result == "__import__('os').getcwd()"

    def test_disallows_open(self):
        result = _safe_eval("open('/etc/passwd').read()")
        assert result == "open('/etc/passwd').read()"


@pytest.mark.django_db
class TestVariableResolver:
    def test_resolves_plain_variable(self, db):
        from core.models import Variable
        Variable.objects.create(name="greeting", expression="Hello")
        assert resolve("{greeting}") == "Hello"

    def test_resolves_multiple_variables(self, db):
        from core.models import Variable
        Variable.objects.create(name="first", expression="foo")
        Variable.objects.create(name="second", expression="bar")
        assert resolve("{first}-{second}") == "foo-bar"

    def test_unknown_variable_left_as_is(self, db):
        assert resolve("{unknown_var}") == "{unknown_var}"

    def test_python_expression_evaluated(self, db):
        from core.models import Variable
        Variable.objects.create(name="two", expression="1 + 1")
        assert resolve("{two}") == "2"

    def test_no_variables_unchanged(self, db):
        assert resolve("plain text") == "plain text"
