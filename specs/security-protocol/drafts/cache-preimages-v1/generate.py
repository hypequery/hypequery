"""Generate draft cache-preimages-v1 fixtures from the RFC 0016 rules.

Uses Python's RFC 0003/0015 validator and RFC 8785 serializer. A separate
Node script re-derives every preimage with the TypeScript validator and its own
serializer to cross-check.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from hypequery.protocol import ProtocolExpressionError, validate_protocol_semantic_query
from hypequery.protocol._jcs import serialize_jcs

OUT = Path(sys.argv[1])
MAX = 1 << 30
DEF_A = "a" * 64
DEF_B = "b" * 64
HEX = re.compile(r"[0-9a-f]{64}\Z")


class Reject(Exception):
    def __init__(self, code: str) -> None:
        self.code = code


def jcs(value: object) -> str:
    return serialize_jcs(value, max_bytes=MAX)


def thaw(value: object) -> object:
    if isinstance(value, dict) or hasattr(value, "items"):
        return {k: thaw(v) for k, v in value.items()}  # type: ignore[union-attr]
    if isinstance(value, (list, tuple)):
        return [thaw(v) for v in value]
    return value


def normalize_query(source: object) -> dict[str, object]:
    try:
        validate_protocol_semantic_query(source, extension=2)
    except ProtocolExpressionError:
        raise Reject("HQ_CACHE_PREIMAGE_INVALID_QUERY") from None
    q = thaw(source)
    assert isinstance(q, dict)
    filters = {jcs(f): f for f in q.get("filters", [])}
    out: dict[str, object] = {
        "kind": q["kind"],
        "dataset": q["dataset"],
        "dimensions": list(q.get("dimensions", [])),
        "filters": [filters[k] for k in sorted(filters, key=lambda s: s.encode())],
        "segments": sorted(q.get("segments", []), key=lambda s: s.encode()),
        "orderBy": list(q.get("orderBy", [])),
        "by": q.get("by"),
        "offset": q.get("offset") or None,
    }
    if q["kind"] == "metric":
        out["metric"] = q["metric"]
    else:
        out["measures"] = list(q["measures"]) if "measures" in q else None
    return out


def normalize_tenant(tenant: object) -> dict[str, object]:
    bad = Reject("HQ_CACHE_PREIMAGE_INVALID_TENANT")
    if type(tenant) is not dict:
        raise bad
    mode = tenant.get("mode")
    if mode in ("none", "all"):
        if set(tenant) != {"mode"}:
            raise bad
        return {"mode": mode}
    if mode != "scoped" or set(tenant) != {"mode", "ids"}:
        raise bad
    ids = tenant["ids"]
    if type(ids) is not list or not 1 <= len(ids) <= 100:
        raise bad
    for item in ids:
        if type(item) is not str or not item or len(item.encode()) > 256:
            raise bad
    unique = sorted(set(ids), key=lambda s: s.encode())
    return {"mode": "scoped", "ids": unique}


def normalize_limit(value: object) -> int | None:
    if value is None:
        return None
    if type(value) is not int or not 0 <= value <= 2**53 - 1:
        raise Reject("HQ_CACHE_PREIMAGE_INVALID_LIMIT")
    return value


def build(case: dict[str, object]) -> str:
    definition = case["definitionIdentity"]
    if type(definition) is not str or HEX.match(definition) is None:
        raise Reject("HQ_CACHE_PREIMAGE_INVALID_DEFINITION")
    query = normalize_query(case["query"])
    tenant = normalize_tenant(case["tenant"])
    row_limit = normalize_limit(case["rowLimit"])
    return jcs(
        {
            "kind": "hypequery-cache-preimage",
            "version": 1,
            "definition": definition,
            "query": query,
            "tenant": tenant,
            "rowLimit": row_limit,
        }
    )


NONE = {"mode": "none"}
BASE = {"kind": "dataset", "dataset": "orders"}


def eq(field: str, value: object) -> dict[str, object]:
    return {
        "kind": "comparison",
        "operator": "eq",
        "left": {"kind": "reference", "name": field},
        "right": {"kind": "literal", "value": value},
    }


PAID = eq("status", "paid")
NZ = eq("customer.country", "NZ")


def case(id_: str, query: object, *, tenant: object = NONE, row_limit: object = None,
         definition: object = DEF_A, **extra: object) -> dict[str, object]:
    return {"id": id_, "definitionIdentity": definition, "query": query,
            "tenant": tenant, "rowLimit": row_limit, **extra}


success = [
    case("minimal-dataset", BASE),
    case("all-dataset-features", {
        **BASE, "dimensions": ["status", "customer.country"], "measures": ["revenue", "orders"],
        "filters": [PAID], "orderBy": [{"field": "revenue", "direction": "desc"}],
        "limit": 500, "offset": 20, "by": "quarter", "includeMeta": True,
    }, tenant={"mode": "scoped", "ids": ["acme"]}, row_limit=100),
    case("metric-query", {
        "kind": "metric", "dataset": "orders", "metric": "average_order_value",
        "dimensions": ["customer.country"], "by": "week",
    }),
    case("empty-collections-equal-omitted", {
        **BASE, "dimensions": [], "filters": [], "orderBy": [], "segments": [],
    }),
    case("offset-zero-equals-omitted", {**BASE, "offset": 0}),
    case("include-meta-and-limit-dropped", {**BASE, "includeMeta": True, "limit": 10}),
    case("measures-empty-differs-from-omitted", {**BASE, "measures": []}),
    case("filters-order-a", {**BASE, "filters": [PAID, NZ]}),
    case("filters-order-b", {**BASE, "filters": [NZ, PAID]}),
    case("duplicate-filters-collapse", {**BASE, "filters": [PAID, NZ, PAID]}),
    case("dimension-order-a", {**BASE, "dimensions": ["status", "customer.country"]}),
    case("dimension-order-b", {**BASE, "dimensions": ["customer.country", "status"]}),
    case("segments-sorted", {**BASE, "segments": ["vip", "active", "recent"], "by": "minute"}),
    case("tenant-scoped", BASE, tenant={"mode": "scoped", "ids": ["acme"]}),
    case("tenant-scoped-sorted-deduplicated", BASE,
         tenant={"mode": "scoped", "ids": ["globex", "acme", "globex"]}),
    case("tenant-all", BASE, tenant={"mode": "all"}),
    case("tenant-non-ascii", {**BASE, "filters": [eq("city", "Zürich \U0001f3d4")]},
         tenant={"mode": "scoped", "ids": ["café", "Zeta", "alpha"]}),
    case("row-limit-zero", BASE, row_limit=0),
    case("row-limit-max-safe-integer", BASE, row_limit=2**53 - 1),
    case("definition-changes-preimage", BASE, definition=DEF_B),
]

rejections = [
    case("definition-uppercase", BASE, definition="A" * 64),
    case("definition-short", BASE, definition="a" * 63),
    case("definition-not-string", BASE, definition=None),
    case("query-unknown-field", {**BASE, "sql": "SELECT 1"}),
    case("query-measures-on-metric", {
        "kind": "metric", "dataset": "orders", "metric": "aov", "measures": ["revenue"],
    }),
    case("query-duplicate-segments", {**BASE, "segments": ["vip", "vip"]}),
    case("tenant-unknown-mode", BASE, tenant={"mode": "public"}),
    case("tenant-none-with-ids", BASE, tenant={"mode": "none", "ids": ["acme"]}),
    case("tenant-scoped-empty", BASE, tenant={"mode": "scoped", "ids": []}),
    case("tenant-scoped-empty-id", BASE, tenant={"mode": "scoped", "ids": [""]}),
    case("tenant-scoped-non-string-id", BASE, tenant={"mode": "scoped", "ids": [7]}),
    case("tenant-id-too-long", BASE, tenant={"mode": "scoped", "ids": ["x" * 257]}),
    case("tenant-too-many-ids", BASE,
         tenant={"mode": "scoped", "ids": [f"t{i}" for i in range(101)]}),
    case("row-limit-negative", BASE, row_limit=-1),
    case("row-limit-above-safe-integer", BASE, row_limit=2**53),
    case("row-limit-string", BASE, row_limit="100"),
    case("precedence-definition-before-query", {**BASE, "sql": "x"},
         definition="nope", tenant={"mode": "public"}, row_limit=-1),
    case("precedence-query-before-tenant", {**BASE, "sql": "x"},
         tenant={"mode": "public"}, row_limit=-1),
    case("precedence-tenant-before-limit", BASE, tenant={"mode": "public"}, row_limit=-1),
]

# Boundary cases that must still succeed.
success += [
    case("tenant-id-256-bytes", BASE, tenant={"mode": "scoped", "ids": ["x" * 256]}),
    case("tenant-100-ids", BASE,
         tenant={"mode": "scoped", "ids": [f"t{i:03d}" for i in range(100)]}),
]

for item in success:
    item["preimageUtf8"] = build(item)
for item in rejections:
    try:
        build(item)
    except Reject as exc:
        item["error"] = exc.code
    else:
        raise SystemExit(f"rejection {item['id']} was accepted")

ids = [c["id"] for c in success + rejections]
assert len(ids) == len(set(ids)), "duplicate fixture ids"

by_id = {c["id"]: c["preimageUtf8"] for c in success}
same = [
    ("minimal-dataset", "empty-collections-equal-omitted"),
    ("minimal-dataset", "offset-zero-equals-omitted"),
    # includeMeta and the query limit are dropped; rowLimit carries the limit.
    ("minimal-dataset", "include-meta-and-limit-dropped"),
    ("filters-order-a", "filters-order-b"),
    ("filters-order-a", "duplicate-filters-collapse"),
]
differ = [
    ("minimal-dataset", "measures-empty-differs-from-omitted"),
    ("dimension-order-a", "dimension-order-b"),
    ("minimal-dataset", "tenant-scoped"),
    ("minimal-dataset", "tenant-all"),
    ("tenant-scoped", "tenant-all"),
    ("minimal-dataset", "definition-changes-preimage"),
    ("minimal-dataset", "row-limit-zero"),
]
for a, b in same:
    assert by_id[a] == by_id[b], (a, b)
for a, b in differ:
    assert by_id[a] != by_id[b], (a, b)
assert '"ids":["acme","globex"]' in by_id["tenant-scoped-sorted-deduplicated"]

OUT.mkdir(parents=True, exist_ok=True)
(OUT / "success.json").write_text(json.dumps(success, indent=2, ensure_ascii=False) + "\n")
(OUT / "rejections.json").write_text(json.dumps(rejections, indent=2, ensure_ascii=False) + "\n")
print(f"{len(success)} success, {len(rejections)} rejections")
