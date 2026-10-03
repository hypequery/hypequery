"""Execution admission before compilation or cache lookup."""

from .context import ExecutionContext
from .errors import CompiledQueryError


def check_execution_admission(context: ExecutionContext) -> None:
    """Refuse to build an execution that is already over.

    Caller cancellation is checked first because it outranks a deadline that
    expired in the same moment: the caller stopped wanting the answer, which is
    a different fact from the answer taking too long.
    """

    if context.cancellation is not None and context.cancellation.is_set():
        raise CompiledQueryError("aborted", "The caller cancelled this execution.")
    if context.deadline is not None and context.deadline.expired():
        raise CompiledQueryError("deadline-exceeded", "The deadline passed before execution.")
