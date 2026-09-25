"""Language-neutral materializers for compact RFC 0007/0008 conformance cases."""

from __future__ import annotations

from typing import cast

from .fixture_primitives import UnsafeAccessor

_MEBIBYTE = 1_024 * 1_024


def _artifact(index: int = 0) -> dict[str, object]:
    sha256 = format(index, "x").rjust(64, "0")
    return {"runtime": "node", "path": f"artifacts/{sha256}.mjs", "sha256": sha256, "byteLength": 1}


def _manifest() -> dict[str, object]:
    return {
        "kind": "hypequery-deployment-bundle",
        "version": 1,
        "deployment": {
            "path": "deployment.json",
            "identity": "1" * 64,
            "sha256": "2" * 64,
            "byteLength": 1,
        },
        "artifacts": [_artifact()],
    }


def _release() -> dict[str, object]:
    return {
        "kind": "hypequery-deployment-release",
        "version": 1,
        "bundleIdentity": "0" * 64,
        "target": {"project": "project_1", "environment": "production"},
    }


def materialize_bundle_fixture(generator: dict[str, object]) -> object:
    """Materialize one generator from the deployment-bundles-v1 fixtures."""

    kind = generator.get("type")
    value = _manifest()
    deployment = cast(dict[str, object], value["deployment"])
    if kind == "wrong-root-type":
        return []
    if kind == "unknown-root-field":
        return {**value, "extra": True}
    if kind == "unsupported-version":
        return {**value, "version": 2}
    if kind == "malformed-digest":
        return {**value, "deployment": {**deployment, "identity": "bad"}}
    if kind == "traversal-path":
        return {**value, "deployment": {**deployment, "path": "../deployment.json"}}
    if kind == "duplicate-path":
        return {**value, "artifacts": [{**_artifact(), "path": deployment["path"]}]}
    if kind == "too-many-artifacts":
        return {**value, "artifacts": [_artifact(index) for index in range(101)]}
    if kind == "deployment-too-large":
        return {**value, "deployment": {**deployment, "byteLength": 16 * _MEBIBYTE + 1}}
    if kind == "unsafe-accessor":
        return UnsafeAccessor()
    raise RuntimeError(f"unknown bundle generator: {kind!r}")


def materialize_release_fixture(generator: dict[str, object]) -> object:
    """Materialize one generator from the deployment-releases-v1 fixtures."""

    kind = generator.get("type")
    value = _release()
    target = cast(dict[str, object], value["target"])
    if kind == "wrong-root-type":
        return []
    if kind == "unknown-root-field":
        return {**value, "extra": True}
    if kind == "unsupported-version":
        return {**value, "version": 2}
    if kind == "malformed-bundle-identity":
        return {**value, "bundleIdentity": "bad"}
    if kind == "target-too-large":
        return {**value, "target": {**target, "project": "p" + "a" * 128}}
    if kind == "unsafe-accessor":
        return UnsafeAccessor()
    raise RuntimeError(f"unknown release generator: {kind!r}")
