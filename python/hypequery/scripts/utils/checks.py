"""Verification failures remain active even when Python uses optimized mode."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)
