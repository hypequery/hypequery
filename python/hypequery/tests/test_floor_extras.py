"""The shared floor jobs resolve every extra except those with floor jobs of their own."""

from __future__ import annotations

import importlib.util
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("floor_extras", ROOT / "scripts/floor_extras.py")
assert SPEC is not None
assert SPEC.loader is not None
floor_extras = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(floor_extras)


def test_every_extra_but_mcp_shares_the_floor_jobs() -> None:
    declared = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"][
        "optional-dependencies"
    ]
    assert "mcp" in declared
    assert floor_extras.floor_extras(ROOT / "pyproject.toml") == [
        name for name in declared if name != "mcp"
    ]


def test_the_mcp_floor_job_exists() -> None:
    workflow = (ROOT.parents[1] / ".github/workflows/python.yml").read_text()
    assert "mcp-floor:" in workflow
    assert "--no-extra mcp" in workflow
