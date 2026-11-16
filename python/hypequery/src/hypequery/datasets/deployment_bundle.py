"""Prepare and write deterministic dataset deployment bundles.

A bundle carries the deployment contract and, optionally, reviewed business
context. With context it is a version 2 bundle with `business-context.json`;
without it (or with an empty document) it stays version 1, so adding no context
never changes a bundle's identity. The files, manifest and identities follow the
same rules as the TypeScript CLI's deployment bundles.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
from collections.abc import Mapping
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

from hypequery.protocol import (
    PreparedProtocolBusinessContext,
    is_empty_protocol_business_context,
    prepare_protocol_business_context,
    prepare_protocol_deployment_bundle_manifest,
    prepare_protocol_deployment_contract,
)

from .deployment import build_protocol_deployment_contract
from .registry import DatasetRegistry

DEPLOYMENT_FILE = "deployment.json"
BUNDLE_FILE = "bundle.json"
BUSINESS_CONTEXT_FILE = "business-context.json"


@dataclass(frozen=True, slots=True)
class PreparedDatasetBundle:
    """The exact files and identity of one dataset bundle.

    *business_context_bytes* and *business_context_identity* are set only for
    a version 2 bundle, one that carries non-empty business context.
    """

    deployment_bytes: bytes
    manifest_bytes: bytes
    deployment_identity: str
    bundle_identity: str
    business_context_bytes: bytes | None = None
    business_context_identity: str | None = None


def _business_context(value: Mapping[str, object] | None) -> PreparedProtocolBusinessContext | None:
    """The prepared document, or None when there is none or it is empty."""

    if value is None:
        return None
    prepared = prepare_protocol_business_context(dict(value))
    return None if is_empty_protocol_business_context(prepared.context) else prepared


def prepare_dataset_bundle(
    registry: DatasetRegistry,
    *,
    endpoints: Mapping[str, Mapping[str, object]] | None = None,
    business_context: Mapping[str, object] | None = None,
) -> PreparedDatasetBundle:
    """Assemble canonical bytes without touching the filesystem.

    *business_context* is a document from `define_business_context`. It is
    validated here; an invalid one raises `ProtocolBusinessContextError`.
    """

    contract = build_protocol_deployment_contract(registry, endpoints=endpoints)
    prepared = prepare_protocol_deployment_contract(contract)
    deployment_bytes = prepared.contract_bytes + b"\n"
    context = _business_context(business_context)
    context_bytes = None if context is None else context.context_bytes + b"\n"
    manifest_input: dict[str, object] = {
        "kind": "hypequery-deployment-bundle",
        "version": 1 if context is None else 2,
        "deployment": {
            "path": DEPLOYMENT_FILE,
            "identity": prepared.identity,
            "sha256": hashlib.sha256(deployment_bytes).hexdigest(),
            "byteLength": len(deployment_bytes),
        },
        "artifacts": [],
    }
    if context is not None and context_bytes is not None:
        manifest_input["businessContext"] = {
            "path": BUSINESS_CONTEXT_FILE,
            "identity": context.identity,
            "sha256": hashlib.sha256(context_bytes).hexdigest(),
            "byteLength": len(context_bytes),
        }
    manifest = prepare_protocol_deployment_bundle_manifest(manifest_input)
    return PreparedDatasetBundle(
        deployment_bytes=deployment_bytes,
        manifest_bytes=manifest.manifest_bytes + b"\n",
        deployment_identity=prepared.identity,
        bundle_identity=manifest.identity,
        business_context_bytes=context_bytes,
        business_context_identity=None if context is None else context.identity,
    )


def write_dataset_bundle(
    output_directory: str | Path,
    registry: DatasetRegistry,
    *,
    endpoints: Mapping[str, Mapping[str, object]] | None = None,
    business_context: Mapping[str, object] | None = None,
) -> PreparedDatasetBundle:
    """Write a new bundle through a staging directory, refusing replacement."""

    bundle = prepare_dataset_bundle(
        registry, endpoints=endpoints, business_context=business_context
    )
    files = [(DEPLOYMENT_FILE, bundle.deployment_bytes)]
    if bundle.business_context_bytes is not None:
        files.append((BUSINESS_CONTEXT_FILE, bundle.business_context_bytes))
    # The manifest goes last so readers cannot see a complete bundle until
    # every file it declares is in place.
    files.append((BUNDLE_FILE, bundle.manifest_bytes))
    destination = Path(output_directory).absolute()
    if destination == destination.parent:
        raise ValueError("The bundle output cannot be a filesystem root.")
    if destination.exists() or destination.is_symlink():
        raise FileExistsError(f"Bundle output already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{destination.name}.tmp-", dir=destination.parent))
    claimed_destination = False
    try:
        for name, data in files:
            (staging / name).write_bytes(data)
        # mkdir is an atomic no-replace claim; rename can replace an empty
        # directory created after the existence check above.
        destination.mkdir()
        claimed_destination = True
        for name, _ in files:
            os.replace(staging / name, destination / name)
    except BaseException:
        if claimed_destination:
            for name, _ in files:
                (destination / name).unlink(missing_ok=True)
            with suppress(OSError):
                destination.rmdir()
        shutil.rmtree(staging, ignore_errors=True)
        raise
    staging.rmdir()
    return bundle
