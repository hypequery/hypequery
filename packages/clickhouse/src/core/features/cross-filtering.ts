
import type { BuilderState, SchemaDefinition } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import { CrossFilter, type FilterGroup } from '../cross-filter.js';
import type { FilterConditionInput } from '../../types/index.js';

type CrossFilterNode<Schema extends SchemaDefinition<Schema>> =
  | FilterConditionInput<any, Schema, any>
  | FilterGroup<Schema, any>;

function isFilterCondition<Schema extends SchemaDefinition<Schema>>(
  node: CrossFilterNode<Schema>
): node is FilterConditionInput<any, Schema, any> {
  return 'column' in node;
}

export class CrossFilteringFeature<
  Schema extends SchemaDefinition<Schema>,
  State extends BuilderState<Schema, string, any, keyof Schema, Partial<Record<string, keyof Schema>>>
> {
  constructor(private builder: QueryBuilder<Schema, State>) { }

  applyCrossFilters(crossFilter: CrossFilter<Schema, Extract<keyof Schema, string>>) {
    const root = crossFilter.getConditions();

    if (root.conditions.length === 0) {
      return this.builder;
    }

    return root.operator === 'AND'
      ? this.applyAndConditions(this.builder, root.conditions)
      : this.builder.whereGroup(groupBuilder => this.applyOrConditions(groupBuilder, root.conditions));
  }

  private applyAndConditions(
    builder: QueryBuilder<Schema, State>,
    conditions: CrossFilterNode<Schema>[]
  ): QueryBuilder<Schema, State> {
    return conditions.reduce((currentBuilder, condition) => {
      if (isFilterCondition(condition)) {
        return currentBuilder.where(condition.column, condition.operator, condition.value);
      }

      return condition.operator === 'AND'
        ? currentBuilder.whereGroup(groupBuilder => this.applyAndConditions(groupBuilder, condition.conditions))
        : currentBuilder.whereGroup(groupBuilder => this.applyOrConditions(groupBuilder, condition.conditions));
    }, builder);
  }

  private applyOrConditions(
    builder: QueryBuilder<Schema, State>,
    conditions: CrossFilterNode<Schema>[]
  ): QueryBuilder<Schema, State> {
    return conditions.reduce((currentBuilder, condition, index) => {
      if (isFilterCondition(condition)) {
        return index === 0
          ? currentBuilder.where(condition.column, condition.operator, condition.value)
          : currentBuilder.orWhere(condition.column, condition.operator, condition.value);
      }

      if (condition.operator === 'AND') {
        return index === 0
          ? currentBuilder.whereGroup(groupBuilder => this.applyAndConditions(groupBuilder, condition.conditions))
          : currentBuilder.orWhereGroup(groupBuilder => this.applyAndConditions(groupBuilder, condition.conditions));
      }

      return index === 0
        ? currentBuilder.whereGroup(groupBuilder => this.applyOrConditions(groupBuilder, condition.conditions))
        : currentBuilder.orWhereGroup(groupBuilder => this.applyOrConditions(groupBuilder, condition.conditions));
    }, builder);
  }
}
