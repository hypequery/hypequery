# Cursor Rules

These guardrails describe how to collaborate on hypequery when using the Cursor AI editor.

## Core principles
- Treat hypequery as the code-first analytics layer for ClickHouse—prioritize type-safe TypeScript and Astro code.
- Respect the existing git history and never revert user-authored changes unless asked.
- Prefer fast, local tooling (`rg`, `npm run lint`, `npm run test`) and document any manual steps you cannot run.
- Keep UI copy concise and actionable; highlight how engineers can use metrics across services, dashboards, and agents.

## Coding guidelines
1. Default to TypeScript/TSX and modern ECMAScript syntax.
2. Add comments only when they clarify non-obvious behavior—avoid noise.
3. Ensure new docs/pages live under `website/src/pages/docs` and share styles with existing components.
4. Keep static assets in `website/public` and use relative imports with Vite `?raw` when copy text needs to live outside the markup.
5. Validate changes locally whenever possible and describe any skipped checks in pull request notes.

## Communication
- Summarize changes succinctly and suggest clear follow-ups when relevant.
- Surface potential risks (missing tests, coupling, API changes) early rather than surprising reviewers later.

Save this file locally if you want the Cursor agent to mirror these rules in your workspace.
