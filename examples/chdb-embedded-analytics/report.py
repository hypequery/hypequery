"""Print a report from the events dataset as JSON.

    uv run python report.py --by tenant.plan
    ANALYTICS_BACKEND=clickhouse uv run python report.py --by event_type   # same report, a server
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from typing import Any

from analytics.backend import backend_name, open_client, open_executor
from analytics.datasets import events

MEASURES = ("events", "unique_users", "p95_latency_ms", "error_rate")


def run_report(by: str, limit: int = 20) -> dict[str, Any]:
    with open_executor() as executor:
        result = open_client(executor).execute(
            events,
            {
                "dimensions": [by],
                "measures": list(MEASURES),
                "order_by": [{"field": "events", "direction": "desc"}],
                "limit": limit,
            },
        )
    return {"backend": backend_name(), "by": by, "data": list(result.data)}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--by", default="tenant.plan", help="a dimension, e.g. event_type, device, tenant.region")
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args(argv)
    json.dump(run_report(args.by, args.limit), sys.stdout, indent=2, default=str)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
