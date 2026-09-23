"""Semantic planning and the RFC 0010 compiled query contract.

`plan_dataset_query` is the entry point: a dataset plus a semantic query in,
one `CompiledQuery` out. Nothing else in the package builds SQL, which is what
makes "a request never authors execution logic" a property of the code rather
than a convention.
"""

from __future__ import annotations

from .compiled_query import (
    MAX_CORRELATION_ID_BYTES,
    CompiledQuery,
    CompiledQueryOperation,
    validate_correlation_id,
)
from .context import (
    Cancellation,
    Deadline,
    ExecutionContext,
    TenantScope,
    all_tenants,
    effective_deadline,
    tenant,
    tenants,
)
from .errors import (
    CompiledQueryError,
    CompiledQueryErrorCategory,
    CompiledQueryFailure,
)
from .identifiers import (
    SafeIdentifier,
    SafeQualifiedIdentifier,
    safe_identifier,
    safe_qualified_identifier,
)
from .parameters import TypedParameter, clickhouse_type_for
from .planner import plan_dataset_query
from .query import DatasetQuery
from .settings import (
    DEFAULT_QUERY_SETTINGS,
    SETTING_DEFINITIONS,
    QuerySettings,
    SettingDefinition,
    query_settings,
)

__all__ = [
    "DEFAULT_QUERY_SETTINGS",
    "MAX_CORRELATION_ID_BYTES",
    "SETTING_DEFINITIONS",
    "Cancellation",
    "CompiledQuery",
    "CompiledQueryError",
    "CompiledQueryErrorCategory",
    "CompiledQueryFailure",
    "CompiledQueryOperation",
    "DatasetQuery",
    "Deadline",
    "ExecutionContext",
    "QuerySettings",
    "SafeIdentifier",
    "SafeQualifiedIdentifier",
    "SettingDefinition",
    "TenantScope",
    "TypedParameter",
    "all_tenants",
    "clickhouse_type_for",
    "effective_deadline",
    "plan_dataset_query",
    "query_settings",
    "safe_identifier",
    "safe_qualified_identifier",
    "tenant",
    "tenants",
    "validate_correlation_id",
]
