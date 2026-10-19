# Installed tutorial qualification

Prepare with `bash scripts/prepare-python-client-tutorial.sh`; follow the copied
`examples/client_dashboard/README.md` using a dedicated ClickHouse database.
The helper touches no database. It installs a built wheel and packed Node
packages outside the checkout, exports/generates/checks types, strictly compiles
React and audits the browser bundle for backend imports.

Start the Python API and React server, then in a real browser:

1. Connect as A. All four concurrent hook requests must succeed. Sales totals
   60 as a decimal string, and grouping includes a null country.
2. Page both dataset and metric queries to three pages. Both next buttons must
   disable at termination; totals stay 60.
3. Connect as B. Sales becomes 1000; neither finite results nor pages retain A
   data. Page both queries to two pages and verify termination.
4. Reconnect as A. Its data returns and the new cache starts with one page.
5. Verify requests carry schema pins, CORS preflights permit them, and the console
   has no request errors. Do not persist real user credentials in evidence.

Run `npm run check:mcp` in the prepared frontend with both tutorial token
variables. It launches actual installed CLI stdio children through the MCP SDK,
queries both principals, pages nullable data, verifies metric aliases/public
metadata, rejects SQL/context inputs and checks child shutdown.

Executed on 16 October 2026: installed Python 0.1.0.dev0, packed CLI 1.24.1,
MCP 0.9.0, datasets 0.23.1, protocol 0.20.0 and React 0.6.4, with React 19,
headed Chrome and isolated native ClickHouse 26.6.2.20. The first browser run
found overlapping requests failing because of automatic driver sessions; the
separate concurrency fix is required for this journey. With that fix, the live
Python journeys, browser steps and installed MCP check pass. The browser bundle
has no backend package/Python inputs.

This is development-artifact evidence. The reusable installed client gate covers
ClickHouse 25.8/26.3, React 18/19, actual MCP→Python→database cancellation, and
related/HAVING/timezone queries against independent SQL. Exact published versions,
full HTTP error/refresh coverage and publisher qualification remain beta gates.
