"""Detached wire models for client contracts and normalized query plans."""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict


class ClientDimension(TypedDict):
    type: Literal["string", "number", "boolean", "timestamp"]
    wireType: Literal["string", "number", "boolean", "number-or-string"]
    nullable: bool | Literal["unknown"]
    groupable: bool
    orderable: bool


class ClientMeasure(TypedDict):
    wireType: Literal["string"]
    nullable: Literal[True]
    having: bool


class ClientFilter(TypedDict):
    type: Literal["string", "number", "boolean", "timestamp"]
    operators: list[str]


class ClientTime(TypedDict):
    grains: list[str]
    defaultTimezone: str
    timezone: bool
    periodFormat: Literal["calendar-date-or-local-datetime-v1"]


class ClientQueryLimits(TypedDict):
    defaultLimit: int
    maxLimit: int
    maxOffset: int
    maxDimensions: int
    maxMeasures: int
    maxPredicates: int
    maxOrderBy: int
    maxFilterValues: int


class ClientFieldAnnotation(TypedDict, total=False):
    label: str
    description: str


class ClientEndpointAnnotations(TypedDict, total=False):
    """Presentation text only; excluded from schemaHash and never a capability."""

    label: str
    description: str
    fields: dict[str, ClientFieldAnnotation]


class ProtocolClientEndpoint(TypedDict):
    id: str
    kind: Literal["dataset", "metric"]
    dataset: str
    path: str
    dimensions: dict[str, ClientDimension]
    measures: dict[str, ClientMeasure]
    filters: dict[str, ClientFilter]
    time: ClientTime | None
    metadata: bool
    limits: ClientQueryLimits
    schemaHash: str
    defaultMeasures: NotRequired[list[str]]
    annotations: NotRequired[ClientEndpointAnnotations]


class ProtocolClientContract(TypedDict):
    kind: Literal["hypequery-client-contract"]
    version: Literal[1]
    view: Literal["build", "authorized"]
    endpoints: list[ProtocolClientEndpoint]
    contentHash: str


class PreparedProtocolClientContract(TypedDict):
    contract: ProtocolClientContract
    canonical: str
    contentHash: str


class ClientQueryPlan(TypedDict):
    endpoint: ProtocolClientEndpoint
    body: dict[str, object]
    selectedMeasures: list[str]
    effectiveLimit: int
