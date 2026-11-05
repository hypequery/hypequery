"""Classify raw argv into catalog values. Raw input never leaves this module."""

from __future__ import annotations

from collections.abc import Sequence
from difflib import get_close_matches

from .catalog import contract

#: First positional → telemetry command. Each group has a single target today.
_TOP_LEVEL = {
    "init": "init",
    "dev": "dev",
    "generate": "generate:datasets",
    "generate:datasets": "generate:datasets",
    "export": "export:client-contract",
    "skill": "skill",
    "help": "help",
    "telemetry": "telemetry",
}
_ALIASES = {
    "-h": "--help",
    "-V": "--version",
    "-p": "--port",
    "--host": "--hostname",
    "--no-reload": "--no-watch",
}
_VALUE_FLAGS = {
    "--path",
    "--tables",
    "--exclude-tables",
    "--framework",
    "--tenant-column",
    "--output",
    "--factory",
    "--hostname",
    "--port",
    "--agent",
    "--scope",
}


def _tokens(argv: Sequence[str]) -> list[tuple[str, bool]]:
    """``(canonical option, True)`` or ``(positional, False)`` in order.

    Option values are skipped, never returned, and parsing stops at ``--``.
    """

    tokens: list[tuple[str, bool]] = []
    skip = False
    for arg in argv:
        if skip:
            skip = False
            continue
        if arg == "--":
            break
        if arg.startswith("-"):
            name = arg.split("=", 1)[0]
            name = _ALIASES.get(name, name)
            tokens.append((name, True))
            skip = name in _VALUE_FLAGS and "=" not in arg
        else:
            tokens.append((arg, False))
    return tokens


def _positionals(argv: Sequence[str]) -> list[str]:
    return [item for item, is_option in _tokens(argv) if not is_option]


def _root_exit(argv: Sequence[str]) -> str | None:
    """``--help``/``--version`` before any command: argparse exits from the root parser."""

    for item, is_option in _tokens(argv):
        if not is_option:
            return None
        if item == "--help":
            return "help"
        if item == "--version":
            return "version"
    return None


def requested_command(argv: Sequence[str]) -> str:
    """The catalog command argv asks for: ``unknown`` for anything unregistered."""

    root = _root_exit(argv)
    if root:
        return root
    positionals = _positionals(argv)
    if not positionals:
        return "help"
    command = _TOP_LEVEL.get(positionals[0], "unknown")
    options = {item for item, is_option in _tokens(argv) if is_option}
    if command not in ("unknown", "telemetry") and "--help" in options:
        return "help"  # `hypequery dev --help` is help about dev, as in the TypeScript CLI.
    return command


_HELP_TOPICS = ("init", "dev", "generate:datasets", "export:client-contract", "skill", "telemetry")


def help_topic(argv: Sequence[str]) -> str:
    if _root_exit(argv):
        return "root"
    positionals = _positionals(argv)
    topic = positionals[1] if positionals[:1] == ["help"] and len(positionals) > 1 else None
    if topic is None and positionals and positionals[0] != "help":
        topic = positionals[0]  # `hypequery dev --help`
    command = _TOP_LEVEL.get(topic or "")
    return command if command in _HELP_TOPICS else "root"


def suggested_command(argv: Sequence[str]) -> str | None:
    """The closest registered command to a typo, never the typo itself."""

    positionals = _positionals(argv)
    if not positionals:
        return None
    match = get_close_matches(positionals[0], list(_TOP_LEVEL), n=1, cutoff=0.6)
    return _TOP_LEVEL[match[0]] if match else None


def flags_used(command: str, argv: Sequence[str]) -> list[str]:
    """Canonical documented flag names only; values are skipped, never read."""

    allowed = {*contract()["COMMAND_FLAGS"].get(command, []), *contract()["GLOBAL_FLAGS"]}
    return sorted({item for item, is_option in _tokens(argv) if is_option and item in allowed})


def has_unknown_option(command: str, argv: Sequence[str]) -> bool:
    allowed = {*contract()["COMMAND_FLAGS"].get(command, []), *contract()["GLOBAL_FLAGS"]}
    return any(is_option and item not in allowed for item, is_option in _tokens(argv))
