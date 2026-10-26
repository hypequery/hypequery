# Python releases

The only functional Python distribution is `hypequery`. It includes the
`hypequery` CLI, datasets, protocol, execution, and serving modules. FastAPI and
ClickHouse dependencies are extras. The other owned PyPI names are not published
by this workflow. Python versions and changelog fragments are independent of npm
Changesets and npm's `canary` dist-tag.

## Channels

| Channel | Trigger | Version example | Destination |
| --- | --- | --- | --- |
| Canary | Successful Python CI for a push to `main`, with canaries enabled | `0.1.0.dev42001` | PyPI, prerelease |
| Beta | Push `python-v0.1.0b1` matching committed package version | `0.1.0b1` | PyPI, prerelease |
| Release candidate | Push `python-v0.1.0rc1` | `0.1.0rc1` | PyPI, prerelease |
| Stable | Push `python-v0.1.0` | `0.1.0` | PyPI, stable |
| Rehearsal | Manually run **Python release** on `main` | Canary version | GitHub artifacts only |

Canaries run only when the path-filtered **Python** workflow runs for relevant
changes; unrelated main pushes do not publish Python packages. Failed CI and PR
runs never publish. The workflow uses the exact commit that passed CI, not the
latest moving `main`. Canary uploads are disabled until repository variable
`PYTHON_CANARY_ENABLED` is set to `true`.

Canary versions retain the committed release base and append `.devN`, where
`N = release-workflow run number * 1000 + attempt`. For example, a checkout at
`0.1.0b2` produces `0.1.0b2.dev42001`. A retry gets a new canary version;
there is no local `+sha` version component. The Actions summary records the
source SHA, version, and install command.

PyPI has no npm-style mutable channel tags. A development version sorts before
its corresponding beta/stable version. Pin the exact canary from the Actions
summary; `--pre` alone does not guarantee selection of a canary. Keep the
committed version aimed at the next beta or stable release as development moves
forward. Once a stable SDK exists, normal pip upgrades exclude prereleases;
before that, pip may select a prerelease when no stable version satisfies the
requirement. The `0.0.1.dev0` placeholder already on PyPI is itself a
development release, so `pip install hypequery` resolves to the newest
prerelease once the beta is published and never prefers the placeholder.

```bash
# Beta: select the tested release, including the CLI and integration extras.
pip install "hypequery[fastapi,clickhouse]==0.1.0b1"

# Canary: copy the actual version from the workflow summary.
pip install "hypequery[fastapi,clickhouse]==0.1.0.dev42001"

# Stable after the first functional stable release.
pip install --upgrade "hypequery[fastapi,clickhouse]"
```

## Integrated client qualification

The reusable Python workflow includes the installed Python/React/MCP gate at its
selected source SHA. It runs a deliberate Python 3.11/ClickHouse 25.8/React 18 and
Python 3.14/ClickHouse 26.3/React 19 subset, including browser queries and MCP
cancellation reaching the database. Tagged releases and rehearsals invoke this
same graph; enabled canaries require its successful main-commit run. Node package
stable/canary publishing also waits for this client gate.

Retain the `python-clients-*` qualification reports, artifact checksums and
failure diagnostics with the release evidence. See the
[gate specification](../../testing/python-client-release-gate.md) for local runs,
fault checks and remaining beta requirements. Development artifact checks do not
replace exact published-version qualification. GitHub required-check settings
must be configured separately; no test job receives publish credentials.

## One-time setup

After merging the workflows into `main`:

1. In `hypequery/hypequery` GitHub settings, create environments `pypi` and
   `pypi-canary`. Restrict `pypi` to tags matching `python-v*`; add required
   reviewers if you want approval before beta/stable uploads. Allow `main` for
   `pypi-canary`. These controls are configured in GitHub, not in YAML.
