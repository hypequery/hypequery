# Security Best Practices Report

## Executive summary

The review confirmed one high-severity application flaw and eight dependency vulnerability groups. Credentialed CORS could reflect any requesting origin when no allowlist was configured, allowing an arbitrary website to read authenticated cross-origin responses. The dependency findings covered 11 open Dependabot alerts plus newer registry advisories in the pnpm workspace and documentation app.

All confirmed findings are remediated in this change. `pnpm audit --audit-level=low` and `npm audit --audit-level=low --prefix website-next` now report zero known vulnerabilities. The complete monorepo test suite, monorepo build, serve lint, and documentation production build pass.

## High severity

### SEC-001: Credentialed CORS reflected arbitrary origins

- Rule ID: NEXT-CORS-001 / FASTAPI-CORS-001 (framework-independent CORS requirement)
- Severity: High
- Location: `packages/serve/src/cors.ts`, `resolveCorsConfig` and `matchOrigin`; remediation guard at lines 23-28
- Evidence: Before remediation, an omitted origin defaulted to `"*"`, while `matchOrigin` returned `requestOrigin` whenever credentials were enabled. As a result, `{ credentials: true }` emitted both `Access-Control-Allow-Origin: <attacker origin>` and `Access-Control-Allow-Credentials: true`.
- Impact: A malicious site could make credentialed browser requests to a consumer's Hypequery API and read the response when cookies or other ambient browser credentials were in use.
- Fix: Reject credentialed CORS when `origin` is omitted or `"*"`; require an explicit string, array, or validation function. Regression coverage is in `packages/serve/src/cors.test.ts`.
- Mitigation: Consumers should use the narrowest possible origin allowlist and avoid credentialed CORS when same-origin requests are sufficient.
- False positive notes: Exploitation requires a consumer to enable CORS credentials and use browser-managed credentials. The insecure configuration was nevertheless a supported default path and therefore required a fail-closed fix.

### SEC-002: URL and IP parser trust-boundary bypasses

- Rule ID: NEXT-SSRF-001
- Severity: High
- Location: root overrides at `package.json:59` and `package.json:63`; docs overrides at `website-next/package.json:60`
- Evidence: `fast-uri` 3.1.4 was affected by GHSA-7p8r-x3mc-p8w7; `ip-address` 10.2.0 was affected by GHSA-mwp4-54f8-5fhr, GHSA-4xrf-jv44-h6hh, and GHSA-22jq-vg5j-6vgg.
- Impact: Applications relying on affected parser results for URL or special-address policy checks could misclassify attacker-controlled destinations and bypass SSRF or other network trust boundaries.
- Fix: Resolve `fast-uri` to 3.1.5 and `ip-address` to 10.4.0 in the relevant lockfiles.
- Mitigation: SSRF defenses should also resolve and validate the actual destination IP, restrict redirects, and enforce egress policy.
- False positive notes: The packages are transitive dependencies; exploitability depends on downstream use. Removing the vulnerable versions eliminates that uncertainty.

### SEC-003: Hono request-processing vulnerabilities

- Rule ID: NEXT-SUPPLY-001
- Severity: High (aggregate; individual advisories ranged from low to moderate)
- Location: `package.json:62`
- Evidence: Hono 4.12.27 was affected by request-header ReDoS, language-middleware algorithmic complexity, cross-request memoization disclosure, and proxy hop-by-hop header handling advisories.
- Impact: Affected paths could cause denial of service, cross-request data disclosure, or unsafe proxy response handling.
- Fix: Resolve Hono to 4.13.1.
- Mitigation: Keep request size and rate limits at the edge even with the patched dependency.
- False positive notes: Individual features may not be invoked by Hypequery, but Hono is in the MCP server's runtime dependency graph.

### SEC-004: YAML parser quadratic CPU consumption

- Rule ID: NEXT-INJECT-003 / NEXT-SUPPLY-001
- Severity: High
- Location: root overrides at `package.json:64-65`; docs overrides at `website-next/package.json:57-61`
- Evidence: `js-yaml` 3.15.0 and 4.3.0 were affected by GHSA-5p4m-2wfm-xmqj when resolving crafted `!!omap` values.
- Impact: Parsing attacker-controlled YAML could consume quadratic CPU and cause denial of service.
- Fix: Resolve the maintained major lines to 3.15.1 and 4.3.1.
- Mitigation: Apply input size limits before parsing untrusted structured data.
- False positive notes: The vulnerable packages were transitive build/tooling dependencies, but were present in both lockfiles.

### SEC-005: Infinite-loop denial of service in ID and image parsing dependencies

- Rule ID: REACT-SUPPLY-001
- Severity: High
- Location: `package.json:70`, `website-next/package.json:17-18`, and `website-next/package.json:63`
- Evidence: `nanoid` 3.3.16 was affected by GHSA-2v37-7h3g-55p8. Fumadocs 16.5.0 pulled `image-size` 2.0.2, affected by GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq.
- Impact: Crafted generator parameters or image inputs could trigger non-terminating work and deny service.
- Fix: Resolve Nano ID to 3.3.18 and update Fumadocs to 16.14.2, which removes the vulnerable `image-size` dependency from the lockfile.
- Mitigation: Bound user-controlled sizes and parsing work independently of library protections.
- False positive notes: Reachability depends on consumers passing attacker-controlled values to the affected parsers.

## Medium severity

### SEC-006: HTTP response and header injection flaws in Undici

- Rule ID: REACT-NET-001 / NEXT-SUPPLY-001
- Severity: Medium
- Location: `website-next/package.json:71`
- Evidence: Undici 6.27.0 was affected by GHSA-8xcm-r25x-g524, GHSA-m8rv-5g2x-5cg5, and GHSA-v3r7-h72x-cjcm.
- Impact: Affected APIs could permit response desynchronization, CRLF injection, or cookie attribute injection under advisory-specific attacker control.
- Fix: Resolve Undici to 6.28.0.
- Mitigation: Do not construct header or cookie values from untrusted strings without validation.
- False positive notes: Undici is transitive through Vercel tooling; affected runtime APIs may not all be used by this application.

### SEC-007: Archive parsing stack-exhaustion denial of service

- Rule ID: NEXT-SUPPLY-001
- Severity: Medium
- Location: `website-next/package.json:70`
- Evidence: `tar` 7.5.19 was affected by GHSA-r292-9mhp-454m when processing crafted long-path archives with member selection.
- Impact: A crafted archive could cause an uncatchable stack overflow and terminate the process.
- Fix: Resolve `tar` to 7.5.22.
- Mitigation: Treat untrusted archives as hostile and process them with size, path, and resource limits.
- False positive notes: The package is transitive through Vercel development tooling.

## Validation

- `pnpm audit --audit-level=low`: zero known vulnerabilities
- `npm audit --audit-level=low --prefix website-next`: zero known vulnerabilities
- `pnpm build`: 9/9 packages passed
- `pnpm test`: 18/18 Turbo tasks passed
- `pnpm --filter @hypequery/serve lint`: passed
- `BLOB_READ_WRITE_TOKEN=dummy npm run build` in `website-next`: passed

The website-wide lint task still reports unrelated pre-existing errors in `ThemeToggle.tsx`, several homepage components, and legacy test scripts; none are in files changed by this remediation.
