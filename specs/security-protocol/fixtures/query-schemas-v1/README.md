# Portable query schema v1 fixtures

These RFC 0004 fixtures cover the declarative Serve/Zod schema features that can travel between runtimes without executable transforms.

`success.json` exercises every portable schema kind. `rejections.json` pins stable errors for invalid values plus generated depth, width, description-size, and unsafe-accessor boundaries.

Every rejection contains exactly one literal value or deterministic generator.
