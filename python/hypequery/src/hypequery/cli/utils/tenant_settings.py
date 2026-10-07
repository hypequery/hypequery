"""Notice tenant settings that a forced regeneration is about to drop."""

from __future__ import annotations

import ast

_SETTING = "tenant_key"


def configures_tenant(source: str) -> bool:
    """Best-effort check for visible tenant_key settings; used only to warn.

    Generated definitions never set tenant_key, so --force removes any the
    author added. Authored code is not executed: settings built indirectly may
    go unnoticed, and a physical column named tenant_key is not a setting.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return False
    return any(
        (
            isinstance(node, ast.keyword)
            and node.arg == _SETTING
            and not (isinstance(node.value, ast.Constant) and node.value.value is None)
        )
        or (isinstance(node, ast.Attribute) and node.attr == _SETTING)
        or (isinstance(node, ast.Dict) and any(_is_setting(key) for key in node.keys))
        or (isinstance(node, ast.Subscript) and _is_setting(node.slice))
        for node in ast.walk(tree)
    )


def _is_setting(node: ast.AST | None) -> bool:
    return isinstance(node, ast.Constant) and node.value == _SETTING
