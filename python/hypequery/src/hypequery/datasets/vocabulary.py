"""Agent-facing vocabulary a dimension or measure may declare beside its label."""

from __future__ import annotations

import re

from pydantic import field_validator

from ._base import DefinitionModel

_CURRENCY = re.compile(r"[A-Z]{3}\Z", re.ASCII)


class FieldVocabulary(DefinitionModel):
    """Synonyms, example values, display format, unit and ISO 4217 currency.

    Presentation data for people and agents, as in TypeScript: it grants nothing
    and never changes validation, SQL or results. Client contracts advertise it
    to consumers that ask for field metadata. Deployment contracts do not
    publish it yet.
    """

    synonyms: tuple[str, ...] | None = None
    examples: tuple[str, ...] | None = None
    format: str | None = None
    unit: str | None = None
    currency: str | None = None

    @field_validator("currency")
    @classmethod
    def _currency_code(cls, value: str | None) -> str | None:
        if value is not None and _CURRENCY.match(value) is None:
            raise ValueError("currency must be an ISO 4217 code such as 'EUR'")
        return value
