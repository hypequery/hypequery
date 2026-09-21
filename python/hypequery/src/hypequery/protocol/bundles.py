"""Strict RFC 0007 deployment bundle manifest validation.

A manifest describes the closed, content-addressed directory that transports a
deployment contract and every runtime artifact it references. It binds the
semantic deployment identity to exact file bytes, so build, review, upload, and
execution can each verify the same immutable input.

The manifest carries no credentials, target environment, release state,
signature, or runtime configuration. This module validates the manifest only;
walking a real directory — rejecting symlinks, undeclared files, and hash
mismatches — is a filesystem consumer's job, and its failures are product
errors rather than part of this stable code set.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, fields
from typing import cast

from .errors import bundle_error
from .utf8 import exceeds_utf8_byte_limit

_SHA256 = re.compile(r"[0-9a-f]{64}\Z", re.ASCII)
_GIT_COMMIT = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})\Z", re.ASCII)
_PATH_SEGMENT = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*\Z", re.ASCII)
_WINDOWS_RESERVED = re.compile(r"(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|\Z)", re.IGNORECASE)
_BRANCH_FORBIDDEN = frozenset("~^:?*[\\")
_RUNTIMES = ("node", "python")
_SAFE_INTEGER = 2**53 - 1

_MEBIBYTE = 1_024 * 1_024
_BUNDLE_MAXIMUMS = {
    "max_artifacts": 100,
    "max_source_files": 1_000,
    "max_path_bytes": 1_024,
    "max_deployment_bytes": 16 * _MEBIBYTE,
    "max_artifact_bytes": 128 * _MEBIBYTE,
    "max_source_file_bytes": 2 * _MEBIBYTE,
    "max_source_bytes": 32 * _MEBIBYTE,
    "max_total_bytes": 256 * _MEBIBYTE,
}


@dataclass(frozen=True, slots=True)
class ProtocolDeploymentBundleLimits:
    """Parser budgets that may tighten, but never raise, the v1 ceilings.

    These bound what validation will read; they are not deployment capacity
    settings.
    """

    max_artifacts: int = _BUNDLE_MAXIMUMS["max_artifacts"]
    max_source_files: int = _BUNDLE_MAXIMUMS["max_source_files"]
    max_path_bytes: int = _BUNDLE_MAXIMUMS["max_path_bytes"]
    max_deployment_bytes: int = _BUNDLE_MAXIMUMS["max_deployment_bytes"]
    max_artifact_bytes: int = _BUNDLE_MAXIMUMS["max_artifact_bytes"]
    max_source_file_bytes: int = _BUNDLE_MAXIMUMS["max_source_file_bytes"]
    max_source_bytes: int = _BUNDLE_MAXIMUMS["max_source_bytes"]
    max_total_bytes: int = _BUNDLE_MAXIMUMS["max_total_bytes"]

    def __post_init__(self) -> None:
        for limit in fields(self):
            value = getattr(self, limit.name)
            maximum = _BUNDLE_MAXIMUMS[limit.name]
            if type(value) is not int or value < 1 or value > maximum:
                msg = (
                    f"{limit.name} must be a positive integer no greater than "
                    "the bundle manifest v1 maximum"
                )
                raise ValueError(msg)


DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS = ProtocolDeploymentBundleLimits()


def _record(value: object, path: str) -> dict[str, object]:
    if type(value) is dict:
        return cast(dict[str, object], value)
    if value is None or type(value) in (bool, str, int, float, list):
        bundle_error("HQ_BUNDLE_TYPE", path)
    bundle_error("HQ_BUNDLE_UNSAFE_OBJECT", path)


def _array(value: object, path: str, max_items: int) -> list[object]:
    if type(value) is not list:
        if value is None or type(value) in (bool, str, int, float, dict):
            bundle_error("HQ_BUNDLE_TYPE", path)
        bundle_error("HQ_BUNDLE_UNSAFE_OBJECT", path)
    items = cast(list[object], value)
    if len(items) > max_items:
        bundle_error("HQ_BUNDLE_TOO_MANY_ITEMS", path)
    return items


def _exact_fields(
    value: dict[str, object], required: tuple[str, ...], path: str, optional: tuple[str, ...] = ()
) -> None:
    allowed = frozenset((*required, *optional))
    for key in value:
        if type(key) is not str:
            bundle_error("HQ_BUNDLE_UNSAFE_OBJECT", path)
        if key not in allowed:
            bundle_error("HQ_BUNDLE_UNKNOWN_FIELD", f"{path}.{key}")
    for key in required:
        if key not in value:
            bundle_error("HQ_BUNDLE_TYPE", f"{path}.{key}")


def _digest(value: object, path: str) -> str:
    if type(value) is not str:
        bundle_error("HQ_BUNDLE_TYPE", path)
    if _SHA256.match(value) is None:
        bundle_error("HQ_BUNDLE_INVALID_VALUE", path)
    return value


def _byte_length(value: object, path: str, maximum: int, *, allow_empty: bool = False) -> int:
    if type(value) is bool or type(value) not in (int, float):
        bundle_error("HQ_BUNDLE_INVALID_VALUE", path)
    number = cast(int | float, value)
    if type(number) is float and not number.is_integer():
        bundle_error("HQ_BUNDLE_INVALID_VALUE", path)
    integer = int(number)
    if integer < (0 if allow_empty else 1) or abs(integer) > _SAFE_INTEGER:
        bundle_error("HQ_BUNDLE_INVALID_VALUE", path)
    if integer > maximum:
        bundle_error("HQ_BUNDLE_TOO_LARGE", path)
    return integer


def _relative_path(value: object, path: str, max_bytes: int) -> str:
    """A portable bundle-relative path a consumer can never resolve outside the root."""

    if type(value) is not str:
        bundle_error("HQ_BUNDLE_TYPE", path)
    if len(value) > max_bytes or exceeds_utf8_byte_limit(value, max_bytes):
        bundle_error("HQ_BUNDLE_TOO_LARGE", path)
    for segment in value.split("/"):
        if (
            _PATH_SEGMENT.match(segment) is None
            or segment.endswith(".")
            or _WINDOWS_RESERVED.match(segment) is not None
        ):
            bundle_error("HQ_BUNDLE_INVALID_PATH", path)
    return value


def _file(
    value: object,
    path: str,
    limits: ProtocolDeploymentBundleLimits,
    maximum: int,
    *,
    allow_empty: bool = False,
) -> dict[str, object]:
    node = _record(value, path)
    _exact_fields(node, ("path", "sha256", "byteLength"), path)
    return {
        "path": _relative_path(node["path"], f"{path}.path", limits.max_path_bytes),
        "sha256": _digest(node["sha256"], f"{path}.sha256"),
        "byteLength": _byte_length(
            node["byteLength"], f"{path}.byteLength", maximum, allow_empty=allow_empty
        ),
    }


def _deployment(
    value: object, path: str, limits: ProtocolDeploymentBundleLimits
) -> dict[str, object]:
    node = _record(value, path)
    _exact_fields(node, ("path", "identity", "sha256", "byteLength"), path)
    return {
        "path": _relative_path(node["path"], f"{path}.path", limits.max_path_bytes),
        "identity": _digest(node["identity"], f"{path}.identity"),
        "sha256": _digest(node["sha256"], f"{path}.sha256"),
        "byteLength": _byte_length(
            node["byteLength"], f"{path}.byteLength", limits.max_deployment_bytes
        ),
    }


def _artifact(
    value: object, path: str, limits: ProtocolDeploymentBundleLimits
) -> dict[str, object]:
    node = _record(value, path)
    _exact_fields(node, ("runtime", "path", "sha256", "byteLength"), path)
    runtime = node["runtime"]
    if runtime not in _RUNTIMES:
        if type(runtime) is not str:
            bundle_error("HQ_BUNDLE_TYPE", f"{path}.runtime")
        bundle_error("HQ_BUNDLE_INVALID_VALUE", f"{path}.runtime")
    return {
        "runtime": runtime,
        "path": _relative_path(node["path"], f"{path}.path", limits.max_path_bytes),
        "sha256": _digest(node["sha256"], f"{path}.sha256"),
        "byteLength": _byte_length(
            node["byteLength"], f"{path}.byteLength", limits.max_artifact_bytes
        ),
    }


def _branch(value: object, path: str, max_bytes: int) -> str:
    """A git branch name, held to git's own reference rules."""

    if type(value) is not str:
        bundle_error("HQ_BUNDLE_TYPE", path)
    if exceeds_utf8_byte_limit(value, max_bytes):
        bundle_error("HQ_BUNDLE_TOO_LARGE", path)
    invalid_character = any(
        ord(character) <= 0x20 or ord(character) == 0x7F or character in _BRANCH_FORBIDDEN
        for character in value
    )
    segments = value.split("/")
    if (
        not value
        or value == "@"
        or value.startswith("-")
        or value.startswith("/")
        or value.endswith("/")
        or value.endswith(".")
        or "//" in value
        or ".." in value
        or "@{" in value
        or invalid_character
        or any(segment.startswith(".") or segment.endswith(".lock") for segment in segments)
    ):
        bundle_error("HQ_BUNDLE_INVALID_VALUE", path)
    return value


