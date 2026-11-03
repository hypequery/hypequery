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
}


def _positionals(argv: Sequence[str]) -> list[str]:
    found, skip = [], False
    for arg in argv:
        if skip:
            skip = False
        elif arg == "--":
            break
        elif arg.startswith("-"):
            skip = _ALIASES.get(arg, arg) in _VALUE_FLAGS
        else:
            found.append(arg)
    return found


def requested_command(argv: Sequence[str]) -> str:
    """The catalog command argv asks for: ``unknown`` for anything unregistered."""

    positionals = _positionals(argv)
    options = argv[: argv.index("--")] if "--" in argv else argv
    if not positionals:
        return "version" if any(a in ("-V", "--version") for a in options) else "help"
    command = _TOP_LEVEL.get(positionals[0], "unknown")
    if command not in ("unknown", "telemetry") and any(a in ("-h", "--help") for a in options):
        return "help"  # `hypequery dev --help` is help about dev, as in the TypeScript CLI.
    return command


def help_topic(argv: Sequence[str]) -> str:
    positionals = _positionals(argv)
    topic = positionals[1] if positionals[:1] == ["help"] and len(positionals) > 1 else None
    if topic is None and positionals and positionals[0] != "help":
        topic = positionals[0]  # `hypequery dev --help`
    command = _TOP_LEVEL.get(topic or "", "root" if topic is None else "unknown")
    return (
        command
        if command in ("root", "init", "dev", "generate:datasets", "export:client-contract")
        else "root"
    )


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
    flags, skip = set(), False
    for arg in argv:
        if skip:
            skip = False
            continue
        if arg == "--":
            break
        if not arg.startswith("-"):
            continue
        name = _ALIASES.get(arg.split("=", 1)[0], arg.split("=", 1)[0])
        if name in allowed:
            flags.add(name)
        skip = name in _VALUE_FLAGS and "=" not in arg
    return sorted(flags)


def has_unknown_option(command: str, argv: Sequence[str]) -> bool:
    allowed = {*contract()["COMMAND_FLAGS"].get(command, []), *contract()["GLOBAL_FLAGS"]}
    return any(
        arg.startswith("-")
        and arg != "--"
        and _ALIASES.get(arg.split("=", 1)[0], arg.split("=", 1)[0]) not in allowed
        for arg in argv
    )
