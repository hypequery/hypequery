"""The table selection init was given, recorded in schema.json for regeneration.

Regenerating without repeating ``--tables`` used to widen a project created
from a few tables to every table in the database. When init is given
``--tables`` or ``--exclude-tables``, it records them in ``schema.json``;
regeneration reuses them unless told otherwise. A project initialised from
every table records nothing, so new tables keep appearing on regeneration.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class TableSelection:
    tables: str | None
    exclude_tables: str | None

    def snapshot(self) -> dict[str, str]:
        """The selection as recorded: names stripped and comma-joined, as discovery reads them."""

        recorded = {
            "tables": _canonical(self.tables),
            "excludeTables": _canonical(self.exclude_tables),
        }
        return {key: value for key, value in recorded.items() if value}


def _canonical(names: str | None) -> str | None:
    if names is None:
        return None
    return ",".join(name.strip() for name in names.split(",") if name.strip()) or None


def recorded_selection(directory: Path) -> TableSelection | None:
    """The selection recorded in *directory*/schema.json, or None."""

    try:
        document = json.loads((directory / "schema.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    selection = document.get("selection") if isinstance(document, dict) else None
    if not isinstance(selection, dict):
        return None
    tables = selection.get("tables")
    exclude = selection.get("excludeTables")
    if not all(value is None or (isinstance(value, str) and value) for value in (tables, exclude)):
        return None
    if tables is None and exclude is None:
        return None
    return TableSelection(tables, exclude)
