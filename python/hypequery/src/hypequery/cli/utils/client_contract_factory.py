"""Load an explicitly configured offline factory and canonicalize its public result."""

from __future__ import annotations

import importlib
import io
import logging
import re
import sys
from collections.abc import Callable
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from typing import cast

from ...protocol import (
    ProtocolClientContractError,
    prepare_protocol_client_contract,
    validate_protocol_client_contract,
)
from ..errors import CliError

_FACTORY = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*:[A-Za-z_][A-Za-z0-9_]*")


class _DiscardFactoryOutput(io.TextIOBase):
    """Discard import/factory chatter without retaining arbitrary project output."""

    def write(self, text: str) -> int:
        return len(text)


def load_client_contract_factory(specification: str) -> str:
    """Import trusted project code explicitly; never initialize a driver in the CLI.

    Factories must return a signed contract or the SDK's exact prepared wrapper.
    Import/call failures and their output are redacted, including SystemExit.
    KeyboardInterrupt remains a user cancellation. This is not a code sandbox.
    """
    if len(specification) > 512 or not _FACTORY.fullmatch(specification):
        raise CliError("Use --factory module:factory with a zero-argument definition-only factory.")
    module_name, attribute = specification.split(":")
    previous_path = list(sys.path)
    previous_bytecode = sys.dont_write_bytecode
    previous_logging = logging.root.manager.disable
    previous_handlers = list(logging.root.handlers)
    try:
        sys.path.insert(0, str(Path.cwd()))
        sys.dont_write_bytecode = True
        logging.disable(sys.maxsize)
        sink = _DiscardFactoryOutput()
        with redirect_stdout(sink), redirect_stderr(sink):
            module = importlib.import_module(module_name)
            target = getattr(module, attribute)
            if not callable(target):
                raise TypeError("factory must be callable")
            value: object = cast(Callable[[], object], target)()
    except (Exception, SystemExit):
        raise CliError(
            "Cannot load the client-contract factory; check its code and dependencies."
        ) from None
    finally:
        sys.path[:] = previous_path
        sys.dont_write_bytecode = previous_bytecode
        logging.disable(previous_logging)
        logging.root.handlers[:] = previous_handlers
    wrapper = (
        value
        if type(value) is dict and set(value) == {"contract", "canonical", "contentHash"}
        else None
    )
    raw = wrapper["contract"] if wrapper is not None else value
    try:
        contract = validate_protocol_client_contract(raw)
        prepared = prepare_protocol_client_contract(
            {
                **{key: item for key, item in contract.items() if key != "contentHash"},
                "endpoints": [
                    {key: item for key, item in endpoint.items() if key != "schemaHash"}
                    for endpoint in contract["endpoints"]
                ],
            }
        )
    except ProtocolClientContractError as error:
        raise CliError(f"Invalid client contract ({error.code}) at {error.path or '/'}.") from None
    if wrapper is not None and (
        type(wrapper["canonical"]) is not str
        or type(wrapper["contentHash"]) is not str
        or wrapper["canonical"] != prepared["canonical"]
        or wrapper["contentHash"] != prepared["contentHash"]
    ):
        raise CliError("Prepared client-contract identities do not match its validated contract.")
    return prepared["canonical"]
