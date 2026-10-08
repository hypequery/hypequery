"""The per-package coverage gate must fail below a floor, not merely pass above it."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import ModuleType

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check_coverage.py"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_coverage", _SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


check = _load()


def _report(covered: int) -> dict[str, object]:
    files: dict[str, object] = {}
    for package in check.FLOORS:
        files[f"src/hypequery/{package}/module.py"] = {
            "summary": {
                "covered_lines": covered,
                "num_statements": 100,
                "covered_branches": 0,
                "num_branches": 0,
            }
        }
    files["src/hypequery/__init__.py"] = {"summary": {"covered_lines": 0, "num_statements": 10}}
    return {"files": files}


def test_package_of_ignores_root_modules_and_foreign_paths() -> None:
    assert check.package_of("src/hypequery/serve/router.py") == "serve"
    assert check.package_of("/ci/python/hypequery/src/hypequery/protocol/x.py") == "protocol"
    assert check.package_of("src/hypequery/__init__.py") is None
    assert check.package_of("tests/test_x.py") is None


def test_branches_count_toward_package_coverage() -> None:
    report = {
        "files": {
            "src/hypequery/cli/a.py": {
                "summary": {
                    "covered_lines": 8,
                    "num_statements": 10,
                    "covered_branches": 2,
                    "num_branches": 10,
                }
            }
        }
    }
    assert check.package_coverage(report) == {"cli": 50.0}


def test_gate_passes_at_and_fails_below_the_floors(tmp_path: Path) -> None:
    passing = tmp_path / "passing.json"
    passing.write_text(json.dumps(_report(100)))
    failing = tmp_path / "failing.json"
    failing.write_text(json.dumps(_report(50)))

    assert check.main(["check_coverage.py", str(passing)]) == 0
    assert check.main(["check_coverage.py", str(failing)]) == 1


def test_an_unmeasured_package_fails_the_gate(tmp_path: Path) -> None:
    report = tmp_path / "empty.json"
    report.write_text(json.dumps({"files": {}}))
    assert check.main(["check_coverage.py", str(report)]) == 1
