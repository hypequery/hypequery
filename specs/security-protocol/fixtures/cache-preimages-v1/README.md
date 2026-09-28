# Cache preimage version 1 fixtures

These language-neutral fixtures accompany accepted RFC 0009 ("Tenant
fingerprint" and "Cache preimage") and are normative for cache preimage
version 1.

## Success manifest

Each entry in `success.json` contains:

- `id`: stable fixture identifier;
- `secretHex`: the namespace's RFC 0013 cache-key secret as lowercase hex,
  used for tenant fingerprints;
- `definitionIdentity`: 64 lowercase hex characters;
- `query`: an RFC 0003 semantic query, validated under expression extension 2;
- `tenant`: the trusted tenant capability, as `{"mode": "none"}`,
  `{"mode": "scoped", "ids": [...]}` with raw tenant identifiers, or
  `{"mode": "all"}`. The preimage replaces each identifier with its tenant
  fingerprint;
- `rowLimit`: the effective row limit, or `null`;
- `preimageUtf8`: the exact canonical preimage.

`secretHex`, `tenant` and `rowLimit` describe trusted execution context. They are fixture
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
- `tenant-scoped-sorted-deduplicated` shows that tenant fingerprints are
  sorted and deduplicated.

Requests that can return different rows must not:

- `measures-empty-differs-from-omitted`: `[]` selects no measures, while
  omitting the field selects every measure;
- `dimension-order-a` and `dimension-order-b`: column order is part of the
  result;
- `tenant-scoped` and `tenant-all` differ from each other and from
  `minimal-dataset`, which is tenant-free. This is the RFC 0009 cache-confusion
  guarantee;
- `definition-changes-preimage` and `row-limit-zero` differ from
  `minimal-dataset`;
- `tenant-fingerprint-follows-secret`: the same tenant under another secret
  builds a different preimage.

Raw tenant identifiers never appear in a preimage, and no scoped case's
preimage contains its raw identifiers. `tenant-id-has-no-length-cap` and
`tenant-count-has-no-cap` pin that there is no tenant limit beyond RFC 0013's
1 MiB bound on the preimage.

## How these expectations were produced

The expectations were generated twice, by independent implementations of the
rules, before any runtime implemented them:

- a Python generator built on the Python RFC 0003 validator, the RFC 8785
  serializer, and `hmac`;
- a Node generator built on the TypeScript validator, a separate serializer,
  and `node:crypto`.

Both produced identical output for all 44 cases. The conformance runner now
holds `@hypequery/protocol` and the Python package to the same bytes.
