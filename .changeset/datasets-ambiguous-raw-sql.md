---
"@hypequery/datasets": patch
---

Engines can now refuse a raw `sql` expression whose literal boundaries they can't place unambiguously, with an error naming the field and the forms to avoid. Postgres uses this for `$` outside quoted literals and for version-dependent `E'…'` strings. ClickHouse behaviour is unchanged.
