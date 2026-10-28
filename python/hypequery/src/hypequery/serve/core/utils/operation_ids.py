"""OpenAPI operation ids and summaries, named as FastAPI named them."""

from __future__ import annotations

import re


def operation_id(name: str, path: str, method: str) -> str:
    """A unique id from the handler's name, the route's path and its method."""

    return re.sub(r"\W", "_", f"{name}{path}") + f"_{method.lower()}"


def operation_summary(name: str) -> str:
    """``dataset_query`` as ``Dataset Query``."""

    return name.replace("_", " ").title()
