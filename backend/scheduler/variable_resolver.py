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

_VAR_RE = re.compile(r"\{(\w+)\}")


def _safe_eval(expression: str) -> Any:
    try:
        return eval(expression, {"__builtins__": {}}, _SAFE_BUILTINS)  # noqa: S307
    except Exception:
        return expression


def resolve(text: str) -> str:
    """Replace {var_name} placeholders with their evaluated values from the DB."""
    from core.models import Variable

    variables = {v.name: v.expression for v in Variable.objects.all()}

    def replace(match):
        name = match.group(1)
        if name not in variables:
            return match.group(0)  # leave unreferenced vars as-is
        expr = variables[name]
        # Recursively resolve nested variable references in the expression
        expr = _VAR_RE.sub(lambda m: variables.get(m.group(1), m.group(0)), expr)
        return str(_safe_eval(expr))

    return _VAR_RE.sub(replace, text)
