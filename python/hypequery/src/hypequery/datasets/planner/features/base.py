"""The shared shape of a compiler feature."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..compiler import DatasetQueryCompiler


class CompilerFeature:
    """One concern of compiling a query, bound to the compiler that owns its state."""

    __slots__ = ("compiler",)

    def __init__(self, compiler: DatasetQueryCompiler) -> None:
        self.compiler = compiler
