"""Refuse regeneration that could erase configured tenant boundaries.

Authored code is never executed. Instead, replacement is allowed only when the
file is provably tenant-free: every way to set ``tenant_key`` must be visible
in the syntax tree, so anything that could supply a setting name indirectly
(unpacking, validation from mappings, reflection, project-local imports) fails
closed. Generated definitions use none of these forms.
"""

from __future__ import annotations

import ast
import sys

from ..errors import CliError

_SETTING = "tenant_key"

# Generated definitions mention a physical table or column named tenant_key
# only as these plain values, never as a dataset setting.
_VALUE_KEYWORDS = frozenset({"column", "name", "source"})

# Callables that build or modify models from mappings or computed names. These
# are matched as names and attributes, not strings: generated field names (a
# column called "eval" or "vars") are ordinary mapping keys. Name-based callers
# such as methodcaller("model_validate") are refused through the caller itself.
_INDIRECT = frozenset(
    {
        "__dict__",
        "__getattribute__",
        "__import__",
        "__setattr__",
        "attrgetter",
        "compile",
        "eval",
        "exec",
        "getattr",
        "globals",
        "import_module",
        "locals",
        "methodcaller",
        "model_construct",
        "model_copy",
        "model_validate",
        "model_validate_json",
        "model_validate_strings",
        "run_module",
        "run_path",
        "setattr",
        "validate_json",
        "validate_python",
        "validate_strings",
        "vars",
    }
)


def has_tenant_configuration(source: str) -> bool:
    """True when definitions configure, or may indirectly configure, tenant_key."""
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        raise CliError(
            "Cannot verify existing definitions; repair their Python syntax first."
        ) from exc
    exempt = _plain_values(tree)
    return any(_unsafe(node, exempt) for node in ast.walk(tree))


def ensure_replaceable(source: str) -> None:
    if has_tenant_configuration(source):
        raise CliError(
            "Refusing to replace definitions that configure tenant_key or set dataset "
            "options indirectly. Generate to a separate file and merge schema changes "
            "while preserving tenant boundaries."
        )


def _plain_values(tree: ast.AST) -> set[int]:
    """Constants that name tables or columns rather than dataset settings."""
    exempt: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.keyword) and node.arg in _VALUE_KEYWORDS:
            exempt.add(id(node.value))
        elif isinstance(node, ast.Dict):
            # {"tenant_key": dataset(...)} keys a dataset by its table name.
            for key, value in zip(node.keys, node.values, strict=True):
                if (
                    isinstance(value, ast.Call)
                    and isinstance(value.func, ast.Name)
                    and value.func.id == "dataset"
                ):
                    exempt.add(id(key))
    return exempt


def _unsafe(node: ast.AST, exempt: set[int]) -> bool:
    if isinstance(node, ast.keyword):
        if node.arg is None:  # **settings cannot be inspected statically.
            return True
        return node.arg == _SETTING and not (
            isinstance(node.value, ast.Constant) and node.value.value is None
        )
    if isinstance(node, ast.Dict):
        return None in node.keys  # {**settings}
    if isinstance(node, ast.Attribute):
        return node.attr == _SETTING or node.attr in _INDIRECT
    if isinstance(node, ast.Name):
        # Class defaults, module variables and computed indirection.
        return node.id == _SETTING or node.id in _INDIRECT
    if isinstance(node, ast.arg):
        return node.arg == _SETTING
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        if id(node) in exempt:
            return False
        # Covers mapping keys, subscripts and serialized settings such as JSON.
        return _SETTING in node.value
    if isinstance(node, ast.ImportFrom):
        return node.level > 0 or not _trusted_module(node.module or "")
    if isinstance(node, ast.Import):
        return not all(_trusted_module(alias.name) for alias in node.names)
    return False


def _trusted_module(name: str) -> bool:
    """Project-local modules may supply pre-configured datasets."""
    root = name.partition(".")[0]
    return root in {"hypequery", "__future__"} or root in sys.stdlib_module_names
