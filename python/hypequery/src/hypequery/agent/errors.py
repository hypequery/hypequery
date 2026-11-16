"""The one exception the tools raise: a failure the model cannot fix."""

from __future__ import annotations

from .types import JsonObject, ToolErrorDetails


class HypequeryToolsError(Exception):
    """The endpoint refused the token, could not be reached, or broke the protocol.

    Tool errors (bad input, an unknown dataset, a timeout) are not raised; they
    come back as `ToolFailure` results the model can act on.
    """

    def __init__(self, details: ToolErrorDetails, *, status: int | None = None) -> None:
        super().__init__(details.message)
        self.details = details
        #: The HTTP status, when the endpoint answered with one.
        self.status = status

    @property
    def code(self) -> str:
        return self.details.code

    @property
    def retryable(self) -> bool:
        return self.details.retryable

    @property
    def hint(self) -> str | None:
        return self.details.hint

    @property
    def request_id(self) -> str | None:
        return self.details.request_id

    def to_envelope(self) -> JsonObject:
        """The error as hypequery's envelope."""

        return self.details.to_envelope()
