# Cache key version 1 fixtures

These language-neutral fixtures accompany accepted RFC 0013 and are normative
for cache key version 1.

## Success manifest

Each entry in `success.json` contains:

- `id`: stable fixture identifier;
- `secretHex`: the cache-key secret as lowercase hex;
- `namespace`: the `{project, environment}` pair;
- `keyVersion`: the integer key version;
- `preimageUtf8`: the exact canonical preimage as UTF-8 text;
- `namespaceToken`: the expected opaque namespace prefix;
- `key`: the expected complete store key.

Both `namespaceToken` and `key` are exact. An implementation that produces a
different string for the same inputs is non-conformant, not merely different.

## Rejection manifest

Entries in `rejections.json` carry the same input fields plus the required
stable `error` code. An entry may replace `preimageUtf8` with a `generator`:

- `repeat-string`: concatenates `count` copies of the UTF-8 string `utf8`.

`secretHex` is an empty string for the missing-secret case.
The `precedence-*` cases deliberately violate several constraints at once and
pin the RFC's required first failure.

## How these expectations were produced

The expected keys were generated with an implementation independent of the
TypeScript reference: Node's built-in `crypto.createHmac` rather than the
`@noble/hashes` primitives `@hypequery/protocol` uses. Agreement between the
two is therefore cross-validation rather than a restatement of one
implementation's behaviour.

## What the corpus is designed to prove

Beyond exact derivation, the success cases demonstrate the separation
properties the scheme exists for:

- `namespace-separates-environment` and `namespace-separates-project` — an
  identical preimage under a different namespace yields a different key, so a
  shared store cannot serve one environment's entry to another;
- `rotation-changes-key` — incrementing `keyVersion` changes the key, making
  rotation a flush rather than a silent reuse;
- `secret-separates-key` — a different secret yields a different key even for
  an identical namespace and preimage;
- `deployment-target-punctuation` and `deployment-target-leading-digit` — the
  namespace accepts the RFC 0008 target grammar used by deployment releases;
- `sensitive-preimage-not-recoverable` — a preimage containing an email
  address and a tenant identifier produces a key containing neither.

The last of these is the whole point of the RFC: the previous scheme used the
readable preimage as the store key, so those values appeared in `SCAN` output,
eviction logs, and metric labels.
