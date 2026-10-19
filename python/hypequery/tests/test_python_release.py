"""Exercise release rejection paths before publishing becomes possible."""

from __future__ import annotations

import importlib.util
import io
import tarfile
import zipfile
from pathlib import Path
from types import ModuleType

import pytest


def _load_helper(name: str) -> ModuleType:
    path = Path(__file__).resolve().parents[1] / "scripts" / "utils" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


versions = _load_helper("release_versions")
artifacts = _load_helper("release_artifacts")


def test_beta_and_stable_tags_match_committed_version() -> None:
    assert versions.tagged_version("0.1.0b1", "python-v0.1.0b1") == "0.1.0b1"
    assert versions.tagged_version("0.1.0", "python-v0.1.0") == "0.1.0"


@pytest.mark.parametrize(
    "tag",
    [
        "v0.1.0",
        "python-v0.1.0b2",
        "python-v0.1.0.dev1",
        "python-v0.1.0+local",
        "python-v0.1",
        "python-v00.1.0",
        "python-v0.1.0post1",
    ],
)
def test_rejects_invalid_or_mismatched_tag(tag: str) -> None:
    with pytest.raises(ValueError, match=r"expected|does not match"):
        versions.tagged_version("0.1.0b1", tag)


def test_canary_retry_has_a_distinct_increasing_version() -> None:
    assert versions.canary_version("0.1.0.dev0", 42, 1) == "0.1.0.dev42001"
    assert versions.canary_version("0.1.0.dev0", 42, 2) == "0.1.0.dev42002"
    assert versions.canary_version("0.1.0b2", 43, 1) == "0.1.0b2.dev43001"


@pytest.mark.parametrize("version", ["0.1", "0.1.0+local", "0.1.0.post1"])
def test_rejects_unsupported_canary_base(version: str) -> None:
    with pytest.raises(ValueError, match="canary base"):
        versions.canary_version(version, 42, 1)


def test_version_replacement_preserves_other_toml_sections() -> None:
    source = (
        '[tool.example]\nversion = "keep"\n[project]\nname = "hypequery"\n'
        'version = "0.1.0.dev0"\n[tool.other]\nversion = "keep"\n'
    )
    replaced = versions.replace_project_version(source, "0.1.0.dev42001")
    assert replaced.count('version = "keep"') == 2
    assert 'version = "0.1.0.dev42001"' in replaced


@pytest.fixture
def release_dist(tmp_path: Path) -> Path:
    metadata = b"Name: hypequery\nVersion: 0.1.0b1\n"
    with zipfile.ZipFile(tmp_path / "hypequery.whl", "w") as wheel:
        wheel.writestr("hypequery-0.1.0b1.dist-info/METADATA", metadata)
        wheel.writestr(
            "hypequery-0.1.0b1.dist-info/entry_points.txt",
            "[console_scripts]\nhypequery = hypequery.cli:main\n",
        )
    with tarfile.open(tmp_path / "hypequery.tar.gz", "w:gz") as sdist:
        member = tarfile.TarInfo("hypequery-0.1.0b1/PKG-INFO")
        member.size = len(metadata)
        sdist.addfile(member, io.BytesIO(metadata))
    return tmp_path


def test_checks_both_artifacts(release_dist: Path) -> None:
    (release_dist / ".gitignore").write_text("*")
    artifacts.check_release_artifacts(release_dist, "0.1.0b1")


def test_rejects_wrong_artifact_version(release_dist: Path) -> None:
    with pytest.raises(ValueError, match="metadata does not match"):
        artifacts.check_release_artifacts(release_dist, "0.1.0b2")


def test_rejects_stale_distributions(release_dist: Path) -> None:
    (release_dist / "old.whl").write_bytes(b"")
    with pytest.raises(ValueError, match="exactly one wheel"):
        artifacts.check_release_artifacts(release_dist, "0.1.0b1")


def test_rejects_missing_cli(release_dist: Path) -> None:
    wheel_path = release_dist / "hypequery.whl"
    with zipfile.ZipFile(wheel_path) as wheel:
        metadata = wheel.read("hypequery-0.1.0b1.dist-info/METADATA")
    with zipfile.ZipFile(wheel_path, "w") as wheel:
        wheel.writestr("hypequery-0.1.0b1.dist-info/METADATA", metadata)
        wheel.writestr("hypequery-0.1.0b1.dist-info/entry_points.txt", "[console_scripts]\n")
    with pytest.raises(ValueError, match="does not register"):
        artifacts.check_release_artifacts(release_dist, "0.1.0b1")


def test_rejects_mismatched_sdist_version(release_dist: Path) -> None:
    metadata = b"Name: hypequery\nVersion: 0.1.0b2\n"
    with tarfile.open(release_dist / "hypequery.tar.gz", "w:gz") as sdist:
        member = tarfile.TarInfo("hypequery-0.1.0b1/PKG-INFO")
        member.size = len(metadata)
        sdist.addfile(member, io.BytesIO(metadata))
    with pytest.raises(ValueError, match="metadata does not match"):
        artifacts.check_release_artifacts(release_dist, "0.1.0b1")
