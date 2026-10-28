"""The artifact audit must reject bad archives, not merely accept good ones.

A supply-chain check that has only ever been seen to pass is indistinguishable
from one that always passes — which is exactly the bug the shell version of
this audit had.
"""

from __future__ import annotations

import importlib.util
import io
import shutil
import subprocess
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
        **dict.fromkeys(audit.REQUIRED_WHEEL_ENTRIES, b""),
        "hypequery-0.1.0.dist-info/METADATA": b"Name: hypequery\n",
    }


def _good_sdist_entries() -> dict[str, bytes]:
    return {
        **{f"hypequery-0.1.0/src/{name}": b"" for name in audit.REQUIRED_TEMPLATE_ENTRIES},
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
        "hypequery-0.1.0/.hypothesis/unicode_data/16.0.0/charmap.json.gz",
        "hypequery-0.1.0/src/__pycache__/mod.pyc",
        "hypequery-0.1.0/.env",
        "hypequery-0.1.0/node_modules/left-pad/index.js",
        # Coverage data records absolute paths from the machine that ran the
        # tests; a local build once shipped it.
        "hypequery-0.1.0/.coverage",
        "hypequery-0.1.0/.coverage.host.1234.567890",
        "hypequery-0.1.0/coverage.json",
        "hypequery-0.1.0/htmlcov/index.html",
        "hypequery-0.1.0/reports/audit.json",
        "hypequery-0.1.0/.env.local",
        "hypequery-0.1.0/examples/.envrc",
        "hypequery-0.1.0/examples/db.sqlite3",
        "hypequery-0.1.0/tests/certs/server.pem",
        "hypequery-0.1.0/.pypirc",
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


@pytest.mark.parametrize("artifact", ["wheel", "sdist"])
@pytest.mark.parametrize(
    "missing",
    [
        "app.py",
        "datasets.py",
        "pyproject.toml.template",
        ".env.example",
        ".gitignore",
        "README.md",
        "seed.sql",
        "django/settings.py",
        "flask/app.py",
    ],
)
def test_rejects_missing_scaffold_resource(tmp_path: Path, artifact: str, missing: str) -> None:
    wheel = _good_wheel_entries()
    sdist = _good_sdist_entries()
    if artifact == "wheel":
        del wheel[f"hypequery/cli/templates/{missing}"]
    else:
        del sdist[f"hypequery-0.1.0/src/hypequery/cli/templates/{missing}"]
    dist = _build(tmp_path, wheel, sdist)
    assert audit.main(["audit", str(dist)]) == 1


def test_allows_frontend_example_gitignore(tmp_path: Path) -> None:
    entries = _good_sdist_entries()
    entries["hypequery-0.1.0/examples/client_dashboard/frontend/.gitignore"] = b"node_modules/\n"
    dist = _build(tmp_path, _good_wheel_entries(), entries)
    assert audit.main(["audit", str(dist)]) == 0


def test_rejects_stray_files_in_the_wheel(tmp_path: Path) -> None:
    entries = _good_wheel_entries()
    entries["hypequery/.coverage"] = b"junk"
    dist = _build(tmp_path, entries, _good_sdist_entries())
    assert audit.main(["audit", str(dist)]) == 1


#: Local state a working checkout accumulates, none of which may reach an sdist.
LOCAL_STATE = (
    ".coverage",
    ".coverage.host.1234.567890",
    "coverage.json",
    ".env",
    ".env.local",
    ".venv/lib/x.py",
    ".pytest_cache/v/cache/lastfailed",
    ".mypy_cache/x.json",
    "htmlcov/index.html",
    "reports/audit.json",
    "dist/hypequery-0.0.0.tar.gz",
    "db.sqlite3",
    "src/hypequery/__pycache__/x.pyc",
)


UV = shutil.which("uv")


@pytest.mark.skipif(UV is None, reason="building an sdist needs uv")
def test_built_sdist_excludes_local_state(tmp_path: Path) -> None:
    """A real build of a checkout full of local state leaves all of it out.

    The package is copied with representative local files beside it, built
    with `uv build --sdist`, and the archive must hold none of them, keep the
    scaffold's `.env.example`, and pass the audit.
    """

    root = Path(__file__).resolve().parents[1]
    package = tmp_path / "hypequery"
    package.mkdir()
    for name in ("pyproject.toml", "README.md", "LICENSE", ".gitignore"):
        shutil.copy2(root / name, package / name)
    shutil.copytree(
        root / "src", package / "src", ignore=shutil.ignore_patterns("__pycache__", "*.pyc")
    )
    for name in LOCAL_STATE:
        path = package / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("local state\n", encoding="utf-8")
    (package / ".env.example").write_text("CLICKHOUSE_PASSWORD=\n", encoding="utf-8")

    dist = tmp_path / "dist"
    assert UV is not None
    subprocess.run(
        [UV, "build", "--sdist", "--out-dir", str(dist), str(package)],
        check=True,
        capture_output=True,
        timeout=300,
    )
    (sdist,) = dist.glob("*.tar.gz")
    with tarfile.open(sdist) as archive:
        names = {"/".join(Path(name).parts[1:]) for name in archive.getnames()}

    leaked = [name for name in LOCAL_STATE if name in names or name.split("/")[0] in names]
    assert leaked == []
    assert ".env.example" in names
    assert "src/hypequery/cli/templates/.env.example" in names
    assert audit.audit_sdist(sdist) == []
