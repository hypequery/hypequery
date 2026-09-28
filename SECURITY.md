# Security policy

## Reporting a vulnerability

Email **security@hypequery.com**.

Please don't report security vulnerabilities through public GitHub issues,
discussions, or pull requests.

Include what you can:

- the affected package and version, or the hypequery Cloud URL or feature;
- a description of the issue and its impact;
- steps to reproduce, or a proof of concept;
- any known mitigations.

## What to expect

| Step | Timeframe |
| --- | --- |
| We acknowledge your report | Within **3 business days** |
| We confirm the issue and its severity, or explain why we don't consider it a vulnerability | Within **7 days** |
| We fix **critical** vulnerabilities | Within **30 days** of confirming them |

Other confirmed vulnerabilities are fixed according to their severity. We'll
tell you when a fix ships, and we'll credit you in the advisory unless you'd
prefer not to be named.

## Scope

- The packages published from this repository (`@hypequery/*` on npm and the
  Python packages), in their latest released versions.
- **hypequery Cloud**, the hosted service at `hypequery.com`, including its
  API gateway, hosted MCP endpoints, and CLI deployment flow.
- This website.

Out of scope: vulnerabilities in third-party services or dependencies that we
don't control (report those upstream; we'll still want to hear about ones that
affect hypequery); denial-of-service by volume; social engineering; and physical
attacks.

## Good-faith research

We won't pursue or support legal action against you for research that follows
this policy. That means you:

- report the vulnerability to us first, and give us reasonable time to fix it
  before any public disclosure;
- test only against accounts, organisations, and data you own or have
  permission to use;
- don't access, modify, or delete other customers' data, and stop and tell us
  if you encounter any;
- don't degrade the service for other users.
