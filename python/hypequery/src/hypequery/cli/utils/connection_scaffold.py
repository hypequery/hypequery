"""Connection settings for a scaffold, matching how discovery connected.

A project discovered through ``CLICKHOUSE_URL`` documents ``CLICKHOUSE_URL``; one
discovered through the field variables documents those, with the host, port and
TLS setting that worked. Credentials never enter generated files: the URL and the
variables carry placeholders for the user and password.
"""

from __future__ import annotations

from ..generators.schema import ConnectionSummary

_FIELD_LINES = (
    "CLICKHOUSE_HOST=localhost",
    "CLICKHOUSE_PORT=8123",
    "CLICKHOUSE_SECURE=false",
    "CLICKHOUSE_DATABASE=default",
    "CLICKHOUSE_USERNAME=default",
    "CLICKHOUSE_PASSWORD=",
)


def _url(summary: ConnectionSummary, database: str) -> str:
    host = f"[{summary.host}]" if ":" in summary.host else summary.host
    port = f":{summary.port}" if summary.port is not None else ""
    scheme = "clickhouses" if summary.secure else "clickhouse"
    return f"{scheme}://USERNAME:PASSWORD@{host}{port}/{database}"


def env_lines(summary: ConnectionSummary | None, database: str) -> list[str]:
    """The connection lines of ``.env.example``."""

    if summary is not None and summary.from_url:
        return [
            "# Discovery used CLICKHOUSE_URL; set it instead of CLICKHOUSE_HOST, _PORT, ...",
            f"CLICKHOUSE_URL={_url(summary, database)}",
        ]
    secure = summary is not None and summary.secure
    port = summary.port if summary is not None and summary.port else (8443 if secure else 8123)
    return [
        f"CLICKHOUSE_HOST={summary.host if summary is not None else 'localhost'}",
        f"CLICKHOUSE_PORT={port}",
        f"CLICKHOUSE_SECURE={'true' if secure else 'false'}",
        f"CLICKHOUSE_DATABASE={database}",
        "CLICKHOUSE_USERNAME=default",
        "CLICKHOUSE_PASSWORD=",
    ]


def export_lines(summary: ConnectionSummary | None, database: str) -> list[str]:
    """The README's ``export`` lines for the same settings."""

    if summary is not None and summary.from_url:
        return [f"export CLICKHOUSE_URL='{_url(summary, database)}'"]
    skipped = ("CLICKHOUSE_PASSWORD", "CLICKHOUSE_SECURE=false")
    lines = [line for line in env_lines(summary, database) if not line.startswith(skipped)]
    return [f"export {line}" for line in lines] + [
        "export CLICKHOUSE_PASSWORD='your-local-password'"
    ]


def replace_env_block(template: str, summary: ConnectionSummary | None, database: str) -> str:
    """*template* (.env.example) with its connection block replaced."""

    block = "\n".join(_FIELD_LINES)
    if block not in template:
        raise ValueError(".env.example template no longer has the expected connection block")
    return template.replace(block, "\n".join(env_lines(summary, database)))
