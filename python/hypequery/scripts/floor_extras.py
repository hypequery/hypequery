"""Print the `--extra` flags the shared dependency-floor jobs resolve.

`uv pip compile` has no `--no-extra`, so the floor jobs name every extra but
the ones resolved in floor jobs of their own. The MCP SDK requires pydantic
2.12, which would lift the pydantic floor every other extra is tested on, so
`mcp` has its own job (`mcp-floor` in .github/workflows/python.yml).
"""

from __future__ import annotations

import tomllib
from pathlib import Path

#: Extras whose floors are resolved and tested separately.
SEPARATE = frozenset({"mcp"})


def floor_extras(pyproject: Path) -> list[str]:
    extras = tomllib.loads(pyproject.read_text())["project"]["optional-dependencies"]
    return [name for name in extras if name not in SEPARATE]


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    print(" ".join(f"--extra {name}" for name in floor_extras(root / "pyproject.toml")))
