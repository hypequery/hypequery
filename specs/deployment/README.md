# Hypequery deployment transport

This directory defines authenticated transport and control-plane handoff
contracts that consume immutable artifacts from the security protocol.

Unlike `specs/security-protocol`, these specifications may describe HTTP,
authentication, authorization, idempotent persistence, and service responses.
They must not weaken or replace the validation, identity, or closed-content
requirements of the referenced immutable artifacts.
