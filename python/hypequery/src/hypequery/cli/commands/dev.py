"""Start the existing local runner, loading optional dependencies on demand."""

from __future__ import annotations

import argparse
from importlib.util import find_spec
from typing import cast

from ..errors import CliError


def run(args: object) -> None:
    options = cast(argparse.Namespace, args)
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
        if find_spec("clickhouse_connect") is None:
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
            "Invalid app configuration or bind address; check environment and --host."
        ) from exc
    except (ImportError, KeyError, TypeError, RuntimeError, SyntaxError) as exc:
        # User app errors may contain connection URLs or secrets: do not echo them.
        raise CliError(
            "App could not start; check its code, dependencies and environment."
        ) from exc
    except OSError as exc:
        raise CliError(
            "Cannot start the server; check the bind address and whether the port is free."
        ) from exc
