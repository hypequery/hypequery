"""Verify release identity, version and CLI before uploading distribution files."""

from __future__ import annotations

import argparse
from pathlib import Path

from utils.release_artifacts import check_release_artifacts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("version")
    args = parser.parse_args()
    check_release_artifacts(args.dist, args.version)
    print(f"Verified hypequery {args.version} wheel, sdist and CLI entry point")


if __name__ == "__main__":
    main()
