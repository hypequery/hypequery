"""Expected, safe-to-display errors from local CLI commands."""


class CliError(Exception):
    """An actionable local command failure, without a traceback."""


class DatabaseOpenError(CliError):
    """Discovery never reached the database: no driver, unusable connection settings, or a
    chDB database that is missing or locked. Errors from reading an open one are not this."""
