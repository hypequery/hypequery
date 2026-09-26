"""Prepare and write deterministic dataset-only deployment bundles."""

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
    prepare_protocol_deployment_bundle_manifest,
    prepare_protocol_deployment_contract,
)

from .deployment import build_protocol_deployment_contract
from .registry import DatasetRegistry

DEPLOYMENT_FILE = "deployment.json"
BUNDLE_FILE = "bundle.json"


@dataclass(frozen=True, slots=True)
class PreparedDatasetBundle:
    """The exact files and identity of one dataset-only bundle."""

    deployment_bytes: bytes
    manifest_bytes: bytes
    deployment_identity: str
    bundle_identity: str


def prepare_dataset_bundle(
    registry: DatasetRegistry,
    *,
    endpoints: Mapping[str, Mapping[str, object]] | None = None,
) -> PreparedDatasetBundle:
    """Assemble canonical bytes without touching the filesystem."""

    contract = build_protocol_deployment_contract(registry, endpoints=endpoints)
    prepared = prepare_protocol_deployment_contract(contract)
    deployment_bytes = prepared.contract_bytes + b"\n"
    manifest = prepare_protocol_deployment_bundle_manifest(
        {
            "kind": "hypequery-deployment-bundle",
            "version": 1,
            "deployment": {
                "path": DEPLOYMENT_FILE,
                "identity": prepared.identity,
                "sha256": hashlib.sha256(deployment_bytes).hexdigest(),
                "byteLength": len(deployment_bytes),
            },
            "artifacts": [],
        }
    )
    return PreparedDatasetBundle(
        deployment_bytes=deployment_bytes,
        manifest_bytes=manifest.manifest_bytes + b"\n",
        deployment_identity=prepared.identity,
        bundle_identity=manifest.identity,
    )


def write_dataset_bundle(
    output_directory: str | Path,
    registry: DatasetRegistry,
    *,
    endpoints: Mapping[str, Mapping[str, object]] | None = None,
) -> PreparedDatasetBundle:
    """Write a new bundle through a staging directory, refusing replacement."""

    bundle = prepare_dataset_bundle(registry, endpoints=endpoints)
    destination = Path(output_directory).absolute()
    if destination == destination.parent:
        raise ValueError("The bundle output cannot be a filesystem root.")
    if destination.exists() or destination.is_symlink():
        raise FileExistsError(f"Bundle output already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{destination.name}.tmp-", dir=destination.parent))
    claimed_destination = False
    try:
        (staging / DEPLOYMENT_FILE).write_bytes(bundle.deployment_bytes)
        (staging / BUNDLE_FILE).write_bytes(bundle.manifest_bytes)
        # mkdir is an atomic no-replace claim; rename can replace an empty
        # directory created after the existence check above.
        destination.mkdir()
        claimed_destination = True
        os.replace(staging / DEPLOYMENT_FILE, destination / DEPLOYMENT_FILE)
        # Publish the manifest last so readers cannot see a complete bundle
        # until its deployment file is in place.
        os.replace(staging / BUNDLE_FILE, destination / BUNDLE_FILE)
    except BaseException:
        if claimed_destination:
            (destination / DEPLOYMENT_FILE).unlink(missing_ok=True)
            (destination / BUNDLE_FILE).unlink(missing_ok=True)
            with suppress(OSError):
                destination.rmdir()
        shutil.rmtree(staging, ignore_errors=True)
        raise
    staging.rmdir()
    return bundle
