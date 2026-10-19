"""Validate a release tag or set a temporary canary version before building."""

from __future__ import annotations

import argparse
import tomllib
from pathlib import Path

from utils.release_versions import canary_version, replace_project_version, tagged_version


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--tag")
    mode.add_argument("--canary", action="store_true")
    parser.add_argument("--run-number", type=int, default=0)
    parser.add_argument("--attempt", type=int, default=1)
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()
    path = Path("pyproject.toml")
    source = path.read_text()
    project_version = str(tomllib.loads(source)["project"]["version"])
    try:
        if args.tag:
            version = tagged_version(project_version, args.tag)
        else:
            version = canary_version(project_version, args.run_number, args.attempt)
            path.write_text(replace_project_version(source, version))
    except ValueError as error:
        parser.error(str(error))
    if args.github_output:
        with args.github_output.open("a") as output:
            output.write(f"version={version}\n")
    print(version)


if __name__ == "__main__":
    main()
