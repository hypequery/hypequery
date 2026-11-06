"""`hypequery skill install`: write hypequery's agent skills where coding agents load them."""

from __future__ import annotations

from pathlib import Path

from ..errors import CliError
from ..options import SkillOptions
from ..utils.display_path import display_path
from ..utils.generated_file import GeneratedFile
from ..utils.skills import skill_targets


def run(options: SkillOptions) -> None:
    base = Path.home() if options.scope == "user" else Path.cwd()
    stale: list[str] = []
    for target in skill_targets(options.agent, base):
        output = GeneratedFile(target.path, overwrite_hint="--force")
        current = output.read()
        if current == target.content:
            continue
        if options.check:
            stale.append(display_path(target.path))
            continue
        if current is not None and not options.force:
            raise CliError(
                f"Refusing to overwrite the edited skill {display_path(target.path)}; "
                "use --force to replace it."
            )
        output.write(target.content, overwrite=options.force)
        print(f"Installed {display_path(target.path)}")
    if stale:
        raise CliError(
            f"Skills are missing or out of date: {', '.join(stale)}. "
            "Run hypequery skill install --force."
        )
    print(
        "hypequery skills are up to date." if options.check else "hypequery skills are installed."
    )
