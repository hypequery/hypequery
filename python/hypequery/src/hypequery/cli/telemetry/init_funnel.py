"""Where ``hypequery init`` stops: the furthest stage reached and how connecting went.

Mirrors the TypeScript CLI's ``InitFunnel``. Stages only move forward, so a run
that reaches them out of order (chDB settles the framework before reading the
database) still reports the furthest one.
"""

from __future__ import annotations

from typing import Final, Literal

from .lifecycle import update_command_telemetry

InitStage = Literal["started", "connection_tested", "framework_selected", "confirmed", "completed"]
INIT_STAGES: Final[tuple[InitStage, ...]] = (
    "started",
    "connection_tested",
    "framework_selected",
    "confirmed",
    "completed",
)


class InitFunnel:
    def __init__(self) -> None:
        self._reached: InitStage = "started"
        self._failed = False
        update_command_telemetry(stage_reached=self._reached)

    def reach(self, stage: InitStage) -> None:
        if INIT_STAGES.index(stage) > INIT_STAGES.index(self._reached):
            self._reached = stage
            update_command_telemetry(stage_reached=stage)

    def connected(self) -> None:
        update_command_telemetry(connection_result="ok")
        self.reach("connection_tested")

    def connection_failed(self) -> None:
        """A connection attempt failed; a later success still reports ``ok``."""

        self._failed = True
        update_command_telemetry(connection_result="failed")

    def offline(self) -> None:
        """No schema will be read; after a failure, that failure is what's reported."""

        if not self._failed:
            update_command_telemetry(connection_result="skipped")