def _source_revision(
    value: object, path: str, limits: ProtocolDeploymentBundleLimits
) -> dict[str, object]:
    node = _record(value, path)
    _exact_fields(node, ("kind", "commit", "dirty"), path, ("branch",))
    if node["kind"] != "git":
        if type(node["kind"]) is not str:
            bundle_error("HQ_BUNDLE_TYPE", f"{path}.kind")
        bundle_error("HQ_BUNDLE_INVALID_VALUE", f"{path}.kind")
    commit = node["commit"]
    if type(commit) is not str:
        bundle_error("HQ_BUNDLE_TYPE", f"{path}.commit")
    if _GIT_COMMIT.match(commit) is None:
        bundle_error("HQ_BUNDLE_INVALID_VALUE", f"{path}.commit")
    if type(node["dirty"]) is not bool:
        bundle_error("HQ_BUNDLE_TYPE", f"{path}.dirty")
    revision: dict[str, object] = {"kind": "git", "commit": commit, "dirty": node["dirty"]}
    if "branch" in node:
        branch = _branch(node["branch"], f"{path}.branch", limits.max_path_bytes)
        # An empty branch name is already rejected, so this only skips absence.
        if branch:
            revision["branch"] = branch
    return revision


def _source(value: object, path: str, limits: ProtocolDeploymentBundleLimits) -> dict[str, object]:
    node = _record(value, path)
    _exact_fields(node, ("root", "entrypoint", "files"), path, ("revision",))
    root = _relative_path(node["root"], f"{path}.root", limits.max_path_bytes)
    entrypoint = _relative_path(node["entrypoint"], f"{path}.entrypoint", limits.max_path_bytes)
    files = [
        _file(
            item, f"{path}.files[{index}]", limits, limits.max_source_file_bytes, allow_empty=True
        )
        for index, item in enumerate(
            _array(node["files"], f"{path}.files", limits.max_source_files)
        )
    ]
    if not files or not any(file["path"] == entrypoint for file in files):
        bundle_error("HQ_BUNDLE_INVALID_REFERENCE", f"{path}.entrypoint")
    paths = [cast(str, file["path"]) for file in files]
    if len(set(paths)) != len(paths) or len({p.lower() for p in paths}) != len(paths):
        bundle_error("HQ_BUNDLE_INVALID_REFERENCE", f"{path}.files")
    if paths != sorted(paths):
        bundle_error("HQ_BUNDLE_INVALID_VALUE", f"{path}.files")
    total = sum(cast(int, file["byteLength"]) for file in files)
    if total > limits.max_source_bytes or total > _SAFE_INTEGER:
        bundle_error("HQ_BUNDLE_TOO_LARGE", path)
    result: dict[str, object] = {"root": root, "entrypoint": entrypoint, "files": files}
    if "revision" in node:
        result["revision"] = _source_revision(node["revision"], f"{path}.revision", limits)
    return result


