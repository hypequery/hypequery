"""Name column-backed counts according to whether they count every row."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True, slots=True)
class CountMeasure:
    field: str
    name: Literal["totalCount", "nonNullCount"]
    label: str

    def warnings(self, table: str) -> tuple[str, ...]:
        if self.name == "totalCount":
            return ()
        return (
            f"{table}: no supported non-nullable column; totalCount was not generated. "
            f"nonNullCount counts only non-null {self.field!r} values, not every row.",
        )


def suggest_count_measure(non_nullable: Sequence[str], fallback: str) -> CountMeasure:
    """Use a nullable fallback only under an explicit non-null count name."""
    if non_nullable:
        return CountMeasure(non_nullable[0], "totalCount", "Total Count")
    return CountMeasure(fallback, "nonNullCount", "Non-null Count")
