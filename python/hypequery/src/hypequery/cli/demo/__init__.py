"""`hypequery demo`: a sample semantic layer on embedded ClickHouse, served over MCP.

The model (`model.py`) and seed data (`seed.sql`, package data) show the
ClickHouse reads a naive semantic layer gets wrong: ReplacingMergeTree
versions, AggregatingMergeTree states, exact versus estimated distinct counts,
window and shift measures, and tenant scoping. Everything runs locally from
the installed package, with no network access.
"""
