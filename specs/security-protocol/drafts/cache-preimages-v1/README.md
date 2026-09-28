# Cache preimage version 1 fixtures (draft)

**Draft.** These fixtures accompany the proposed RFC 0016 and are not yet
normative. They sit outside `fixtures/` on purpose. Registering a family in
`manifest.json` makes it a conformance gate, which would freeze a Proposed
contract. When RFC 0016 is accepted, move this directory to
`fixtures/cache-preimages-v1/`, register it in the manifest, and delete the two
scripts.

## Success manifest

Each entry in `success.json` contains:

- `id`: stable fixture identifier;
- `definitionIdentity`: 64 lowercase hex characters;
- `query`: an RFC 0003 semantic query, validated under expression extension 2;
- `tenant`: the trusted tenant capability, as `{"mode": "none"}`,
  `{"mode": "scoped", "ids": [...]}`, or `{"mode": "all"}`;
- `rowLimit`: the effective row limit, or `null`;
- `preimageUtf8`: the exact canonical preimage.

`tenant` and `rowLimit` describe trusted execution context. They are fixture
inputs, not request fields.

## Rejection manifest

Entries in `rejections.json` carry the same inputs plus the required stable
`error` code. The `precedence-*` cases violate several rules at once and pin
the first failure.

## What the corpus is designed to prove

Equivalent requests must build identical bytes:

- `minimal-dataset`, `empty-collections-equal-omitted`,
  `offset-zero-equals-omitted` and `include-meta-and-limit-dropped` all build
  the same preimage;
- `filters-order-a`, `filters-order-b` and `duplicate-filters-collapse` all
  build the same preimage;
- `tenant-scoped-sorted-deduplicated` shows that tenant sets are sorted and
  deduplicated.

Requests that can return different rows must not:

- `measures-empty-differs-from-omitted`: `[]` selects no measures, while
  omitting the field selects every measure;
- `dimension-order-a` and `dimension-order-b`: column order is part of the
  result;
- `tenant-scoped` and `tenant-all` differ from each other and from
  `minimal-dataset`, which is tenant-free. This is the RFC 0009 cache-confusion
  guarantee;
- `definition-changes-preimage` and `row-limit-zero` differ from
  `minimal-dataset`.

## How these expectations were produced

`generate.py` implements the RFC 0016 rules with the Python validator and RFC
8785 serializer, and writes both files. `cross-check.mjs` re-derives every case
independently, with the TypeScript validator and a separate serializer. At the
time of writing, all 41 cases agree.

```console
uv run --project python/hypequery python specs/security-protocol/drafts/cache-preimages-v1/generate.py specs/security-protocol/drafts/cache-preimages-v1
pnpm --filter @hypequery/protocol build
node specs/security-protocol/drafts/cache-preimages-v1/cross-check.mjs specs/security-protocol/drafts/cache-preimages-v1
```
