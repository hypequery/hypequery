"""The artifact audit must reject bad archives, not merely accept good ones.

A supply-chain check that has only ever been seen to pass is indistinguishable
from one that always passes — which is exactly the bug the shell version of
this audit had.
"""

from __future__ import annotations

import importlib.util
import io
import tarfile
import zipfile
from pathlib import Path
from types import ModuleType

import pytest

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "audit_artifacts.py"


def _load_audit() -> ModuleType:
    spec = importlib.util.spec_from_file_location("audit_artifacts", _SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


audit = _load_audit()

MONOREPO_GITIGNORE = b"# Dependencies\nnode_modules\ndist\n"
PACKAGE_GITIGNORE = b"# Intentionally minimal.\ndist/\n"


def _write_wheel(path: Path, entries: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in entries.items():
            archive.writestr(name, data)


def _write_sdist(path: Path, entries: dict[str, bytes]) -> None:
    with tarfile.open(path, "w:gz") as archive:
        for name, data in entries.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))


def _good_wheel_entries() -> dict[str, bytes]:
    return {
        "hypequery/__init__.py": b"",
        "hypequery/py.typed": b"",
        "hypequery-0.1.0.dist-info/METADATA": b"Name: hypequery\n",
    }


def _good_sdist_entries() -> dict[str, bytes]:
    return {
        "hypequery-0.1.0/pyproject.toml": b"",
        "hypequery-0.1.0/README.md": b"",
        "hypequery-0.1.0/.gitignore": PACKAGE_GITIGNORE,
    }


def _build(tmp_path: Path, wheel: dict[str, bytes], sdist: dict[str, bytes]) -> Path:
    dist = tmp_path / "dist"
    dist.mkdir()
    _write_wheel(dist / "hypequery-0.1.0-py3-none-any.whl", wheel)
    _write_sdist(dist / "hypequery-0.1.0.tar.gz", sdist)
    return dist


def test_accepts_clean_artifacts(tmp_path: Path) -> None:
    dist = _build(tmp_path, _good_wheel_entries(), _good_sdist_entries())
    assert audit.main(["audit", str(dist)]) == 0


def test_rejects_missing_py_typed(tmp_path: Path) -> None:
    entries = _good_wheel_entries()
    del entries["hypequery/py.typed"]
    dist = _build(tmp_path, entries, _good_sdist_entries())
    assert audit.main(["audit", str(dist)]) == 1


@pytest.mark.parametrize(
    "stray",
    [
        "hypequery-0.1.0/.import_linter_cache/data.json",
        "hypequery-0.1.0/.mypy_cache/x.json",
        "hypequery-0.1.0/src/__pycache__/mod.pyc",
        "hypequery-0.1.0/.env",
        "hypequery-0.1.0/node_modules/left-pad/index.js",
    ],
)
def test_rejects_stray_files(tmp_path: Path, stray: str) -> None:
    entries = _good_sdist_entries()
    entries[stray] = b"junk"
    dist = _build(tmp_path, _good_wheel_entries(), entries)
    assert audit.main(["audit", str(dist)]) == 1


def test_rejects_monorepo_gitignore_leak(tmp_path: Path) -> None:
    entries = _good_sdist_entries()
    entries["hypequery-0.1.0/.gitignore"] = MONOREPO_GITIGNORE
    dist = _build(tmp_path, _good_wheel_entries(), entries)
    assert audit.main(["audit", str(dist)]) == 1


def test_errors_when_artifacts_absent(tmp_path: Path) -> None:
    empty = tmp_path / "dist"
    empty.mkdir()
    assert audit.main(["audit", str(empty)]) == 2
