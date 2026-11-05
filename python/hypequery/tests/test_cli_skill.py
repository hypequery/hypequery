"""`hypequery skill install`: the repository's skills, where each agent loads them."""

from __future__ import annotations

from pathlib import Path

import pytest

from hypequery.cli import main
from hypequery.cli.utils.skills import packaged_skills

REPOSITORY_SKILLS = Path(__file__).resolve().parents[3] / "skills"


def test_the_packaged_skills_are_the_repositorys_unchanged() -> None:
    # Copy skills/ into src/hypequery/cli/templates/skills/ after editing it.
    expected = {
        path.name: (path / "SKILL.md").read_text(encoding="utf-8")
        for path in sorted(REPOSITORY_SKILLS.iterdir())
        if path.is_dir()
    }
    assert packaged_skills() == expected


@pytest.fixture
def project(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.chdir(tmp_path)
    return tmp_path


@pytest.mark.parametrize(
    ("agent", "roots"),
    [
        ("claude", {".claude"}),
        ("cursor", {".agents"}),
        ("codex", {".agents"}),
        ("all", {".claude", ".agents"}),
    ],
)
def test_installs_where_each_agent_loads_skills(project: Path, agent: str, roots: set[str]) -> None:
    assert main(["skill", "install", "--agent", agent]) == 0
    assert {path.name for path in project.iterdir()} == roots
    for root in roots:
        for name, content in packaged_skills().items():
            assert (project / root / "skills" / name / "SKILL.md").read_text() == content


def test_install_is_idempotent_and_check_passes(project: Path) -> None:
    assert main(["skill", "install"]) == 0
    assert main(["skill", "install"]) == 0
    assert main(["skill", "install", "--check"]) == 0


def test_check_fails_without_writing(project: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["skill", "install", "--check", "--agent", "claude"]) == 1
    assert "missing or out of date" in capsys.readouterr().err
    assert list(project.iterdir()) == []


def test_an_edited_skill_is_replaced_only_with_force(project: Path) -> None:
    assert main(["skill", "install", "--agent", "claude"]) == 0
    name = next(iter(packaged_skills()))
    path = project / ".claude/skills" / name / "SKILL.md"
    path.write_text("my own notes")
    assert main(["skill", "install", "--agent", "claude"]) == 1
    assert path.read_text() == "my own notes"
    assert main(["skill", "install", "--agent", "claude", "--force"]) == 0
    assert path.read_text() == packaged_skills()[name]


def test_user_scope_installs_into_the_home_directory(
    project: Path, tmp_path_factory: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    home = tmp_path_factory.mktemp("home")
    monkeypatch.setenv("HOME", str(home))
    assert main(["skill", "install", "--scope", "user", "--agent", "codex"]) == 0
    assert list(project.iterdir()) == []
    assert sorted(p.name for p in (home / ".agents/skills").iterdir()) == sorted(packaged_skills())


@pytest.mark.parametrize(
    "argv",
    [
        ["skill"],
        ["skill", "remove"],
        ["skill", "install", "--agent", "vim"],
        ["skill", "install", "--check", "--force"],
    ],
)
def test_usage_errors(argv: list[str]) -> None:
    with pytest.raises(SystemExit) as raised:
        main(argv)
    assert raised.value.code == 2
