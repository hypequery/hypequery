"""Check that release archives carry the requested SDK identity and CLI."""

from __future__ import annotations

import configparser
import tarfile
import zipfile
from email.parser import Parser
from pathlib import Path


def check_metadata(metadata: str, version: str) -> None:
    message = Parser().parsestr(metadata)
    if message["Name"] != "hypequery" or message["Version"] != version:
        raise ValueError(f"expected hypequery {version}; archive metadata does not match")


def check_release_artifacts(dist: Path, version: str) -> None:
    wheels = list(dist.glob("*.whl"))
    sdists = list(dist.glob("*.tar.gz"))
    # uv build adds a .gitignore alongside the distributions.
    extra = set(dist.iterdir()) - {*wheels, *sdists, dist / ".gitignore"}
    if len(wheels) != 1 or len(sdists) != 1 or extra:
        raise ValueError("release directory must contain exactly one wheel and one sdist")
    with zipfile.ZipFile(wheels[0]) as wheel:
        metadata = [name for name in wheel.namelist() if name.endswith(".dist-info/METADATA")]
        if len(metadata) != 1:
            raise ValueError("wheel must contain exactly one METADATA file")
        check_metadata(wheel.read(metadata[0]).decode(), version)
        entries = configparser.ConfigParser()
        entries.read_string(
            wheel.read(metadata[0].replace("METADATA", "entry_points.txt")).decode()
        )
        if entries.get("console_scripts", "hypequery", fallback="") != "hypequery.cli:main":
            raise ValueError("wheel does not register the hypequery CLI")
    with tarfile.open(sdists[0]) as sdist:
        members = [
            member
            for member in sdist.getmembers()
            if member.name.count("/") == 1 and member.name.endswith("/PKG-INFO")
        ]
        if len(members) != 1:
            raise ValueError("sdist must contain exactly one root PKG-INFO file")
        content = sdist.extractfile(members[0])
        if content is None:
            raise ValueError("sdist PKG-INFO is not a file")
        check_metadata(content.read().decode(), version)
