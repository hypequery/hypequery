"""Prepare the version, lockfile and Towncrier changelog for a Python release PR."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tomllib
from datetime import UTC, date, datetime
from pathlib import Path

from utils.release_notes import insert_release_notes, validate_next_version


class ReleasePreparation:
    """Operate on one SDK checkout, restoring files if preparation fails."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def _run(self, command: list[str]) -> str:
        result = subprocess.run(  # noqa: S603 -- fixed executables, arguments passed without a shell.
            command, cwd=self.root, text=True, capture_output=True, check=True
        )
        return result.stdout

    def prepare(self, version: str, release_date: date) -> str:
        project = self.root / "pyproject.toml"
        lock = self.root / "uv.lock"
        changelog = self.root / "CHANGELOG.md"
        current = str(tomllib.loads(project.read_text())["project"]["version"])
        old_notes = changelog.read_text()
        validate_next_version(current, version, old_notes)
        uv = shutil.which("uv")
        if uv is None:
            raise ValueError("uv must be installed to update the release version and lockfile")
        fragments = sorted(
            path
            for path in (self.root / "changelog.d").glob("*.md")
            if path.name.lower() not in {"readme.md", "template.md"}
        )
        # Draft mode validates and renders without deleting fragments or staging Git changes.
        draft = self._run(
            [
                sys.executable,
                "-m",
                "towncrier",
                "build",
                "--draft",
                "--version",
                version,
                "--date",
                release_date.isoformat(),
            ]
        )
        heading = f"## {version} ({release_date.isoformat()})"
        if heading not in draft.splitlines():
            raise ValueError("Towncrier did not render the expected release heading")
        notes = draft[draft.index(heading) :].strip() + "\n"
        updated = insert_release_notes(old_notes, notes)
        snapshots = {path: path.read_bytes() for path in [project, lock, changelog, *fragments]}
        try:
            self._run([uv, "version", version, "--no-sync"])
            self._run([uv, "lock", "--check"])
            changelog.write_text(updated)
            for fragment in fragments:
                fragment.unlink()
        except (OSError, subprocess.CalledProcessError):
            for path, content in snapshots.items():
                path.write_bytes(content)
            raise
        return notes


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True, help="e.g. 0.1.0b1 or 0.1.0")
    parser.add_argument("--date", type=date.fromisoformat, default=datetime.now(UTC).date())
    parser.add_argument("--body-file", type=Path)
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()
    try:
        notes = ReleasePreparation(Path.cwd()).prepare(args.version, args.date)
    except ValueError as error:
        parser.error(str(error))
    except subprocess.CalledProcessError as error:
        parser.exit(1, error.stderr or str(error))
    if args.body_file:
        args.body_file.write_text(
            f"Prepare the Python SDK and bundled CLI for {args.version}. "
            "This updates the package version and lockfile and consolidates the pending "
            "Towncrier fragments. The preparation workflow runs Python CI on this commit.\n\n"
            "Review the release notes and package maturity before merging. "
            f"After merge, tag the merged commit as `python-v{args.version}` "
            "to run the gated PyPI release workflow. Merging this PR does not publish "
            "a beta or stable release.\n\n" + notes
        )
    if args.github_output:
        with args.github_output.open("a") as output:
            output.write(f"version={args.version}\n")
    print(notes)


if __name__ == "__main__":
    main()
