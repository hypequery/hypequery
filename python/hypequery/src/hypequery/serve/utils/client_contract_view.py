"""Re-sign a policy-selected projection under its explicit contract view."""

from typing import Literal

from ...protocol import PreparedProtocolClientContract, prepare_protocol_client_contract


def client_contract_view(
    prepared: PreparedProtocolClientContract, view: Literal["build", "authorized"]
) -> PreparedProtocolClientContract:
    if view == "build":
        return prepared
    contract = prepared["contract"]
    return prepare_protocol_client_contract(
        {
            "kind": contract["kind"],
            "version": contract["version"],
            "view": "authorized",
            "endpoints": [
                {key: value for key, value in endpoint.items() if key != "schemaHash"}
                for endpoint in contract["endpoints"]
            ],
        }
    )
