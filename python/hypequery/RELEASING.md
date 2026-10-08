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
requirement. An existing stable placeholder may continue to be selected until
users explicitly request the SDK beta.

```bash
# Beta: select the tested release, including the CLI and integration extras.
pip install "hypequery[fastapi,clickhouse]==0.1.0b1"

# Canary: copy the actual version from the workflow summary.
pip install "hypequery[fastapi,clickhouse]==0.1.0.dev42001"

# Stable after the first functional stable release.
pip install --upgrade "hypequery[fastapi,clickhouse]"
```

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
