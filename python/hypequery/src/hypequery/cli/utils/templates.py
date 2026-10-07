"""Packaged scaffold resources; independent of frameworks and the checkout."""

from __future__ import annotations

from importlib.metadata import version
from importlib.resources import files

TEMPLATE_NAMES = ("pyproject.toml", "app.py", ".env.example", ".gitignore", "README.md", "seed.sql")


def load_templates() -> dict[str, str]:
    root = files("hypequery.cli").joinpath("templates")
    return {
        name: root.joinpath(name + ".template" if name == "pyproject.toml" else name)
        .read_text(encoding="utf-8")
        .replace("__HYPEQUERY_VERSION__", version("hypequery"))
        for name in TEMPLATE_NAMES
    }
