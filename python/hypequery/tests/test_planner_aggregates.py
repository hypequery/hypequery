"""AggregateCall builds conditional aggregates from structure, not text."""

from __future__ import annotations

from hypequery.datasets.planner.aggregates import AggregateCall


def test_plain_aggregate_renders_and_takes_a_condition() -> None:
    call = AggregateCall("sum", ("`amount`",))
    assert call.sql == "sum(`amount`)"
    assert call.with_condition("`paid`").sql == "sumIf(`amount`, `paid`)"


def test_parametric_aggregate_keeps_parameters_apart_from_arguments() -> None:
    call = AggregateCall("quantile", ("`amount`",), ("0.9",))
    assert call.sql == "quantile(0.9)(`amount`)"
    assert call.with_condition("`paid`").sql == "quantileIf(0.9)(`amount`, `paid`)"


def test_arguments_containing_parentheses_are_untouched() -> None:
    # The string rewrite this replaced split on the first parenthesis.
    call = AggregateCall("argMax", ("if(`m`, `a`.`tier`, NULL)", "if(`m`, `a`.`v`, NULL)"))
    assert call.with_condition("(`x` = {p0:String})").sql == (
        "argMaxIf(if(`m`, `a`.`tier`, NULL), if(`m`, `a`.`v`, NULL), (`x` = {p0:String}))"
    )
