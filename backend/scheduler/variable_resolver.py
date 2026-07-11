import os
import re
import math
import datetime
from typing import Any


_SAFE_BUILTINS = {
    "abs": abs, "round": round, "len": len, "min": min, "max": max,
    "int": int, "float": float, "str": str, "bool": bool,
    "datetime": datetime, "math": math,
    "__builtins__": {},
}

# Matches {var_name} and {env.VAR_NAME} (dotted names supported)
_VAR_RE = re.compile(r"\{(\w+(?:\.\w+)*)\}")


def _safe_eval(expression: str) -> Any:
    try:
        return eval(expression, {"__builtins__": {}}, _SAFE_BUILTINS)  # noqa: S307
    except Exception:
        return expression


def resolve(text: str, runtime_vars: dict | None = None) -> str:
    """Replace {var_name}, {env.VAR_NAME}, and {step.NAME} placeholders.

    {env.NAME}   → os.environ["NAME"]           (left unchanged if absent)
    {step.NAME}  → runtime_vars["NAME"]          (left unchanged if absent)
    {name}       → DB Variable evaluated expression
    """
    from core.models import Variable

    variables = {v.name: v.expression for v in Variable.objects.all()}
    _runtime = runtime_vars or {}

    def _lookup(name: str) -> str:
        if name.startswith("env."):
            return os.environ.get(name[4:], f"{{{name}}}")
        if name.startswith("step."):
            return str(_runtime.get(name[5:], f"{{{name}}}"))
        return variables.get(name, f"{{{name}}}")

    def replace(match):
        name = match.group(1)
        if name.startswith("env."):
            return os.environ.get(name[4:], match.group(0))
        if name.startswith("step."):
            return str(_runtime.get(name[5:], match.group(0)))
        if name not in variables:
            return match.group(0)
        expr = variables[name]
        expr = _VAR_RE.sub(lambda m: _lookup(m.group(1)), expr)
        return str(_safe_eval(expr))

    return _VAR_RE.sub(replace, text)
