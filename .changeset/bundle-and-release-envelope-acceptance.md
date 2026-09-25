---
"@hypequery/protocol": minor
"@hypequery/protocol-conformance": minor
---

Accept RFC 0007 and RFC 0008, freezing deployment bundle manifest version 1
and deployment release version 1.

Both accepted texts record rules the implementations already enforce and the
Proposed texts left implicit. For bundles: the `node`/`python` runtime set, a
manifest with no artifacts being valid for a dataset-only deployment, digests
being lowercase hexadecimal rather than case-folded, and the optional `source`
block — its root, entrypoint, sorted and case-unique files, and git revision
with a 40- or 64-character commit and a valid reference name for a branch.
Path uniqueness is stated as applying under ASCII case folding across the
deployment file, artifacts, and source files together, and a path whose
ancestor directory is itself a declared file is rejected because the two
cannot coexist on a real filesystem.

For releases: `bundleIdentity` is lowercase hexadecimal, matching the bundle
identity it names.

Every rule was checked against both implementations before being recorded, in
an 83-probe differential run covering the envelope, path grammar, ordering and
uniqueness, the source block, git reference rules, target tokens, and both
identity hashes. Neither implementation changed.