def _has_tree_collision(paths: list[str]) -> bool:
    """Whether any path's ancestor directory is itself declared as a file."""

    normalized = {path.lower() for path in paths}
    for path in normalized:
        segments = path.split("/")
        for index in range(1, len(segments)):
            if "/".join(segments[:index]) in normalized:
                return True
    return False


def validate_protocol_deployment_bundle_manifest(
    value: object,
    *,
    limits: ProtocolDeploymentBundleLimits = DEFAULT_PROTOCOL_DEPLOYMENT_BUNDLE_LIMITS,
) -> dict[str, object]:
    """Validate a bundle manifest and return it as detached protocol data."""

    node = _record(value, "$")
    _exact_fields(node, ("kind", "version", "deployment", "artifacts"), "$", ("source",))
    if node["kind"] != "hypequery-deployment-bundle":
        if type(node["kind"]) is not str:
            bundle_error("HQ_BUNDLE_TYPE", "$.kind")
        bundle_error("HQ_BUNDLE_INVALID_VALUE", "$.kind")
    version = node["version"]
    if version != 1:
        if type(version) is bool or type(version) not in (int, float):
            bundle_error("HQ_BUNDLE_TYPE", "$.version")
        bundle_error("HQ_BUNDLE_INVALID_VERSION", "$.version")

    deployment = _deployment(node["deployment"], "$.deployment", limits)
    artifacts = [
        _artifact(item, f"$.artifacts[{index}]", limits)
        for index, item in enumerate(_array(node["artifacts"], "$.artifacts", limits.max_artifacts))
    ]
    source = _source(node["source"], "$.source", limits) if "source" in node else None

    source_paths: list[str] = []
    if source is not None:
        root = cast(str, source["root"])
        source_paths = [
            f"{root}/{cast(str, file['path'])}"
            for file in cast(list[dict[str, object]], source["files"])
        ]
    paths = [
        cast(str, deployment["path"]),
        *(cast(str, artifact["path"]) for artifact in artifacts),
        *source_paths,
    ]
    if (
        len(set(paths)) != len(paths)
        or len({path.lower() for path in paths}) != len(paths)
        or _has_tree_collision(paths)
    ):
        bundle_error("HQ_BUNDLE_INVALID_REFERENCE", "$")
    digests = [cast(str, artifact["sha256"]) for artifact in artifacts]
    if len(set(digests)) != len(digests):
        bundle_error("HQ_BUNDLE_INVALID_REFERENCE", "$.artifacts")
    artifact_paths = [cast(str, artifact["path"]) for artifact in artifacts]
    if artifact_paths != sorted(artifact_paths):
        bundle_error("HQ_BUNDLE_INVALID_VALUE", "$.artifacts")

    total = cast(int, deployment["byteLength"]) + sum(
        cast(int, artifact["byteLength"]) for artifact in artifacts
    )
    if source is not None:
        total += sum(
            cast(int, file["byteLength"]) for file in cast(list[dict[str, object]], source["files"])
        )
    if total > limits.max_total_bytes or total > _SAFE_INTEGER:
        bundle_error("HQ_BUNDLE_TOO_LARGE", "$")

    manifest: dict[str, object] = {
        "kind": "hypequery-deployment-bundle",
        "version": 1,
        "deployment": deployment,
        "artifacts": artifacts,
    }
    if source is not None:
        manifest["source"] = source
    return manifest
