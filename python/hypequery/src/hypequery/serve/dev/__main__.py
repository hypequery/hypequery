"""``python -m hypequery.serve.dev module:app [--host] [--port] [--reload]``."""

from __future__ import annotations

import argparse
from collections.abc import Sequence

from . import run_dev


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="python -m hypequery.serve.dev",
        description="Serve a hypequery app for local development.",
    )
    parser.add_argument("app", help="import string for the app, such as app:app")
    parser.add_argument("--host", default="127.0.0.1", help="bind address (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="port (default 8000)")
    parser.add_argument("--reload", action="store_true", help="restart when files change")
    args = parser.parse_args(argv)
    run_dev(args.app, host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
