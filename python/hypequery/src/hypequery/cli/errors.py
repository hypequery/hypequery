"""Expected, safe-to-display errors from local CLI commands."""


class CliError(Exception):
    """An actionable local command failure, without a traceback."""
