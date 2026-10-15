"""Bounded text decoding that refuses duplicate JSON members."""

from __future__ import annotations

import json
import re
from typing import cast

from .errors import ProtocolClientContractError, client_error
from .models import ProtocolClientContract
from .primitives import pointer
from .safe_data import CLIENT_MAX_BYTES
from .validate import validate_protocol_client_contract

_TOKEN = re.compile(r"null|true|false|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?")


class _ClientJsonReader:
    def __init__(self, value: str) -> None:
        self.input = value
        self.position = 0
        self.nodes = 0

    def read(self) -> object:
        result = self.value(1, "")
        self.whitespace()
        if self.position != len(self.input):
            client_error("HQ_CLIENT_TYPE")
        return result

    def whitespace(self) -> None:
        while self.position < len(self.input) and self.input[self.position] in " \t\r\n":
            self.position += 1

    def character(self) -> str:
        return self.input[self.position : self.position + 1]

    def string(self) -> str:
        start = self.position
        self.position += 1
        while self.position < len(self.input):
            character = self.character()
            self.position += 1
            if character == "\\":
                self.position += 1
            elif character == '"':
                return cast(str, json.loads(self.input[start : self.position]))
        client_error("HQ_CLIENT_TYPE")

    def container(self, depth: int, path: str) -> object:
        is_object = self.character() == "{"
        close = "}" if is_object else "]"
        result: dict[str, object] = {}
        array: list[object] = []
        self.position += 1
        self.whitespace()
        if self.character() != close:
            while True:
                self.whitespace()
                key = str(len(array))
                if is_object:
                    if self.character() != '"':
                        client_error("HQ_CLIENT_TYPE")
                    key = self.string()
                    if key in result:
                        client_error("HQ_CLIENT_DUPLICATE")
                    self.whitespace()
                    if self.character() != ":":
                        client_error("HQ_CLIENT_TYPE")
                    self.position += 1
                child = self.value(depth + 1, pointer(path, key))
                if is_object:
                    result[key] = child
                else:
                    array.append(child)
                self.whitespace()
                if self.character() != ",":
                    break
                self.position += 1
        if self.character() != close:
            client_error("HQ_CLIENT_TYPE")
        self.position += 1
        return result if is_object else array

    def value(self, depth: int, path: str) -> object:
        self.nodes += 1
        if depth > 16 or self.nodes > 100_000:
            client_error("HQ_CLIENT_LIMIT")
        self.whitespace()
        if self.character() == '"':
            return self.string()
        if self.character() in ("{", "["):
            return self.container(depth, path)
        match = _TOKEN.match(self.input, self.position)
        if match is None:
            client_error("HQ_CLIENT_TYPE")
        self.position = match.end()
        return cast(object, json.loads(match.group()))


def decode_protocol_client_contract(value: str) -> ProtocolClientContract:
    """Decode at most 1 MiB of JSON text before validating the signed contract."""
    if type(value) is not str:
        client_error("HQ_CLIENT_TYPE")
    try:
        if len(value) > CLIENT_MAX_BYTES or len(value.encode("utf-8")) > CLIENT_MAX_BYTES:
            client_error("HQ_CLIENT_LIMIT")
        return validate_protocol_client_contract(_ClientJsonReader(value).read())
    except ProtocolClientContractError:
        raise
    except (ValueError, TypeError, UnicodeError):
        client_error("HQ_CLIENT_TYPE")
