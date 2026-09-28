"""The semantic result cache: RFC 0009 preimage in, RFC 0013 key out.

Caching is optional, and a cache failure never fails a query. Anything that
prevents building a key or reaching the store turns the call into an uncached
execution. It never falls back to a readable or unkeyed key.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Final

from hypequery.protocol import (
    build_protocol_cache_preimage,
    derive_protocol_cache_key,
)

from ..dataset import Dataset
from ..planner import DatasetQuery, ExecutionContext
from ..registry import DatasetRegistry
from .preimage_inputs import (
    effective_row_limit,
    local_definition_identity,
    tenant_scope,
    wire_query,
)
from .store import CachedRows, CacheStore

_DEFINITION_IDENTITY: Final = re.compile(r"[0-9a-f]{64}\Z")


@dataclass(frozen=True, slots=True)
class ResultCache:
    """Configuration for caching dataset results in one namespace.

    *secret* is the namespace's RFC 0013 cache-key secret: at least 32 random
    bytes, distinct per project and environment, and never shipped in an
    artifact. Increment *key_version* whenever it rotates. Pass the deployed
    bundle identity as *definition_identity* to share entries with other
    runtimes serving the same release. Without it, a digest of the local
    definitions is used.

    Construction validates everything up front, so a misconfigured cache fails
    at startup rather than silently caching nothing.
    """

    store: CacheStore
    secret: bytes = field(repr=False)
    project: str
    environment: str
    ttl_seconds: float
    key_version: int = 1
    definition_identity: str | None = None

    def __post_init__(self) -> None:
        if type(self.ttl_seconds) not in (int, float) or not (
            math.isfinite(self.ttl_seconds) and self.ttl_seconds > 0
        ):
            raise ValueError("ttl_seconds must be a positive, finite number")
        if self.definition_identity is not None and not _DEFINITION_IDENTITY.match(
            str(self.definition_identity)
        ):
            raise ValueError("definition_identity must be 64 lowercase hexadecimal characters")
        # Raises ProtocolCacheKeyError for a missing or short secret, an invalid
        # namespace, or an out-of-range key version.
        derive_protocol_cache_key(
            secret=self.secret,
            project=self.project,
            environment=self.environment,
            key_version=self.key_version,
            preimage=b"",
        )

    def key_for(
        self,
        dataset: Dataset,
        query: DatasetQuery,
        context: ExecutionContext | None,
        registry: DatasetRegistry | None,
    ) -> str | None:
        """The store key for this execution, or None when it cannot be cached."""

        definitions = registry.get_all() if registry is not None else ()
        if dataset not in definitions:
            definitions = (*definitions, dataset)
        try:
            preimage = build_protocol_cache_preimage(
                secret=self.secret,
                definition_identity=self.definition_identity
                or local_definition_identity(definitions),
                query=wire_query(dataset, query),
                tenant=tenant_scope(context),
                row_limit=effective_row_limit(dataset, query),
            )
            return derive_protocol_cache_key(
                secret=self.secret,
                project=self.project,
                environment=self.environment,
                key_version=self.key_version,
                preimage=preimage,
            )
        except Exception:
            # For example, an object-valued filter with no portable form, an
            # integer binary64 cannot hold, or a preimage over RFC 0013's size
            # bound. A cache failure never fails a query: run uncached.
            return None

    def get(self, key: str) -> CachedRows | None:
        try:
            return self.store.get(key)
        except Exception:
            return None

    def put(self, key: str, rows: CachedRows) -> bool:
        try:
            self.store.set(key, rows, float(self.ttl_seconds))
        except Exception:
            return False
        return True
