"""Start the existing local runner, loading optional dependencies on demand."""

from __future__ import annotations

from importlib.util import find_spec

from hypequery.datasets.planner import CompiledQueryError

from ..errors import CliError
from ..options import DevOptions
from ..utils.clickhouse_hints import clickhouse_hint
from ..utils.startup_errors import missing_environment_variable, quiet_driver_warnings


def run(options: DevOptions) -> None:
    if find_spec("uvicorn") is None:
        raise CliError('dev requires uvicorn. Install: pip install "hypequery[server]"')

    from uvicorn.importer import ImportFromStringError

    from hypequery.serve import run_dev

    quiet_driver_warnings()
    try:
        run_dev(options.app, host=options.host, port=options.port, reload=options.reload)
    except SystemExit as exc:
        # uvicorn exits 3 when the app or the socket fails to start; it has
        # already logged why. Keep the CLI's documented 0/1/2 exit codes.
        if exc.code in (None, 0):
            raise
        raise CliError(
            f"Cannot start the server; check the bind address and whether port {options.port} "
            "is free."
        ) from exc
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
        # code and category are safe and tell a developer which setting to check.
        raise CliError(f"App could not start. {clickhouse_hint(exc)}") from exc
    except KeyError as exc:
        name = missing_environment_variable(exc)
        if name is None:
            raise CliError(
                "App could not start; check its code, dependencies and environment."
            ) from exc
        raise CliError(f"App could not start: set the {name} environment variable.") from exc
    except Exception as exc:
        # User app and driver errors may contain URLs, SQL or credentials.
        raise CliError(
            "App could not start; check its code, dependencies and environment."
        ) from exc
