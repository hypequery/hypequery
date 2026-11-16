"""Author reviewed business context for agents and analysts.

Mirrors `@hypequery/datasets`' `defineBusinessContext`: keyword arguments in
Python spelling become the wire fields (`business_model` is `businessModel`),
and the result is the validated `hypequery-business-context` v1 document.
"""

from __future__ import annotations

from collections.abc import Sequence

from hypequery.protocol import (
    ProtocolBusinessContext,
    ProtocolBusinessContextGlossaryTerm,
    ProtocolBusinessContextKpi,
    validate_protocol_business_context,
)


def _listed(value: object) -> object:
    """A tuple is a list to an author; anything else is left for validation to judge."""

    return list(value) if isinstance(value, tuple) else value


def define_business_context(
    *,
    summary: str | None = None,
    industry: str | None = None,
    business_model: str | None = None,
    customers: str | None = None,
    audience: str | None = None,
    goals: Sequence[str] | None = None,
    kpis: Sequence[ProtocolBusinessContextKpi] | None = None,
    glossary: Sequence[ProtocolBusinessContextGlossaryTerm] | None = None,
    conventions: str | None = None,
    caveats: Sequence[str] | None = None,
) -> ProtocolBusinessContext:
    """Declare reviewed business context: summary, KPIs, glossary, conventions, caveats.

    It is guidance only: agents read it before they interpret numbers, and it
    never changes what a query returns. Text is trimmed and empty lists are
    dropped; an argument left as ``None`` is omitted.

    Raises `hypequery.protocol.ProtocolBusinessContextError` naming the
    offending path when the document is invalid, e.g. ``$.glossary[1].term``
    for a glossary term defined twice.
    """

    fields: dict[str, object] = {
        "summary": summary,
        "industry": industry,
        "businessModel": business_model,
        "customers": customers,
        "audience": audience,
        "goals": _listed(goals),
        "kpis": _listed(kpis),
        "glossary": _listed(glossary),
        "conventions": conventions,
        "caveats": _listed(caveats),
    }
    document: dict[str, object] = {"kind": "hypequery-business-context", "version": 1}
    document.update((key, value) for key, value in fields.items() if value is not None)
    return validate_protocol_business_context(document)
