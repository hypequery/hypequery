# Codex repository instructions

Follow the repository layout, commands, API policies, and release guidance in
`CLAUDE.md`.

## Code organization

- Keep reusable or independently testable pure helpers in focused files under
  the nearest `utils/` directory, or in a focused domain helper module.
- Do not define utility functions as top-level implementation details inside
  adapters, controllers, builders, or other feature files.
- Keep behavior that depends on an owning class's state as class methods.
- Do not accumulate unrelated helpers in a generic `utils.ts` file.
