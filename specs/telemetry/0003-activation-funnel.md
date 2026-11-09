# CLI activation funnel

How the PostHog "CLI activation" dashboard defines activation from the events in
`0001-event-catalog.md`. Everything is aggregated per installation (`distinct_id`
is `install_id`), so one developer on two machines counts twice.

## Steps

| Step | TypeScript CLI | Python CLI |
|------|----------------|------------|
| 1. Setup completed | `cli_command_completed`, `command = init`, `outcome = success` | `python_cli_command_completed`, `command = init`, `outcome = success` |
| 2. First value | `cli_command_completed` for any `generate*` command with `outcome = success`, **or** `cli_session_started` (dev, or MCP with `mode != self_test`) | `python_cli_command_completed`, `command in (dev, mcp)`, `outcome != failure`, and `flags_used` contains neither `--print-config` nor `--self-test` |
| 3. Deployed | `cli_command_completed`, `command in (deploy, deployment:release)`, `outcome = success` | not yet instrumented |

Conversion window: 14 days, ordered.

First value means actually serving queries or agents. MCP self-tests and
`--print-config` finish successfully without starting a session, so they count
as setup checks, not activation.

Each step uses a different event or command. PostHog needs a separate event
for each funnel step, so an "init started → init completed" funnel would count
a single successful `init` as a drop-off. Where setup stops is charted
separately instead, as unique installs by `stage_reached` and by
`connection_result`.

**Weekly activated installs** is the headline number: unique installs per
week that reached step 2 in either CLI.

## Filters applied everywhere

- `cli_version` does not contain `canary`. Every push to `main` publishes a
  canary, and each one is picked up within hours by registry scanners. They run
  bare `hypequery` or an unknown command once from a fresh install, then never
  come back.
- `is_ci != true`. CI usage means a team has adopted hypequery, not that a new
  user has activated. Chart it separately.
- Test accounts are filtered out. That uses the project's internal-users
  cohort, which matches persons with `$internal_or_test_user = true`. Mark
  maintainers' install IDs with that property to drop them.

## Known noise

- Stable releases attract the same scanner pattern as canaries: a fresh
  install that runs bare `hypequery` or an unknown command, non-interactive
  and once. Starting the funnel at "setup completed" leaves them out
  naturally. The "First command at a terminal" chart adds `is_tty = true` for
  the same reason.
- On 2026-11-05 the Python test suite sent about 150 `mcp` events. One test
  started the MCP server with a replacement environment that had no opt-out.
  It now sets `DO_NOT_TRACK=1`. The headline chart leaves out first-run Python
  `mcp` events so that week's figure stays usable.
- Bare `hypequery` currently prints help and exits with status 1, which is
  recorded as `help` / `failure` / `validation_failed` with `help_topic = root`.
  That's the most common first command, so it's the most visible early
  drop-off.
