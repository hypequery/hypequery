"""Compiler features: one concern each, sharing one compiler's per-query state.

Mirrors `@hypequery/clickhouse`'s query-builder features. Each feature holds the
compiler it serves and reaches the others through it, so the order in which
they allocate parameters is the order the compiler calls them in.
"""
