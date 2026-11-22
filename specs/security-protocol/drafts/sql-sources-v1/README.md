# Proposed SQL-source contracts

Owned by Proposed RFC 0028. These cases are draft review evidence, not accepted
conformance fixtures. Don't register this directory in the conformance manifest
until the RFC is accepted.

`contracts.json` holds deployment contracts (version 2) that must validate
(`accepted`) and ones that must fail with the given `code` at `path`
(`rejected`), one per SQL rule plus the shape and reference checks. The
accepted activity stream is the `UNION ALL` over signups, events,
subscriptions (read with `FINAL`) and invoices from the RFC's summary.

`packages/protocol/src/deployments/sql-source.test.ts` runs every case.
