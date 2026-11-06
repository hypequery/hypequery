"""Smoke test for the marimo chDB notebook in examples/.

The notebook is excluded from mypy (marimo generates untyped cells), so this
runs it end to end against the local package and checks what a reader sees.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest

pytest.importorskip("chdb")
pytest.importorskip("marimo")
pytest.importorskip("altair")

NOTEBOOK = Path(__file__).resolve().parents[1] / "examples" / "marimo_chdb.py"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("marimo_chdb", NOTEBOOK)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_marimo_chdb_notebook_runs() -> None:
    _, defs = _load().app.run()

    assert defs["row_count"] == "50000"

    by_country = defs["country_frame"]
    assert set(by_country.columns) == {"country", "revenue", "orderCount"}
    assert set(by_country["country"]) == {"NZ", "AU", "US", "GB", "DE"}
    # One tenant of three, paid orders only: well under a third of all rows.
    tenant_orders = int(by_country["orderCount"].astype(int).sum())
    assert 0 < tenant_orders < 50000 // 3

    assert defs["chart"].to_dict()["mark"]["type"] == "bar"
