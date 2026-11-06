"""Silence what native code writes to the process's stderr for a moment."""

from __future__ import annotations

import os
import sys
from collections.abc import Iterator
from contextlib import contextmanager


@contextmanager
def quiet_native_stderr() -> Iterator[None]:
    """Discard writes to file descriptor 2 inside the block.

    chDB's engine reports a failed open, such as a locked database, by writing
    its raw exception to stderr from native code before raising. The CLI
    reports the failure in its own words, so that line is noise. Python's own
    stderr is flushed first so nothing written before the block is lost.
    """

    sys.stderr.flush()
    try:
        saved = os.dup(2)
    except OSError:  # no usable stderr to redirect
        yield
        return
    try:
        with open(os.devnull, "wb") as devnull:
            os.dup2(devnull.fileno(), 2)
            try:
                yield
            finally:
                os.dup2(saved, 2)
    finally:
        os.close(saved)