2. In the existing [hypequery PyPI project's publishing settings](https://pypi.org/manage/project/hypequery/settings/publishing/),
   add two GitHub Trusted Publishers:

   | Field | Tagged releases | Canaries |
   | --- | --- | --- |
   | Owner | `hypequery` | `hypequery` |
   | Repository | `hypequery` | `hypequery` |
   | Workflow filename | `python-release.yml` | `python-release.yml` |
   | Environment | `pypi` | `pypi-canary` |

   The filename is just the basename, without `.github/workflows/`. Both
   publishers authorize the same `hypequery` PyPI project. No `PYPI_TOKEN`
   GitHub secret is needed. Publishing uses job-scoped OIDC and PyPI attestations.
3. Run **Actions → Python release → Run workflow** on `main`. This runs the
   full Python CI suite, builds both distributions, checks metadata and archive
   contents, and verifies an installed CLI from each artifact. It uploads only
   the `python-dist` GitHub artifact; it never publishes to PyPI.
4. Once ready for automatic development uploads, create the GitHub Actions
   repository variable `PYTHON_CANARY_ENABLED` with value `true`. The next
   relevant successful main CI run will publish a canary. Set it to `false`
   or remove it to stop future canary runs.

See [PyPI Trusted Publishing](https://docs.pypi.org/trusted-publishers/using-a-publisher/)
and [Python version ordering](https://packaging.python.org/en/latest/specifications/version-specifiers/).

## Prepare a beta or stable release PR

Run **Actions → Prepare Python release → Run workflow** on `main`, entering
an explicit target version such as `0.1.0b1`, `0.1.0b2`, `0.1.0rc1`, or `0.1.0`.
There is no inference from commit messages: the maintainer chooses the next
version. The target must be newer than the committed version and must not
already have a changelog section. Development, local, and post-release targets
are rejected.

The workflow checks out the latest `main` and creates or refreshes one PR on
`codex/python-release`. It:

- Sets `pyproject.toml` and updates `uv.lock` with `uv version`.
- Renders all pending Markdown fragments through Towncrier into a dated
  `CHANGELOG.md` section, preserving previous releases and the Unreleased header.
- Removes only the included fragment files; keeps the fragment README and template.
- Runs the full reusable Python CI suite against the generated PR commit.

Rerun the workflow to include changes that merged after the PR was created.
Rerunning refreshes the PR from current `main`, so make persistent release edits
on `main` before refreshing; the bot may replace manual edits to its release
branch. Review the release notes and pending CI before merging. Also review the
README release-status text and development classifier for the actual maturity;
those editorial decisions are not made by the script.

The repository must allow GitHub Actions to create pull requests under
**Settings → Actions → General → Workflow permissions**. The default workflow
uses `GITHUB_TOKEN`. GitHub suppresses new `push`/`pull_request` workflow runs
for that token, so this workflow explicitly invokes Python CI on the PR commit.
Those results appear under **Prepare Python release**, and may not satisfy
branch protection rules requiring the normal PR checks.

For normal PR-triggered checks, configure the optional repository secret
`PYTHON_RELEASE_PR_TOKEN` with a bot's fine-grained PAT (repository Contents and
Pull requests read/write). This token is for creating the PR, not for publishing
to PyPI. Alternatively, after the bot opens a PR with the default token, close
and reopen it as a human to trigger normal PR CI. Follow the existing required
checks before merging. The publishing workflows still use PyPI Trusted Publishing.

Local preparation on a release branch uses the same script:

```bash
cd python/hypequery
uv sync --frozen --dev
uv run --no-sync python scripts/prepare_release_pr.py --version 0.1.0b1
```

This changes local files. Review, commit and open a PR as usual. Use `--date
YYYY-MM-DD` for a reproducible release-note date; the default is the UTC run date.
Preparation restores the version, lockfile, changelog and fragments if a mutation
fails. It never commits, pushes, tags, or publishes when run locally.

## Publish the reviewed release

After the release PR has merged, create and push the matching tag from its
actual merged commit:

```bash
git fetch origin main
git tag -a python-v0.1.0b1 <merged-commit-sha> -m "Python 0.1.0b1"
git push origin refs/tags/python-v0.1.0b1
```

Replace the version and `<merged-commit-sha>` with the reviewed release. Merging
a release PR does not publish beta/stable: the tag is the explicit publishing
trigger. If canaries are enabled, the main merge may publish a development build.

The release workflow reruns the full Python suite (3.11–3.14, live ClickHouse,
installed CLI journeys, and shared conformance), requires the tag commit to
be an ancestor of `origin/main`, checks tag/version agreement, and builds
and verifies the distributions before the isolated publishing job.
Confirm the workflow and PyPI release, then smoke-test its exact version in a
fresh environment. GitHub Releases remain manual; the preparation workflow
handles package metadata and changelog, not GitHub Releases or publishing tags.

The workflow publishes only the wheel and sdist built in that run. It checks
both metadata versions, the package name, and CLI registration and refuses
extra/stale distributions. It uses no `skip-existing`: duplicate tagged uploads
fail visibly. If a tagged publish fails, inspect PyPI before retrying. PyPI
versions and uploaded filenames cannot be overwritten; if an upload was partial,
complete the missing artifact deliberately or publish a corrected new version.
Yank a bad release rather than deleting and reusing its version.

## Dependency and release evidence

Python CI audits runtime dependencies, including all optional extras, on Python
3.11–3.14. Both the committed lock and the declared direct dependency floors
must pass pip-audit against the current PyPI advisory database. Each Python's
floor job then installs that audited lowest-direct resolution with
`--only-binary :all:` and runs the full suite against it, so a floor with no
wheel for that Python, or one that fails the suite there, fails CI. The floor
Serve job installs the same lowest-direct resolution before its regression
suite. Unknown scanner failures fail CI; no advisories are suppressed.

Measure a new floor on every supported Python, not just the oldest: resolve
with `uv pip compile pyproject.toml --all-extras --resolution lowest-direct
--python <version>`, install the result with `--only-binary :all:`, and run
the suite. When one Python needs a higher floor, split the requirement with a
`python_version` marker rather than raising it everywhere.

The release build repeats the locked runtime audit and retains a separate
`python-supply-chain` artifact containing a CycloneDX 1.5 SBOM, hashed runtime
requirements, the audit report, and SHA-256 checksums of the wheel and sdist.
The SBOM covers the lock's runtime dependency graph, including platform
conditions and extras; it is not a claim that every dependency is installed in
every consumer environment. Publishing remains blocked if the release audit
fails. PyPI's publishing action creates attestations for both distributions.

## 0.1.0b1 release checklist

The b1 release notes were prepared by hand, not by **Prepare Python release**:
the `0.1.0b1` section already existed from the earlier candidate, so the workflow
refuses that target. Later betas use the workflow as normal.

npm published the matching client packages first (Changesets release, #703). These
are the versions the Python journey is qualified against:

| Package | Published version |
| --- | --- |
| `@hypequery/protocol` | `0.21.0` |
| `@hypequery/datasets` | `0.24.0` |
| `@hypequery/protocol-conformance` | `0.16.0` |
| `@hypequery/react` | `0.7.0` |
| `@hypequery/mcp` | `0.10.0` |
| `@hypequery/cli` | `1.25.0` |
| `@hypequery/deployment` | `0.10.0` |
| `@hypequery/serve` | `0.22.0` |
| `@hypequery/clickhouse` | `2.14.0` |

Before pushing the tag:

1. **PyPI bindings (maintainer check).** On the `hypequery` project's
   [publishing settings](https://pypi.org/manage/project/hypequery/settings/publishing/),
   confirm both Trusted Publishers from [One-time setup](#one-time-setup) exist
   with workflow `python-release.yml` and environments `pypi` and `pypi-canary`.
   They cannot be inferred from YAML. In GitHub, confirm `pypi` only allows
   `python-v*` tags; adding a required reviewer is optional. Keep
   `PYTHON_CANARY_ENABLED` unset until an intentional canary upload is approved.
2. **Rehearsal at the release commit.** After the release-notes PR merges, run
   **Actions → Python release → Run workflow** on `main`. It must run at the
   exact commit you will tag; a green run for an earlier commit does not qualify
   a later one. Keep the `python-dist`, `python-supply-chain` and both
   `python-clients-*` artifacts, and check their recorded source SHA. A
   rehearsal never publishes and does not exercise OIDC.
3. **Consumer journey from registry pins.** In a fresh directory outside the
   checkout, install the rehearsal wheel with `fastapi,clickhouse` and the npm
   packages above by **registry version**, not tarballs. Run offline export,
   `generate:client`, `--check`, a strict frontend build, the browser bundle
   audit, the two-user browser journey and the MCP journey against an isolated
   database.
4. **Owners.** Record the release owner, the beta feedback channel and the
   rollback owner (who yanks, and when).
5. **Tag** the rehearsed commit, as in
   [Publish the reviewed release](#publish-the-reviewed-release), and approve the
   `pypi` deployment if a reviewer is required.

After publication, repeat step 3 with `hypequery[fastapi,clickhouse]==0.1.0b1`
from **PyPI**. Also check that `pip install hypequery` with no pin resolves to
`0.1.0b1` rather than the `0.0.1.dev0` placeholder, and compare PyPI's file
hashes and attestations with the `python-supply-chain` checksums. Keep the source
SHA, workflow URLs, versions, generated hashes, consumer lockfiles and
browser/MCP results together. Announce only once this registry-installed run
passes. If an upload is bad, yank it and publish a new version; never reuse one.

Beta scope is Python 3.11–3.14; the full cross-client compatibility subset is
Python 3.11/ClickHouse 25.8/React 18 and Python 3.14/ClickHouse 26.3/React 19 with
Chromium. Firefox/WebKit, every Cartesian version combination and a separately
configured third-party MCP application are not qualified by the SDK stdio tests.
Local chained derived measures cannot be exported under deployment contract 2;
relationship measures traverse one hop and base measures only. HAVING bypasses
the result cache. The related-null planner correction in this stack is Python;
it does not establish the same behavior for the native TypeScript planner.
