"""Create a Python dataset project without network calls or database writes."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import cast

from ..scaffold import Scaffold


def run(args: object) -> None:
    options = cast(argparse.Namespace, args)
    destination = Scaffold(Path(options.directory)).create()
    print(f"Created Python dataset project in {destination}")
    print(
        "Next: follow README.md to install dependencies, configure ClickHouse and seed sample data."
    )
    print("Then run: hypequery dev")
