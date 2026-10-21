"""Start the existing local runner, loading optional dependencies on demand."""

from __future__ import annotations

from importlib.util import find_spec

from hypequery.datasets.planner import CompiledQueryError

from ..errors import CliError
from ..options import DevOptions

#: Startup failures the executor factory reports with a safe category. The
#: message names the environment variables to check and never the driver's text.
_CLICKHOUSE_HINTS = {
    "unauthenticated": (
        "ClickHouse rejected the credentials; check CLICKHOUSE_USERNAME and CLICKHOUSE_PASSWORD."
    ),
    "unavailable": (
        "ClickHouse is unreachable; check CLICKHOUSE_HOST, CLICKHOUSE_PORT and CLICKHOUSE_SECURE."
    ),
    "not-found": "ClickHouse database not found; check CLICKHOUSE_DATABASE.",
    "forbidden": "ClickHouse denied access; check the user's grants and readonly profile.",
}


def run(options: DevOptions) -> None:
    if any(find_spec(name) is None for name in ("fastapi", "uvicorn")):
        raise CliError(
            'dev requires serving dependencies. Install: pip install "hypequery[fastapi]"'
        )

    from uvicorn.importer import ImportFromStringError

    from hypequery.serve import run_dev

    try:
        run_dev(options.app, host=options.host, port=options.port, reload=options.reload)
    except ImportFromStringError as exc:
        raise CliError(
            "Cannot import the app; use a valid module:attribute in this directory."
        ) from exc
    except ModuleNotFoundError as exc:
        if exc.name is not None and exc.name.split(".")[0] == "clickhouse_connect":
            raise CliError(
                'Install the database driver: pip install "hypequery[clickhouse]"'
            ) from exc
        raise CliError(
            "App import failed; check its dependencies and environment variables."
        ) from exc
    except ValueError as exc:
        if str(exc) == "this app was created with a ProductionProfile; run it with start_server":
            raise CliError(
                "This app uses a ProductionProfile; use start_server instead of dev."
            ) from exc
        raise CliError(
            "Invalid app configuration or bind address; check environment and --hostname."
        ) from exc
    except OSError as exc:
        raise CliError(
            "Cannot start the server; check the bind address and whether the port is free."
        ) from exc
    except CompiledQueryError as exc:
        # The executor factory raises these while the app module connects; the
        # category is safe and tells a developer which setting to look at.
        hint = _CLICKHOUSE_HINTS.get(exc.category)
        if hint is None:
            hint = "ClickHouse refused the connection; check the CLICKHOUSE_* environment."
        raise CliError(f"App could not start. {hint}") from exc
    except Exception as exc:
        # User app and driver errors may contain URLs, SQL or credentials.
        raise CliError(
            "App could not start; check its code, dependencies and environment."
        ) from exc
