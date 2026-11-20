- The packaged `hypequery-datasets` skill no longer tells TypeScript projects to
  run `hypequery mcp --print-config` (a Python-only flag); it points them at
  `hypequery mcp:install` and keeps `--print-config` for Python.
- The `hypequery-onboard` skill says its `npx` steps need Node.js 22.12 or newer,
  and has agents finish Cloud sign-in with `login --device --no-wait`, showing
  the person the link instead of signing in for them.
