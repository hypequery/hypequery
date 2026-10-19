"""Cross-language client surface and strict request vectors."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Literal, cast

import pytest

from hypequery.protocol import (
    CLIENT_ERROR_MESSAGES,
    ProtocolClientContractError,
    decode_protocol_client_contract,
    prepare_protocol_client_contract,
    validate_protocol_client_contract,
    validate_protocol_client_query,
)

DIRECTORY = (
    Path(__file__).resolve().parents[3] / "specs/security-protocol/fixtures/client-contract-v1"
)


def fixtures(file: str) -> list[dict[str, object]]:
    return cast(list[dict[str, object]], json.loads((DIRECTORY / file).read_text()))


SUCCESS = fixtures("success.json")
CONTRACTS = {cast(str, item["id"]): cast(dict[str, object], item["value"]) for item in SUCCESS}
IDENTITIES = {cast(str, item["id"]): item for item in fixtures("identities.json")}


def unsigned(value: object) -> dict[str, object]:
    result = copy.deepcopy(cast(dict[str, object], value))
    del result["contentHash"]
    for endpoint in cast(list[dict[str, object]], result["endpoints"]):
        del endpoint["schemaHash"]
    return result


def malformed(test: dict[str, object]) -> dict[str, object]:
    result = copy.deepcopy(CONTRACTS[cast(str, test["base"])])
    for patch in cast(list[dict[str, object]], test["set"]):
        parts = [
            item.replace("~1", "/").replace("~0", "~")
            for item in cast(str, patch["path"])[1:].split("/")
        ]
        target: object = result
        for part in parts[:-1]:
            target = (
                cast(list[object], target)[int(part)]
                if type(target) is list
                else cast(dict[str, object], target)[part]
            )
        value = copy.deepcopy(patch["value"])
        if type(target) is list:
            if parts[-1] == "-":
                cast(list[object], target).append(value)
            else:
                cast(list[object], target)[int(parts[-1])] = value
        else:
            cast(dict[str, object], target)[parts[-1]] = value
    return result


@pytest.mark.parametrize("test", SUCCESS, ids=lambda item: str(item["id"]))
def test_identity(test: dict[str, object]) -> None:
    value = cast(dict[str, object], test["value"])
    assert validate_protocol_client_contract(value) == value
    prepared = prepare_protocol_client_contract(unsigned(value))
    identity = IDENTITIES[cast(str, test["id"])]
    assert prepared["canonical"] == identity["canonical"]
    assert prepared["contentHash"] == identity["sha256"]
    assert decode_protocol_client_contract(json.dumps(value)) == value


@pytest.mark.parametrize(
    "test",
    [case for case in fixtures("rejections.json") if "base" in case],
    ids=lambda item: str(item["id"]),
)
def test_rejection(test: dict[str, object]) -> None:
    with pytest.raises(ProtocolClientContractError) as failure:
        validate_protocol_client_contract(malformed(test))
    assert failure.value.code == test["error"]
    assert str(failure.value) == CLIENT_ERROR_MESSAGES[cast(str, test["error"])]


@pytest.mark.parametrize(
    "test",
    fixtures("queries.json") + fixtures("query-rejections.json"),
    ids=lambda item: str(item["id"]),
)
def test_query(test: dict[str, object]) -> None:
    contract = CONTRACTS[cast(str, test["contract"])]
    endpoint = cast(str, test["endpoint"])
    transport = cast(Literal["http", "mcp"], test.get("transport", "http"))
    if "error" in test:
        with pytest.raises(ProtocolClientContractError) as failure:
            validate_protocol_client_query(contract, endpoint, test["input"], transport)
        assert failure.value.code == "HQ_CLIENT_QUERY"
    else:
        plan = validate_protocol_client_query(contract, endpoint, test["input"], transport)
        for key, value in cast(dict[str, object], test.get("http", {})).items():
            assert plan["body"][key] == value
        if test["id"] == "clamped-limit":
            assert plan["effectiveLimit"] == 1000


@pytest.mark.parametrize(
    "key",
    [
        "dimensions",
        "measures",
        "filters",
        "having",
        "orderBy",
        "by",
        "timezone",
        "limit",
        "offset",
        "includeMeta",
    ],
)
def test_null_is_not_omission(key: str) -> None:
    with pytest.raises(ProtocolClientContractError) as failure:
        validate_protocol_client_query(CONTRACTS["build"], "orders", {key: None})
    assert failure.value.code == "HQ_CLIENT_QUERY"


def test_detached_output() -> None:
    original = copy.deepcopy(CONTRACTS["build"])
    result = validate_protocol_client_contract(original)
    cast(list[dict[str, object]], original["endpoints"])[0]["path"] = "/changed"
    assert result["endpoints"][0]["path"] != "/changed"
    result["endpoints"][0]["path"] = "/changed"
    with pytest.raises(ProtocolClientContractError) as failure:
        validate_protocol_client_query(result, "orders", {})
    assert failure.value.code == "HQ_CLIENT_IDENTITY"


@pytest.mark.parametrize("text", ['{"x":1,}', "[1,]", '{"x":01}', "null trailing", '"\x01"'])
def test_malformed_json(text: str) -> None:
    with pytest.raises(ProtocolClientContractError) as failure:
        decode_protocol_client_contract(text)
    assert failure.value.code == "HQ_CLIENT_TYPE"


def test_duplicate_decoded_keys() -> None:
    with pytest.raises(ProtocolClientContractError) as failure:
        decode_protocol_client_contract('{"version":1,"\\u0076ersion":1}')
    assert failure.value.code == "HQ_CLIENT_DUPLICATE"
    assert failure.value.path == ""


@pytest.mark.parametrize(
    ("value", "code"),
    [
        (" " * 1_048_577, "HQ_CLIENT_LIMIT"),
        ("[" * 17 + "0" + "]" * 17, "HQ_CLIENT_LIMIT"),
        ('"\\ud800"', "HQ_CLIENT_TYPE"),
        ('{"value":1e400}', "HQ_CLIENT_TYPE"),
    ],
)
def test_decode_bounds(value: str, code: str) -> None:
    with pytest.raises(ProtocolClientContractError) as failure:
        decode_protocol_client_contract(value)
    assert failure.value.code == code


def test_hostile_subclasses_and_non_json_values() -> None:
    class Hostile(dict[str, object]):
        def __iter__(self) -> object:  # type: ignore[override]
            pytest.fail("user hook must not run")

    cycle: dict[str, object] = {}
    cycle["cycle"] = cycle
    for value in [Hostile(), cycle, {"secret": object()}, {"secret": float("nan")}, {1: "bad"}]:
        with pytest.raises(ProtocolClientContractError) as failure:
            validate_protocol_client_contract(value)
        assert failure.value.code == "HQ_CLIENT_TYPE"
        assert str(failure.value) == CLIENT_ERROR_MESSAGES["HQ_CLIENT_TYPE"]


def test_portable_timezone_spellings() -> None:
    from hypequery.protocol.client_contract.timezone_names import CLIENT_TIMEZONE_NAMES

    assert (
        sorted(CLIENT_TIMEZONE_NAMES) == (DIRECTORY / "timezone-names.txt").read_text().splitlines()
    )
    for zone in ("UTC", "America/New_York", "Etc/GMT+5", "US/Eastern"):
        validate_protocol_client_query(CONTRACTS["build"], "orders", {"timezone": zone})
    for zone in ("utc", "america/new_york", "Factory", "localtime", "+01:00"):
        with pytest.raises(ProtocolClientContractError):
            validate_protocol_client_query(CONTRACTS["build"], "orders", {"timezone": zone})


@pytest.mark.parametrize(
    ("count", "expected"), [(256, "HQ_CLIENT_SHAPE"), (257, "HQ_CLIENT_LIMIT")]
)
def test_endpoint_count_preflight(count: int, expected: str) -> None:
    with pytest.raises(ProtocolClientContractError) as failure:
        validate_protocol_client_contract({**CONTRACTS["build"], "endpoints": [{}] * count})
    assert failure.value.code == expected


@pytest.mark.parametrize(("count", "expected"), [(64, "HQ_CLIENT_SHAPE"), (65, "HQ_CLIENT_LIMIT")])
def test_descriptor_count_preflight(count: int, expected: str) -> None:
    fields = dict.fromkeys("field" + str(i) for i in range(256))
    with pytest.raises(ProtocolClientContractError) as failure:
        validate_protocol_client_contract(
            {**CONTRACTS["build"], "endpoints": [{"dimensions": fields}] * count}
        )
    assert failure.value.code == expected


def test_exact_byte_depth_boundaries() -> None:
    for size, code in [(1_048_576, "HQ_CLIENT_VERSION"), (1_048_577, "HQ_CLIENT_LIMIT")]:
        with pytest.raises(ProtocolClientContractError) as failure:
            validate_protocol_client_contract({"extra": "x" * (size - 12)})
        assert failure.value.code == code
    nested: object = 0
    for _ in range(15):
        nested = [nested]
    with pytest.raises(ProtocolClientContractError) as failure:
        validate_protocol_client_contract(nested)
    assert failure.value.code == "HQ_CLIENT_SHAPE"
    with pytest.raises(ProtocolClientContractError) as failure:
        validate_protocol_client_contract([nested])
    assert failure.value.code == "HQ_CLIENT_LIMIT"


def test_valid_endpoint_and_descriptor_ceilings() -> None:
    template = cast(list[dict[str, object]], unsigned(CONTRACTS["build"])["endpoints"])[0]
    for endpoint_count, filter_count in [(256, 0), (64, 255)]:
        endpoints = [
            {
                **copy.deepcopy(template),
                "id": "dataset" + str(index),
                "dataset": "dataset" + str(index),
                "path": "/datasets/" + str(index),
                "filters": {
                    "filter" + str(j): {"type": "boolean", "operators": ["eq"]}
                    for j in range(filter_count)
                },
            }
            for index in range(endpoint_count)
        ]
        result = prepare_protocol_client_contract(
            {
                "kind": "hypequery-client-contract",
                "version": 1,
                "view": "build",
                "endpoints": endpoints,
            }
        )
        assert len(result["contract"]["endpoints"]) == endpoint_count
        assert validate_protocol_client_contract(result["contract"]) == result["contract"]
