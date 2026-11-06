"""Pseudonymous, opt-out CLI usage telemetry; see https://hypequery.com/docs/telemetry.

Standard library only, so it adds nothing to ``hypequery --help`` imports.
"""

from .init_funnel import InitFunnel
from .lifecycle import (
    CommandTelemetry,
    activate,
    cancel_command_telemetry,
    update_command_telemetry,
)

__all__ = [
    "CommandTelemetry",
    "InitFunnel",
    "activate",
    "cancel_command_telemetry",
    "update_command_telemetry",
]
