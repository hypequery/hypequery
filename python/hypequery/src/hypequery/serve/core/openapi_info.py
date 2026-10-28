"""The description of an API's OpenAPI document, TypeScript's `OpenApiOptions`."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class OpenApiInfo:
    """The document's `info`, TypeScript's `OpenApiOptions`."""

    title: str = "hypequery API"
    version: str = "1.0.0"
    description: str | None = None

    def __post_init__(self) -> None:
        for name in ("title", "version"):
            if type(getattr(self, name)) is not str:
                raise TypeError(f"OpenApiInfo {name} must be a string")
        if self.description is not None and type(self.description) is not str:
            raise TypeError("OpenApiInfo description must be a string or None")
