"""Reserved internal aliases used by semantic compilation."""

from .identifiers import SafeIdentifier

PERIOD_ALIAS = SafeIdentifier("period")
BASE_ALIAS = SafeIdentifier("__hq_base")
#: A resolved (FINAL) source read inside a join or a key check, so its current-row
#: column is never mistaken for an output alias of the same name (RFC 0021).
RESOLVED_ALIAS = SafeIdentifier("__hq_resolved")
