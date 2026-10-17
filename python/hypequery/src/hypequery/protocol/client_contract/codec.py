"""Domain-separated client identities."""

import hashlib

from .safe_data import client_canonical

CLIENT_CONTRACT_DOMAIN = "hypequery:client-contract:v1\0"
CLIENT_SCHEMA_DOMAIN = "hypequery:client-endpoint-schema:v1\0"


def client_digest(domain: str, value: object) -> str:
    return hashlib.sha256((domain + client_canonical(value)).encode("utf-8")).hexdigest()
