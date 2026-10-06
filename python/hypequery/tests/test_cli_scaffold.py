"""Project generation preserves existing content and works from package resources."""

from __future__ import annotations

import ast
import tomllib
from pathlib import Path

import pytest

from hypequery.cli import main
from hypequery.cli.utils.templates import TEMPLATE_NAMES


def test_scaffold_new_directory_with_spaces(tmp_path: Path) -> None:
    destination = tmp_path / "my project"
    assert main(["init", str(destination)]) == 0
    assert {path.name for path in destination.iterdir()} == set(TEMPLATE_NAMES)
    ast.parse((destination / "app.py").read_text())
    project = tomllib.loads((destination / "pyproject.toml").read_text())
    assert project["project"]["dependencies"][0].startswith("hypequery[fastapi,clickhouse]==")
    assert "__HYPEQUERY_VERSION__" not in (destination / "pyproject.toml").read_text()
    assert "not loaded automatically" in (destination / "README.md").read_text()
    assert "HYPEQUERY_DEV_TOKEN=\n" in (destination / ".env.example").read_text()


def test_scaffold_defaults_to_current_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    assert main(["init"]) == 0
    assert (tmp_path / "app.py").is_file()
    original = (tmp_path / "app.py").read_bytes()
    assert main(["init"]) == 1
    assert (tmp_path / "app.py").read_bytes() == original


@pytest.mark.parametrize("kind", ["file", "directory", "symlink", "broken-symlink"])
def test_collision_is_checked_before_any_write(tmp_path: Path, kind: str) -> None:
    collision = tmp_path / "seed.sql"  # last generated path: preflight must inspect all paths
    if kind == "file":
        collision.write_text("user content")
    elif kind == "directory":
        collision.mkdir()
    else:
        collision.symlink_to(tmp_path / ("missing" if kind == "broken-symlink" else "target"))
        if kind == "symlink":
            (tmp_path / "target").write_text("user content")
    before = set(tmp_path.iterdir())
    assert main(["init", str(tmp_path)]) == 1
    assert set(tmp_path.iterdir()) == before
    if kind == "file":
        assert collision.read_text() == "user content"


def test_rejects_destination_symlink_and_ancestor(tmp_path: Path) -> None:
    target = tmp_path / "real"
    target.mkdir()
    link = tmp_path / "link"
    link.symlink_to(target, target_is_directory=True)
    for destination in (link, link / "nested"):
        assert main(["init", str(destination)]) == 1
    assert list(target.iterdir()) == []


def test_missing_parent_is_created(tmp_path: Path) -> None:
    assert main(["init", str(tmp_path / "nested" / "project")]) == 0


@pytest.mark.parametrize("parent_exists", [True, False])
def test_write_failure_rolls_back_files_and_new_directories(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    parent_exists: bool,
) -> None:
    parent = tmp_path / "new parent"
    if parent_exists:
        parent.mkdir()
    destination = parent / "project"
    # Simulate a resource write failing after an earlier file was created.
    monkeypatch.setattr(
        "hypequery.cli.scaffold.load_templates",
        lambda: {"first.txt": "created", "missing/file.txt": "will fail"},
    )
    assert main(["init", str(destination)]) == 1
    assert not destination.exists()
    assert parent.exists() is parent_exists
