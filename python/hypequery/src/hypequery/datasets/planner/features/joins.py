"""Relationship joins: one single-match join per relationship, tenant-scoped."""

from __future__ import annotations

from typing import TYPE_CHECKING

from ...dataset import Dataset
from ...derived_measures import DerivedMeasure
from ...relationships import Relationship
from ..aliases import BASE_ALIAS
from ..identifiers import SafeIdentifier, safe_identifier, safe_qualified_identifier
from ..predicates import tenant_predicate
from ..query_node import JoinNode
from ..query_validation import resolve_tenant_scope
from ..resolution import is_qualified, physical_column, resolve_qualified_field
from .base import CompilerFeature

if TYPE_CHECKING:
    from ..compiler import DatasetQueryCompiler

_MATCH_MARKER = "_hq_match"


class JoinFeature(CompilerFeature):
    """Adds each relationship's join once and remembers how to read a match."""

    __slots__ = ("_joined", "_measure_relationships", "match_markers")

    def __init__(self, compiler: DatasetQueryCompiler) -> None:
        super().__init__(compiler)
        self._joined: set[str] = set()
        # A relationship whose target measures are selected joins through a
        # projection carrying a match marker; see `_measure_join_source`.
        self._measure_relationships = {
            name.partition(".")[0] for name in compiler.query.measures or () if is_qualified(name)
        }
        self.match_markers: dict[str, SafeIdentifier] = {}

    def joined_column(self, name: str) -> str:
        """The joined column a qualified field selects, adding its join once."""

        compiler = self.compiler
        resolved = resolve_qualified_field(compiler.dataset, name, registry=compiler.registry)
        alias = self.ensure(resolved.relationship_name, resolved.relationship, resolved.target)
        column = physical_column(resolved.target, resolved.dimension_name)
        return f"{alias.sql}.{safe_identifier(column, what='column').sql}"

    def ensure(
        self, relationship_name: str, relationship: Relationship, target: Dataset
    ) -> SafeIdentifier:
        """Add the single-match LEFT ANY JOIN a relationship needs, once."""

        alias = safe_identifier(relationship_name, what="relationship name")
        if relationship_name in self._joined:
            return alias
        self._joined.add(relationship_name)
        if relationship_name in self._measure_relationships:
            target_source = self._measure_join_source(relationship_name, target)
        else:
            target_source = safe_qualified_identifier(target.source, what="dataset source").sql
        # A composite key is an AND of equalities; a NULL component never matches.
        condition = " AND ".join(
            f"{BASE_ALIAS.sql}."
            f"{safe_identifier(key.from_field, what='relationship from field').sql}"
            f" = {alias.sql}.{safe_identifier(key.to_field, what='relationship to field').sql}"
            for key in relationship.key_pairs
        )
        # The joined dataset carries its own tenancy, so the predicate goes into
        # the join condition rather than WHERE: in a LEFT ANY JOIN a WHERE predicate
        # on the right side would silently turn it into an inner join.
        target_scope = resolve_tenant_scope(target, self.compiler.context)
        if target_scope is not None and target.tenant_key is not None:
            tenant_column = safe_identifier(target.tenant_key, what="tenant key")
            condition += " AND " + tenant_predicate(
                self.compiler.binder, f"{alias.sql}.{tenant_column.sql}", target_scope
            )
        self.compiler.node.joins.append(JoinNode(target_source, alias, condition))
        return alias

    def _measure_join_source(self, relationship_name: str, target: Dataset) -> str:
        """The target as a projection whose marker is non-null only on a match.

        Without `join_use_nulls`, an unmatched LEFT JOIN row carries column
        defaults such as `0` and `''`, which `min` or `countDistinct` would
        count. The marker is the one value that tells a match from a default,
        and an explicit projection keeps it from colliding with a target column.
        """

        compiler = self.compiler
        relationship = compiler.dataset.relationships[relationship_name]
        columns = [key.to_field for key in relationship.key_pairs]
        if target.tenant_key is not None:
            columns.append(target.tenant_key)
        for name, dimension in target.dimensions.items():
            if dimension.sql is None:
                columns.append(physical_column(target, name))
        for name in compiler.query.measures or ():
            owner, _, measure_name = name.partition(".")
            if owner != relationship_name or measure_name not in target.measures:
                continue
            measure = target.measures[measure_name]
            if isinstance(measure, DerivedMeasure):
                continue
            columns.extend(
                physical_column(target, field)
                for field in (measure.field, measure.arg_field)
                if field is not None
            )
        unique = list(dict.fromkeys(columns))
        marker = _MATCH_MARKER
        while marker in unique:
            marker += "_"
        self.match_markers[relationship_name] = safe_identifier(marker, what="match marker")
        projection = [safe_identifier(column, what="column").sql for column in unique]
        projection.append(f"toNullable(1) AS {self.match_markers[relationship_name].sql}")
        source = safe_qualified_identifier(target.source, what="dataset source")
        # Every part is a validated identifier or a constant; no value reaches it.
        return f"(SELECT {', '.join(projection)} FROM {source.sql})"  # noqa: S608
