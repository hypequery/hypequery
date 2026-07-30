---
"@hypequery/protocol": minor
"@hypequery/protocol-conformance": minor
---

Accept RFC 0001 (tagged ClickHouse value model) and align the reference
implementation and conformance adapter with it.

Both behaviour changes are relaxations — input that was previously rejected is
now accepted — so existing callers producing valid values are unaffected.

**Canonical strings now permit tab (U+0009), line feed (U+000A), and carriage
return (U+000D).** Every other C0 control, DEL, and the whole C1 range remain
forbidden. The previous blanket C0 ban made multi-line descriptions impossible.

**Timezone validation now accepts single-component identifiers.** The old
pattern required a `/`, so `EST`, `GMT`, `CET`, `MST7MDT`, and `W-SU` — all
real tzdb entries — were rejected while only `UTC` passed via a special case.
Validation remains lexical and never consults the host timezone database:
Python `zoneinfo` and JavaScript ICU disagree about renamed zones such as
`Europe/Kiev` versus `Europe/Kyiv`, and conformance must not depend on the OS
image. Identifier existence is a deployment-time check against the target
server's `system.time_zones`. The first component must begin with a letter, so
offset-shaped input such as `+0200` is still rejected.

The RFC additionally pins behaviour that was previously underspecified without
changing this implementation:

- Metadata integers (`version`, `bits`, `precision`, `scale`, `code`) are
  defined **by value, not lexical form**. `1`, `1.0`, and `1e0` are all
  accepted and all canonicalize to `1`. A lexical rule was considered and
  rejected: JavaScript erases the distinction at parse time, so it could only
  be honoured by one language on the programmatic entry path, creating a
  cross-language divergence without preventing any confusion or hash
  collision.
- Exact `DateTime`/`DateTime64` bounds, named the **portable v1 range** — a
  deliberately conservative subset rather than a restatement of ClickHouse's
  own limits, which differ by precision and have moved between releases.
  `DateTime64(9)` caps at `2262-04-11T23:47:16.854775807Z`, the largest
  signed-64-bit nanosecond tick count since the epoch.
- RFC 8785 number serialization is the ECMAScript `Number::toString`
  algorithm. JavaScript inherits this from `JSON.stringify`; other languages
  must implement it explicitly and must not delegate to a host `repr` or
  default JSON encoder.
- Map-entry depth and node counting, and which size limit binds on the
  already-parsed entry path.

`HQ_VALUE_UNSAFE_OBJECT` was in the RFC but missing from the conformance
manifest and from the stable-code list asserted by `fixtures.test.ts`, making
it the one frozen failure code no implementation had to demonstrate. It now has
a shared `unsafe-accessor` rejection case — the same generator the expression,
schema, event, deployment, bundle, and release families already use — plus a
requirement that each implementation declare a language-specific
hostile-object suite.

Fixtures grew from 18 success and 28 rejection cases to 32 and 33. The
additions concentrate on float canonicalization boundaries, where the corpus
previously held a single case (`1.5`) that agrees across languages by
coincidence.
