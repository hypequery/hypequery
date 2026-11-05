"""hypequery's agent skills and where each coding agent loads them."""

from __future__ import annotations

from dataclasses import dataclass
from importlib.resources import files
from pathlib import Path

#: Where each agent reads `<name>/SKILL.md`. Cursor and Codex both read the
#: shared Agent Skills directory, `.agents/skills`; Claude Code reads its own.
SKILL_ROOTS = {
    "claude": ".claude/skills",
    "cursor": ".agents/skills",
    "codex": ".agents/skills",
}
AGENTS = tuple(SKILL_ROOTS)


@dataclass(frozen=True, slots=True)
class SkillTarget:
    path: Path
    content: str


def packaged_skills() -> dict[str, str]:
    """Each skill's name and SKILL.md, as packaged from the repository's skills/."""

    root = files("hypequery.cli").joinpath("templates", "skills")
    return {
        entry.name: entry.joinpath("SKILL.md").read_text(encoding="utf-8")
        for entry in sorted(root.iterdir(), key=lambda item: item.name)
        if entry.is_dir()
    }


def skill_targets(agent: str, base: Path) -> list[SkillTarget]:
    """Every skill file *agent* (or ``all``) needs under *base*, each written once."""

    agents = AGENTS if agent == "all" else (agent,)
    roots = list(dict.fromkeys(SKILL_ROOTS[name] for name in agents))
    skills = packaged_skills()
    return [
        SkillTarget(base / root / name / "SKILL.md", content)
        for root in roots
        for name, content in skills.items()
    ]
