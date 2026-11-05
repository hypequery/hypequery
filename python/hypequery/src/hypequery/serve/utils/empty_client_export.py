"""The error for a client-contract export that would describe no endpoint."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..core.api import Api


def empty_export_message(api: Api) -> str:
    """Why *api*'s build contract is empty, naming the routes left out of it."""

    omitted = [
        f"POST {api.client_mount_path}{route.path}" for route in api.client_endpoints.omitted
    ]
    if not omitted:
        return (
            "The client contract has no endpoints: the API serves no dataset or metric "
            "endpoints with a client_profile."
        )
    return (
        "The client contract has no endpoints: "
        + ", ".join(omitted)
        + (" has" if len(omitted) == 1 else " have")
        + " no client_profile. Pass client_profile= to create_api for Dataset entries, "
        "or to create_dataset_endpoint, create_metric_endpoint or the add_* functions."
    )
