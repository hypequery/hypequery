"""PYB-07: RFC 0007 bundle manifests and RFC 0008 release envelopes.

The plan makes byte-identical bundles a hard precondition for PYB-08 and all
of PY-D, so identity parity is the point of these tests. Every expectation was
checked against the TypeScript build first, across an 83-probe differential run
that found no divergence in acceptance, error code, or identity.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import cast

import pytest

from hypequery.protocol import (
    ProtocolDeploymentBundleError,
    ProtocolDeploymentBundleLimits,
    ProtocolDeploymentReleaseError,
    ProtocolDeploymentReleaseLimits,
    prepare_protocol_deployment_bundle_manifest,
    prepare_protocol_deployment_release_envelope,
    validate_protocol_deployment_bundle_manifest,
    validate_protocol_deployment_release_envelope,
)
from hypequery.protocol.deployment_fixtures import (
    materialize_bundle_fixture,
    materialize_release_fixture,
)

FIXTURES = Path(__file__).resolve().parents[3] / "specs" / "security-protocol" / "fixtures"


def _fixtures(family: str, name: str) -> list[dict[str, object]]:
    return cast(
        list[dict[str, object]], json.loads((FIXTURES / family / f"{name}.json").read_text())
    )


def _artifact(index: int = 0, **overrides: object) -> dict[str, object]:
    sha256 = format(index, "x").rjust(64, "0")
    artifact: dict[str, object] = {
        "runtime": "node",
        "path": f"artifacts/{sha256}.mjs",
        "sha256": sha256,
        "byteLength": 1,
    }
    artifact.update(overrides)
    return artifact


def _manifest(**overrides: object) -> dict[str, object]:
    manifest: dict[str, object] = {
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
    manifest.update(overrides)
    return manifest


def _deployment(**overrides: object) -> dict[str, object]:
    deployment = cast(dict[str, object], _manifest()["deployment"])
    deployment.update(overrides)
    return deployment


def _release(**overrides: object) -> dict[str, object]:
    release: dict[str, object] = {
        "kind": "hypequery-deployment-release",
        "version": 1,
        "bundleIdentity": "0" * 64,
        "target": {"project": "project_1", "environment": "production"},
    }
    release.update(overrides)
    return release


# -- shared corpus ---------------------------------------------------------


def test_shared_bundle_fixtures() -> None:
    for fixture in _fixtures("deployment-bundles-v1", "success"):
        assert validate_protocol_deployment_bundle_manifest(fixture["value"])

    for fixture in _fixtures("deployment-bundles-v1", "rejections"):
        generator = fixture.get("generator")
        value = (
            materialize_bundle_fixture(generator)
            if isinstance(generator, dict)
            else fixture.get("value")
        )
        with pytest.raises(ProtocolDeploymentBundleError) as raised:
            validate_protocol_deployment_bundle_manifest(value)
        assert raised.value.code == fixture["error"], fixture["id"]


def test_shared_release_fixtures() -> None:
    for fixture in _fixtures("deployment-releases-v1", "success"):
        assert validate_protocol_deployment_release_envelope(fixture["value"])

    for fixture in _fixtures("deployment-releases-v1", "rejections"):
        generator = fixture.get("generator")
        value = (
            materialize_release_fixture(generator)
            if isinstance(generator, dict)
            else fixture.get("value")
        )
        with pytest.raises(ProtocolDeploymentReleaseError) as raised:
            validate_protocol_deployment_release_envelope(value)
        assert raised.value.code == fixture["error"], fixture["id"]


def test_shared_identity_fixtures_pin_canonical_bytes_and_hash() -> None:
    for family, prepare in (
        ("deployment-bundles-v1", prepare_protocol_deployment_bundle_manifest),
        ("deployment-releases-v1", prepare_protocol_deployment_release_envelope),
    ):
        values = {f["id"]: f["value"] for f in _fixtures(family, "success")}
        for fixture in _fixtures(family, "identity"):
            prepared = prepare(values[cast(str, fixture["id"])])

            assert prepared.canonical == fixture["canonical"], fixture["id"]
            assert prepared.identity == fixture["sha256"], fixture["id"]


def test_identities_are_domain_separated_from_each_other() -> None:
    """A bundle and a release hash must never collide, nor equal a bare SHA-256."""

    bundle = prepare_protocol_deployment_bundle_manifest(_manifest())
    release = prepare_protocol_deployment_release_envelope(_release())

    assert bundle.identity != hashlib.sha256(bundle.manifest_bytes).hexdigest()
    assert release.identity != hashlib.sha256(release.envelope_bytes).hexdigest()
    assert bundle.identity != release.identity
    assert (
        bundle.identity
        == hashlib.sha256(b"hypequery:deployment-bundle:v1\x00" + bundle.manifest_bytes).hexdigest()
    )
    assert (
        release.identity
        == hashlib.sha256(
            b"hypequery:deployment-release:v1\x00" + release.envelope_bytes
        ).hexdigest()
    )


# -- bundle manifest -------------------------------------------------------


@pytest.mark.parametrize(
    ("manifest", "code"),
    [
        (_manifest(kind="nope"), "HQ_BUNDLE_INVALID_VALUE"),
        (_manifest(kind=1), "HQ_BUNDLE_TYPE"),
        (_manifest(version=2), "HQ_BUNDLE_INVALID_VERSION"),
        ({**_manifest(), "extra": True}, "HQ_BUNDLE_UNKNOWN_FIELD"),
        (_manifest(deployment=_deployment(identity="bad")), "HQ_BUNDLE_INVALID_VALUE"),
        # Digests are lowercase hex; an uppercase one is a different string.
        (_manifest(deployment=_deployment(sha256="A" * 64)), "HQ_BUNDLE_INVALID_VALUE"),
        (_manifest(deployment=_deployment(byteLength=0)), "HQ_BUNDLE_INVALID_VALUE"),
        (_manifest(deployment=_deployment(byteLength=1.5)), "HQ_BUNDLE_INVALID_VALUE"),
        (
            _manifest(deployment=_deployment(byteLength=16 * 1024 * 1024 + 1)),
            "HQ_BUNDLE_TOO_LARGE",
        ),
        (_manifest(artifacts=[_artifact(runtime="deno")]), "HQ_BUNDLE_INVALID_VALUE"),
        (_manifest(artifacts=[_artifact(runtime=1)]), "HQ_BUNDLE_TYPE"),
        (_manifest(artifacts={}), "HQ_BUNDLE_TYPE"),
        (
            _manifest(artifacts=[_artifact(index) for index in range(101)]),
            "HQ_BUNDLE_TOO_MANY_ITEMS",
        ),
    ],
)
def test_manifest_envelope_rules(manifest: dict[str, object], code: str) -> None:
    with pytest.raises(ProtocolDeploymentBundleError) as raised:
        validate_protocol_deployment_bundle_manifest(manifest)
    assert raised.value.code == code


@pytest.mark.parametrize(
    "path",
    [
        "../deployment.json",
        "/deployment.json",
        "./deployment.json",
        "a\\b.json",
        "a//b.json",
        "a%2fb.json",
        "deployment.",
        ".hidden",
        "-leading-dash",
        "",
        "CON.json",
        "NUL",
        "com1.txt",
    ],
)
def test_unportable_paths_are_rejected(path: str) -> None:
    """Traversal, absolute, device, and ambiguous paths never reach a filesystem."""

    with pytest.raises(ProtocolDeploymentBundleError) as raised:
        validate_protocol_deployment_bundle_manifest(_manifest(deployment=_deployment(path=path)))
    assert raised.value.code in ("HQ_BUNDLE_INVALID_PATH", "HQ_BUNDLE_TOO_LARGE")


def test_paths_must_be_unique_and_unambiguous() -> None:
    cases: list[tuple[dict[str, object], str]] = [
        # The deployment path reused by an artifact.
        (_manifest(artifacts=[_artifact(path="deployment.json")]), "$"),
        # Two paths that differ only by case collide on a case-folding filesystem.
        (
            _manifest(
                deployment=_deployment(path="Deployment.json"),
                artifacts=[_artifact(path="deployment.json")],
            ),
            "$",
        ),
        # A file whose ancestor directory is itself declared as a file.
        (_manifest(deployment=_deployment(path="a"), artifacts=[_artifact(path="a/b.mjs")]), "$"),
    ]
    for manifest, path in cases:
        with pytest.raises(ProtocolDeploymentBundleError) as raised:
            validate_protocol_deployment_bundle_manifest(manifest)
        assert raised.value.code == "HQ_BUNDLE_INVALID_REFERENCE"
        assert raised.value.path == path


def test_artifacts_are_sorted_and_digest_unique() -> None:
    unsorted = _manifest(
        artifacts=[_artifact(1, path="artifacts/z.mjs"), _artifact(2, path="artifacts/a.mjs")]
    )
    with pytest.raises(ProtocolDeploymentBundleError) as raised:
        validate_protocol_deployment_bundle_manifest(unsorted)
    assert raised.value.code == "HQ_BUNDLE_INVALID_VALUE"

    duplicated = _manifest(
        artifacts=[_artifact(1, path="artifacts/a.mjs"), _artifact(1, path="artifacts/z.mjs")]
    )
    with pytest.raises(ProtocolDeploymentBundleError) as raised:
        validate_protocol_deployment_bundle_manifest(duplicated)
    assert raised.value.code == "HQ_BUNDLE_INVALID_REFERENCE"


def test_a_manifest_may_declare_no_artifacts() -> None:
    """A dataset-only bundle references no runtime artifacts at all."""

    manifest = validate_protocol_deployment_bundle_manifest(_manifest(artifacts=[]))

    assert manifest["artifacts"] == []


def test_source_block_rules() -> None:
    def source(**overrides: object) -> dict[str, object]:
        block: dict[str, object] = {
            "root": "src",
            "entrypoint": "api.ts",
            "files": [{"path": "api.ts", "sha256": "3" * 64, "byteLength": 10}],
        }
        block.update(overrides)
        return block

    assert validate_protocol_deployment_bundle_manifest(_manifest(source=source()))
    # An empty source file is legitimate; an empty deployment file is not.
    assert validate_protocol_deployment_bundle_manifest(
        _manifest(source=source(files=[{"path": "api.ts", "sha256": "3" * 64, "byteLength": 0}]))
    )

    cases: list[tuple[dict[str, object], str]] = [
        (source(entrypoint="missing.ts"), "HQ_BUNDLE_INVALID_REFERENCE"),
        (source(files=[]), "HQ_BUNDLE_INVALID_REFERENCE"),
        (
            source(
                entrypoint="a.ts",
                files=[
                    {"path": "z.ts", "sha256": "3" * 64, "byteLength": 1},
                    {"path": "a.ts", "sha256": "4" * 64, "byteLength": 1},
                ],
            ),
            "HQ_BUNDLE_INVALID_VALUE",
        ),
        (
            source(
                entrypoint="a.ts",
                files=[
                    {"path": "A.ts", "sha256": "3" * 64, "byteLength": 1},
                    {"path": "a.ts", "sha256": "4" * 64, "byteLength": 1},
                ],
            ),
            "HQ_BUNDLE_INVALID_REFERENCE",
        ),
    ]
    for block, code in cases:
        with pytest.raises(ProtocolDeploymentBundleError) as raised:
            validate_protocol_deployment_bundle_manifest(_manifest(source=block))
        assert raised.value.code == code


@pytest.mark.parametrize(
    ("branch", "valid"),
    [
        ("main", True),
        ("feat/x", True),
        ("release-1.2", True),
        ("", False),
        ("-x", False),
        ("a..b", False),
        ("a.lock", False),
        ("a@{b", False),
        ("a~b", False),
        ("a/", False),
        ("a b", False),
    ],
)
def test_git_branch_names_follow_git_reference_rules(branch: str, valid: bool) -> None:
    manifest = _manifest(
        source={
            "root": "src",
            "entrypoint": "api.ts",
            "files": [{"path": "api.ts", "sha256": "3" * 64, "byteLength": 1}],
            "revision": {"kind": "git", "commit": "a" * 40, "dirty": False, "branch": branch},
        }
    )
    if valid:
        assert validate_protocol_deployment_bundle_manifest(manifest)
        return
    with pytest.raises(ProtocolDeploymentBundleError) as raised:
        validate_protocol_deployment_bundle_manifest(manifest)
    assert raised.value.code == "HQ_BUNDLE_INVALID_VALUE"


def test_bundle_limits_may_be_lowered_but_not_raised() -> None:
    lowered = ProtocolDeploymentBundleLimits(max_artifacts=1)

    assert validate_protocol_deployment_bundle_manifest(_manifest(), limits=lowered)
    with pytest.raises(ProtocolDeploymentBundleError) as raised:
        validate_protocol_deployment_bundle_manifest(
            _manifest(
                artifacts=[
                    _artifact(1, path="artifacts/a.mjs"),
                    _artifact(2, path="artifacts/z.mjs"),
                ]
            ),
            limits=lowered,
        )
    assert raised.value.code == "HQ_BUNDLE_TOO_MANY_ITEMS"

    with pytest.raises(ValueError, match="no greater than"):
        ProtocolDeploymentBundleLimits(max_artifacts=101)


# -- release envelope ------------------------------------------------------


@pytest.mark.parametrize(
    ("release", "code"),
    [
        (_release(kind="nope"), "HQ_RELEASE_INVALID_VALUE"),
        (_release(kind=1), "HQ_RELEASE_TYPE"),
        (_release(version=2), "HQ_RELEASE_INVALID_VERSION"),
        ({**_release(), "extra": 1}, "HQ_RELEASE_UNKNOWN_FIELD"),
        (_release(bundleIdentity="bad"), "HQ_RELEASE_INVALID_VALUE"),
        (_release(bundleIdentity="A" * 64), "HQ_RELEASE_INVALID_VALUE"),
        (_release(bundleIdentity=1), "HQ_RELEASE_TYPE"),
        (
            _release(target={"project": "p", "environment": "e", "extra": 1}),
            "HQ_RELEASE_UNKNOWN_FIELD",
        ),
        (_release(target={"project": "p"}), "HQ_RELEASE_TYPE"),
        (_release(target=[]), "HQ_RELEASE_TYPE"),
        (_release(target={"project": "", "environment": "e"}), "HQ_RELEASE_INVALID_VALUE"),
        (_release(target={"project": "-p", "environment": "e"}), "HQ_RELEASE_INVALID_VALUE"),
        (_release(target={"project": "a/b", "environment": "e"}), "HQ_RELEASE_INVALID_VALUE"),
        (_release(target={"project": "a b", "environment": "e"}), "HQ_RELEASE_INVALID_VALUE"),
        (_release(target={"project": "p" + "a" * 128, "environment": "e"}), "HQ_RELEASE_TOO_LARGE"),
    ],
)
def test_release_envelope_rules(release: dict[str, object], code: str) -> None:
    with pytest.raises(ProtocolDeploymentReleaseError) as raised:
        validate_protocol_deployment_release_envelope(release)
    assert raised.value.code == code


@pytest.mark.parametrize("project", ["a:b", "a.b", "a_b", "a-b", "p" + "a" * 127])
def test_target_tokens_accept_the_documented_alphabet(project: str) -> None:
    envelope = validate_protocol_deployment_release_envelope(
        _release(target={"project": project, "environment": "production"})
    )

    assert cast(dict[str, object], envelope["target"])["project"] == project


def test_retrying_an_unchanged_envelope_preserves_its_identity() -> None:
    """Identity is an idempotency key, so it must not carry hidden state."""

    first = prepare_protocol_deployment_release_envelope(_release())
    second = prepare_protocol_deployment_release_envelope(_release())

    assert first.identity == second.identity

    # Changing any part of the target changes the release.
    other = prepare_protocol_deployment_release_envelope(
        _release(target={"project": "project_1", "environment": "staging"})
    )
    assert other.identity != first.identity


def test_release_limits_may_be_lowered_but_not_raised() -> None:
    lowered = ProtocolDeploymentReleaseLimits(max_target_bytes=8)

    assert validate_protocol_deployment_release_envelope(
        _release(target={"project": "abcdefgh", "environment": "e"}), limits=lowered
    )
    with pytest.raises(ProtocolDeploymentReleaseError) as raised:
        validate_protocol_deployment_release_envelope(
            _release(target={"project": "abcdefghi", "environment": "e"}), limits=lowered
        )
    assert raised.value.code == "HQ_RELEASE_TOO_LARGE"

    with pytest.raises(ValueError, match="no greater than"):
        ProtocolDeploymentReleaseLimits(max_target_bytes=129)
