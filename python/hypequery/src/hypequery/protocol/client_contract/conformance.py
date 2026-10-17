"""NDJSON adapter operations over public client-contract APIs."""

from typing import Literal, cast

from . import (
    ProtocolClientContractError,
    decode_protocol_client_contract,
    prepare_protocol_client_contract,
    validate_protocol_client_contract,
    validate_protocol_client_query,
)


def _handle(role: str, case: dict[str, object]) -> dict[str, object]:
    if case.get("mode") == "decode":
        decode_protocol_client_contract(cast(str, case["value"]))
        return {"ok": True}
    if case.get("mode") == "query":
        value = cast(dict[str, object], case["value"])
        result = validate_protocol_client_query(
            value["contract"],
            cast(str, value["endpoint"]),
            value["input"],
            cast(Literal["http", "mcp"], value["transport"]),
        )
        return {
            "ok": True,
            "output": {
                "body": result["body"],
                "selectedMeasures": result["selectedMeasures"],
                "effectiveLimit": result["effectiveLimit"],
            },
        }
    if case.get("mode") == "relation":
        value = cast(dict[str, object], case["value"])
        if "contract" in value:
            contract = validate_protocol_client_contract(value["contract"])
            return {
                "ok": True,
                "output": {
                    "queryDatasetTargets": [
                        e["id"] for e in contract["endpoints"] if e["kind"] == "dataset"
                    ],
                    "queryMetricTargets": [
                        {"dataset": e["dataset"], "metric": e["id"]}
                        for e in contract["endpoints"]
                        if e["kind"] == "metric"
                    ],
                },
            }
        left = validate_protocol_client_contract(value["left"])
        right = validate_protocol_client_contract(value["right"])
        return {
            "ok": True,
            "output": {
                "sameEndpointSchemas": [
                    e["id"]
                    for e in left["endpoints"]
                    if any(
                        r["id"] == e["id"] and r["schemaHash"] == e["schemaHash"]
                        for r in right["endpoints"]
                    )
                ],
                "sameContentHash": left["contentHash"] == right["contentHash"],
            },
        }
    contract = validate_protocol_client_contract(case["value"])
    if role != "identity":
        return {"ok": True}
    root = {key: value for key, value in contract.items() if key != "contentHash"}
    root["endpoints"] = [
        {key: value for key, value in endpoint.items() if key != "schemaHash"}
        for endpoint in contract["endpoints"]
    ]
    prepared = prepare_protocol_client_contract(root)
    return {
        "ok": True,
        "output": {"canonical": prepared["canonical"], "sha256": prepared["contentHash"]},
    }


def handle_client_contract(role: str, case: dict[str, object]) -> dict[str, object]:
    try:
        return _handle(role, case)
    except ProtocolClientContractError as error:
        return {
            "ok": False,
            "code": error.code,
            "output": {"path": error.path, "message": str(error)},
        }
