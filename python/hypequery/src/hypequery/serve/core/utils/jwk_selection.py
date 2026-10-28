"""Choose the JSON Web Key that verifies a token, as jose's `createLocalJWKSet` does."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

#: The curve each ECDSA and EdDSA algorithm requires of its key.
_CURVES: Mapping[str, tuple[str, ...]] = {
    "ES256": ("P-256",),
    "ES384": ("P-384",),
    "ES512": ("P-521",),
    "EdDSA": ("Ed25519", "Ed448"),
}


def key_type_for(alg: str) -> str | None:
    """The JWK `kty` an asymmetric *alg* verifies with, or None when it has none."""

    prefix = alg[:2]
    if prefix in ("RS", "PS"):
        return "RSA"
    if prefix == "ES":
        return "EC"
    if prefix == "Ed":
        return "OKP"
    return None


def _usable(jwk: Mapping[str, Any], alg: str, kty: str, kid: object) -> bool:
    if jwk.get("kty") != kty:
        return False
    if type(kid) is str and jwk.get("kid") != kid:
        return False
    if type(jwk.get("alg")) is str and jwk["alg"] != alg:
        return False
    if type(jwk.get("use")) is str and jwk["use"] != "sig":
        return False
    key_ops = jwk.get("key_ops")
    if type(key_ops) is list and "verify" not in key_ops:
        return False
    curves = _CURVES.get(alg)
    return curves is None or jwk.get("crv") in curves


def matching_keys(
    keys: Sequence[Mapping[str, Any]], alg: str, kid: object
) -> list[Mapping[str, Any]]:
    """The keys in a key set that may verify a token signed with *alg*.

    A key matches when its type fits *alg* and, where each is present, its
    `kid` equals the token's, its `alg` equals *alg*, its `use` is `sig`,
    its `key_ops` include `verify` and its curve fits *alg*. The caller
    refreshes the set when none match, and refuses the token when more than
    one does, as jose does.
    """

    kty = key_type_for(alg)
    if kty is None:
        return []
    return [jwk for jwk in keys if _usable(jwk, alg, kty, kid)]


def has_private_material(jwk: Mapping[str, Any]) -> bool:
    """Whether *jwk* carries private or symmetric key material.

    A published key set holds public keys only; jose refuses one that does not.
    """

    return any(member in jwk for member in ("d", "p", "q", "k"))
