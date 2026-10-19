# Python → generated types → packed React browser qualification

This is a focused browser wiring check. The Python fixture uses a deliberately
narrow SQLite test executor for its seeded query subset. It proves the installed
SDK/HTTP/browser boundary, **not ClickHouse execution correctness**. The Python
live integration suite and a later browser CI job with ClickHouse remain release
gates. Do not use this fixture as a supported SQLite adapter or production app.

Prerequisites: the workspace dependencies are installed, Node/npm, pnpm, uv and
an available Playwright CLI/browser. From the repository root run:

```bash
bash scripts/smoke-python-react-consumer.sh
```

The script builds the Python wheel and React tarball, installs them into a fresh
directory outside the repository, exports the Python build contract using base
wheel dependencies, generates/checks the client, compiles the UI strictly, bundles
it, and refuses backend packages in the bundle. The API and UI bind only to
127.0.0.1, on ports 8790/8791; a busy port fails rather than testing another server.
The script stays running until interrupted and retains its temporary artifacts
and logs for inspection. The browser fixture's two dummy credentials are public
seed data; never substitute real credentials in its client code.

Use the Playwright CLI's `open`, `snapshot` and `click` commands, observing fresh
snapshot references. Store screenshots/traces under `output/playwright/`.

1. Open `http://127.0.0.1:8791`. Wait for **Ready**. Principal A's dataset has
   null/UK/US groups with revenues `30`/`10`/`20`; metric `sales` is `60`.
   Values must be strings, and the null country must remain null.
2. Click **Load next page** twice, taking a snapshot after each click. Exactly
   three one-row pages appear, without duplicates; the button becomes disabled.
3. Click **Switch principal**. Wait for **Ready**. Principal B sees CA=`100`,
   UK=`900`, metric `sales`=`1000`, and a fresh one-page pagination result. No
   principal A values may appear in B's dataset or pages. Both clients share one
   TanStack cache, with distinct principal/schema cache scopes.
4. Inspect network requests: mounted `/mounted/v1/orders` and `/mounted/v1/sales`
   use POST, a bearer fixture token and `X-Hypequery-Client-Schema`. Infinite
   pages additionally send `X-Include-Meta: true`; offsets progress 0, 1, 2.
   CORS responses name `http://127.0.0.1:8791` explicitly. This must run across
   the two browser origins, not a mocked fetch.
5. Click **Toggle stale schema**. The page reports **HTTP 409**, exposes no
   cached result under that schema scope, and disables further paging. Requests
   retain the stale pin; the app does not replace it or refresh authentication.
   This fixture disables TanStack retries so a failed precondition is immediate.
6. Toggle back to the current schema and switch principals again. Each scope
   recovers its own correct values and pagination state.
7. Inspect the browser console. Expected failures are the deliberate 409s;
   unexpected JavaScript errors, CORS failures and failed successful-query
   requests fail the journey.

The fixture's pure `fixture:build` imports neither FastAPI nor a database driver.
The server installs the same dataset/metric definitions behind an explicit mount
and tenant-required policy. Generated types/routes contain no backend import or
physical source/tenant configuration. Source fixtures live in
`testing/fixtures/python-client-browser/`.

## Evidence from 16 October 2026

A Chromium run against a packed React 0.6.4 workspace artifact and an installed
Python 0.1.0.dev0 wheel passed the steps above: grouped nullable rows, metric,
three-page completion, A/B isolation and explicit schema conflict. The bundle had
64 inputs and no backend packages. Artifacts were installed outside the checkout.
These version labels identify development artifacts, not published releases.
ClickHouse was unavailable locally; this result does not close the live database,
MCP, release-CI or published-version qualification gates.
