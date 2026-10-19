"""Exercise Towncrier and uv together in disposable release checkouts."""

from __future__ import annotations

import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

import pytest

_SDK = Path(__file__).resolve().parents[1]
_SCRIPT = _SDK / "scripts" / "prepare_release_pr.py"


@pytest.fixture
def checkout(tmp_path: Path) -> Path:
    root = tmp_path / "sdk"
    shutil.copytree(
        _SDK,
        root,
        ignore=shutil.ignore_patterns(".venv", "dist", "*_cache", "__pycache__"),
    )
    # A release PR runs these tests after its version has already been bumped.
    # Use a fixed baseline so the tests do not depend on the checkout version.
    project = root / "pyproject.toml"
    current = tomllib.loads(project.read_text())["project"]["version"]
    project.write_text(
        project.read_text().replace(f'version = "{current}"', 'version = "0.1.0.dev0"', 1)
    )
    lock = root / "uv.lock"
    lock.write_text(
        lock.read_text().replace(
            f'name = "hypequery"\nversion = "{current}"',
            'name = "hypequery"\nversion = "0.1.0.dev0"',
        )
    )
    for fragment in (root / "changelog.d").glob("*.md"):
        if fragment.name not in {"README.md", "template.md"}:
            fragment.unlink()
    (root / "changelog.d" / "pr-123.md").write_text(
        "- Add a feature.\n- Preserve its second bullet.\n"
    )
    (root / "CHANGELOG.md").write_text(
        "# Changelog\n\n## Unreleased\n\n<!-- towncrier release notes start -->\n\n"
        "## 0.0.9 (2026-09-01)\n\n- Keep release history.\n"
    )
    return root


def test_prepares_beta_and_preserves_history(checkout: Path) -> None:
    body = checkout.parent / "body.md"
    output = checkout.parent / "github-output"
    result = subprocess.run(
        [
            sys.executable,
            str(_SCRIPT),
            "--version",
            "0.1.0b1",
            "--date",
            "2026-10-07",
            "--body-file",
            str(body),
            "--github-output",
            str(output),
        ],
        cwd=checkout,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert (
        tomllib.loads((checkout / "pyproject.toml").read_text())["project"]["version"] == "0.1.0b1"
    )
    lock = tomllib.loads((checkout / "uv.lock").read_text())
    assert (
        next(item["version"] for item in lock["package"] if item["name"] == "hypequery")
        == "0.1.0b1"
    )
    notes = (checkout / "CHANGELOG.md").read_text()
    assert "## 0.1.0b1 (2026-10-07)\n\n- Add a feature." in notes
    assert "- Preserve its second bullet." in notes
    assert "## 0.0.9 (2026-09-01)\n\n- Keep release history." in notes
    assert "Loading template" not in notes
    assert not (checkout / "changelog.d" / "pr-123.md").exists()
    assert (checkout / "changelog.d" / "README.md").exists()
    assert (checkout / "changelog.d" / "template.md").exists()
    assert "python-v0.1.0b1" in body.read_text()
    assert output.read_text() == "version=0.1.0b1\n"


@pytest.mark.parametrize("version", ["0.0.9", "0.1.0.dev1", "0.1.0+local", "0.1.0b1\nevil"])
def test_rejects_bad_versions_without_mutating(checkout: Path, version: str) -> None:
    paths = [checkout / name for name in ["pyproject.toml", "uv.lock", "CHANGELOG.md"]]
    snapshots = [path.read_bytes() for path in paths]
    result = subprocess.run(
        [sys.executable, str(_SCRIPT), "--version", version],
        cwd=checkout,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert [path.read_bytes() for path in paths] == snapshots
    assert (checkout / "changelog.d" / "pr-123.md").exists()


def test_invalid_fragment_fails_before_version_update(checkout: Path) -> None:
    (checkout / "changelog.d" / "unexpected.txt").write_text("Never silently discard notes.")
    old_project = (checkout / "pyproject.toml").read_bytes()
    result = subprocess.run(
        [sys.executable, str(_SCRIPT), "--version", "0.1.0b1"],
        cwd=checkout,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert (checkout / "pyproject.toml").read_bytes() == old_project
    assert (checkout / "changelog.d" / "pr-123.md").exists()


def test_promotion_without_new_fragments(checkout: Path) -> None:
    (checkout / "changelog.d" / "pr-123.md").unlink()
    result = subprocess.run(
        [sys.executable, str(_SCRIPT), "--version", "0.1.0"],
        cwd=checkout,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "- No new user-visible changes." in (checkout / "CHANGELOG.md").read_text()


def test_uv_failure_restores_version_lock_and_notes(
    checkout: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    tool_dir = tmp_path / "bin"
    tool_dir.mkdir()
    fake_uv = tool_dir / "uv"
    fake_uv.write_text("#!/bin/sh\nprintf broken > pyproject.toml\nexit 1\n")
    fake_uv.chmod(0o755)
    monkeypatch.setenv("PATH", str(tool_dir))
    paths = [checkout / name for name in ["pyproject.toml", "uv.lock", "CHANGELOG.md"]]
    snapshots = [path.read_bytes() for path in paths]
    result = subprocess.run(
        [sys.executable, str(_SCRIPT), "--version", "0.1.0b1"],
        cwd=checkout,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert [path.read_bytes() for path in paths] == snapshots
    assert (checkout / "changelog.d" / "pr-123.md").exists()
