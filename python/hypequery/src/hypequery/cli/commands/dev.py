"""Start the existing local runner, loading optional dependencies on demand."""

from __future__ import annotations

from importlib.util import find_spec

from ..errors import CliError
from ..options import DevOptions


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
        if str(exc) == "this app was created with a ProductionProfile; run it with run_production":
            raise CliError(
                "This app uses a ProductionProfile; use run_production instead of dev."
            ) from exc
        raise CliError(
            "Invalid app configuration or bind address; check environment and --hostname."
        ) from exc
    except OSError as exc:
        raise CliError(
            "Cannot start the server; check the bind address and whether the port is free."
        ) from exc
    except Exception as exc:
        # User app and driver errors may contain URLs, SQL or credentials.
        raise CliError(
            "App could not start; check its code, dependencies and environment."
        ) from exc
