# Portable query schema v1 fixtures

These RFC 0004 fixtures cover the declarative Serve/Zod schema features that can travel between runtimes without executable transforms.

`success.json` exercises every portable schema kind. `rejections.json` pins stable errors for invalid values plus generated depth, width, description-size, and unsafe-accessor boundaries.

Acceptance of RFC 0004 extended the rejection corpus to pin the constraint rules the accepted text now freezes: `void` rejecting a `default` as an unknown field, a `default` its own schema would reject, an untagged composite default, empty `enum.values`, a single-variant `union`, repeated `required` names, a missing `unknownProperties`, and the numeric and collection bound rules.

Every rejection contains exactly one literal value or deterministic generator.
