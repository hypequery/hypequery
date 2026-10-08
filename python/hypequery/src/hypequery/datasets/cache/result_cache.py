"""The semantic result cache: RFC 0009 preimage in, RFC 0013 key out.

Caching is optional, and a cache failure never fails a query. Anything that
prevents building a key or reaching the store turns the call into an uncached
execution. It never falls back to a readable or unkeyed key.
"""

from __future__ import annotations

import math
import re
import secrets
import warnings
from dataclasses import dataclass, field
from typing import Final

from hypequery.protocol import (
    build_protocol_cache_preimage,
    derive_protocol_cache_key,
)

from ..dataset import Dataset
from ..planner import DatasetQuery, ExecutionContext
from ..registry import DatasetRegistry
from ..utils.query_timezone import timezone_identity
from .preimage_inputs import (
    effective_row_limit,
    local_definition_identity,
    tenant_scope,
    wire_query,
)
from .store import CachedRows, CacheStore, MemoryCacheStore

_DEFINITION_IDENTITY: Final = re.compile(r"[0-9a-f]{64}\Z")


@dataclass(frozen=True, slots=True, kw_only=True)
class ResultCache:
    """Configuration for caching dataset results in one namespace.

    *secret* is optional. When it is omitted, the cache generates a random
    32-byte secret for its own lifetime. Keys are just as opaque, but entries
    are shared only through this `ResultCache` object and do not survive a
    restart. That costs nothing for `MemoryCacheStore`. For a shared store
    such as Redis, pass a secret so every instance addresses the same
    entries: at least 32 random bytes, the same on every instance, distinct
    per project and environment, and never shipped in an artifact. Increment
    *key_version* whenever it rotates.

    Pass the deployed bundle identity as *definition_identity* to share entries
    with other runtimes serving the same release. Without it, a digest of the
    local definitions is used.

    Construction validates everything up front, so a misconfigured cache fails
    at startup rather than silently caching nothing. An empty or short secret
    is an error, never a reason to generate one.
    """

    store: CacheStore
    ttl_seconds: float
    #: RFC 0013 namespace. The defaults match `@hypequery/datasets`.
    project: str = "hypequery"
    environment: str = "default"
    secret: bytes | None = field(default=None, repr=False)
    key_version: int = 1
    definition_identity: str | None = None

    def __post_init__(self) -> None:
        if self.secret is None:
            # Random, never shipped, and unique to this cache: RFC 0013's
            # requirements hold without any configuration.
            object.__setattr__(self, "secret", secrets.token_bytes(32))
            if not isinstance(self.store, MemoryCacheStore):
                warnings.warn(
                    "ResultCache has no secret, so it generated one for this process. "
                    "Other instances sharing this store will not reuse its entries. "
                    "Pass the same secret to every instance to share them.",
                    stacklevel=3,
                )
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

        if query.having:
            # The RFC 0009 normalized query has no `having` yet. A key built
            # without it would hand a filtered result to an unfiltered query,
            # so these executions run uncached until the protocol carries it.
            return None
        definitions = registry.get_all() if registry is not None else ()
        if dataset not in definitions:
            definitions = (*definitions, dataset)
        try:
            preimage = build_protocol_cache_preimage(
                secret=self.secret,
                definition_identity=timezone_identity(
                    self.definition_identity or local_definition_identity(definitions),
                    query.timezone,
                ),
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
