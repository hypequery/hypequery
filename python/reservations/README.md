# PyPI name reservations (PYA-00)

These five metadata-only distributions exist to hold the Hypequery names on
PyPI while the real Python SDK is built. They ship **no modules** — installing
one gives you nothing but metadata pointing at the project.

| Distribution | Fate |
|---|---|
| `hypequery` | Becomes the real SDK at `0.1.0`. |
| `hypequery-datasets` | Stays a reservation; real code is `hypequery.datasets`. |
| `hypequery-serve` | Stays a reservation; real code is `hypequery.serve`. |
| `hypequery-clickhouse` | Stays a reservation; real code is the `[clickhouse]` extra. |
| `hypequery-fastapi` | Stays a reservation; real code is the `[fastapi]` extra. |

## Why reserve at all

Two reasons, both from `PYTHON_SECURITY_HARDENING_ROADMAP.md`:

1. **Dependency confusion.** Once docs, CI, or examples reference a name, an
   attacker who owns it on PyPI can serve code to anyone who typos or
   misconfigures an index. Owning the names used in documentation is an
   explicit requirement of the Python publishing policy.
2. **Name availability.** All five were unregistered as of 30 July 2026. That
   is not guaranteed to hold after any public announcement.

PyPI has no reserve-without-publishing mechanism, so a name is claimed only by
uploading a release. These placeholders are the minimum honest way to do that:
version `0.0.1.dev0` (pre-release, so `pip install hypequery` will not resolve
to it), `Development Status :: 1 - Planning`, and a README that states plainly
that there is no code yet. Honest planning-stage placeholders tied to an active
project are within PyPI policy; empty squatting is not.

## Publishing

One-time bootstrap only. First upload of a brand-new project name cannot use a
project-scoped token (the project does not exist yet), so it needs an
account-scoped token. **Delete that token afterwards.**

```bash
python3 -m venv /tmp/hq-publish && /tmp/hq-publish/bin/pip install -q build twine
```

Build and check all five:

```bash
cd python/reservations && for p in hypequery hypequery-datasets hypequery-serve hypequery-clickhouse hypequery-fastapi; do /tmp/hq-publish/bin/python -m build --outdir "dist/$p" "$p" && /tmp/hq-publish/bin/twine check "dist/$p"/*; done
```

Upload (prompts for credentials; use `__token__` as the username):

```bash
/tmp/hq-publish/bin/twine upload python/reservations/dist/*/*
```

From PYE-04 onward, releases use PyPI Trusted Publishing (GitHub OIDC) and no
long-lived token exists at all. This bootstrap is the only manual upload.

## Note on normalization

PyPI normalizes names, so `hypequery-serve`, `hypequery_serve`, and
`Hypequery.Serve` are all the same project. Registering the hyphenated form
covers the variants.

## Note on the per-package `.gitignore`

Each package directory contains a small `.gitignore`. Do not delete it.

Hatchling always bundles the nearest `.gitignore` into the sdist and provides
no way to suppress it — neither `exclude` nor `ignore-vcs` removes it. In a
monorepo it therefore walks up and ships the **repository root** `.gitignore`
inside every published archive. The root file holds no secrets, so this was a
tidiness problem rather than a disclosure one, but it demonstrated the build
backend reaching outside the package directory, which is worth containing
before real packages exist.

The per-package file shadows it, so the archive ships only that note. Verified
30 July 2026: all five sdists contain no monorepo content.

When PYE-04 adds artifact content verification, expect exactly these sdist
entries — `.gitignore`, `README.md`, `pyproject.toml`, `PKG-INFO` — and wheels
containing only `dist-info/`.
