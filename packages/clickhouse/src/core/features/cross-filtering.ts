//@ts-

import { QueryBuilder } from '../query-builder.js';
import { CrossFilter, FilterGroup } from '../cross-filter.js';
import { FilterConditionInput, ColumnType, TableColumn } from '../../types/index.js';

/**
 * Type guard to check if an object is a FilterConditionInput
 */
function isFilterCondition(obj: any): obj is FilterConditionInput<any, any, any> {
  return obj && 'column' in obj && 'operator' in obj && 'value' in obj;
}

/**
 * Type guard to check if an object is a FilterGroup
 */
function isFilterGroup(obj: any): obj is FilterGroup<any, any> {
  return obj && 'conditions' in obj && 'operator' in obj;
}

/**
 * Feature for handling cross-filter operations on queries
 */
export class CrossFilteringFeature<
  Schema,
  T,
  HasSelect extends boolean = false,
  Aggregations = {},
  OriginalT = T
> {
  constructor(private builder: QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT>) { }

  /**
   * Applies a set of cross filters to the query
   * @param crossFilter - An instance of CrossFilter containing shared filter conditions
   * @returns Updated query config
   */
  applyCrossFilters(crossFilter: CrossFilter<Schema, keyof Schema>) {
    const filterGroup = crossFilter.getConditions();

    if (filterGroup.conditions.length === 0) {
      return this.builder.getConfig();
    }

    // Apply conditions based on filter group operator
    if (filterGroup.operator === 'AND') {
      // For AND groups, apply each condition directly
      this.applyAndConditions(filterGroup.conditions);
    } else {
      // For OR groups, special handling to ensure proper parentheses
      // We use whereGroup instead of orWhereGroup here since this is a top-level group
      this.builder.whereGroup(builder => {
        this.applyOrConditions(filterGroup.conditions, builder);
      });
    }

    return this.builder.getConfig();
  }

  /**
   * Apply AND conditions - each condition is applied with WHERE
   */
  private applyAndConditions(conditions: Array<FilterConditionInput<any, Schema, any> | FilterGroup<Schema, any>>): void {
    conditions.forEach(condition => {
      if (isFilterCondition(condition)) {
        // Simple condition - apply with WHERE
        this.builder.where(
          condition.column as unknown as keyof OriginalT | TableColumn<Schema>,
          condition.operator,
          condition.value
        );
      } else if (isFilterGroup(condition)) {
        // Nested group
        if (condition.operator === 'AND') {
          // AND subgroup - apply all conditions
          this.builder.whereGroup(builder => {
            const feature = new CrossFilteringFeature(builder);
            feature.applyAndConditions(condition.conditions);
          });
        } else {
          // OR subgroup within AND - needs special parentheses handling
          this.builder.whereGroup(builder => {
            const feature = new CrossFilteringFeature(builder);
            feature.applyOrConditions(condition.conditions, builder);
          });
        }
      }
    });
  }

  /**
   * Apply direct OR conditions without adding extra conjunctions
   * @param conditions The conditions to apply
   * @param builder The builder to apply conditions to, defaults to this.builder
   */
  private applyOrConditions(
    conditions: Array<FilterConditionInput<any, Schema, any> | FilterGroup<Schema, any>>,
    builder: QueryBuilder<Schema, T, HasSelect, Aggregations, OriginalT> = this.builder
  ): void {
    if (conditions.length === 0) return;

    // Handle first condition
    const firstCondition = conditions[0];
    if (isFilterCondition(firstCondition)) {
      builder.where(
        firstCondition.column as unknown as keyof OriginalT | TableColumn<Schema>,
        firstCondition.operator,
        firstCondition.value
      );
    } else if (isFilterGroup(firstCondition)) {
      // Handle nested group
      if (firstCondition.operator === 'AND') {
        builder.whereGroup(innerBuilder => {
          const feature = new CrossFilteringFeature(innerBuilder);
          feature.applyAndConditions(firstCondition.conditions);
        });
      } else {
        builder.whereGroup(innerBuilder => {
          const feature = new CrossFilteringFeature(innerBuilder);
          feature.applyOrConditions(firstCondition.conditions, innerBuilder);
        });
      }
    }

    // Handle remaining conditions
    for (let i = 1; i < conditions.length; i++) {
      const condition = conditions[i];
      if (isFilterCondition(condition)) {
        builder.orWhere(
          condition.column as unknown as keyof OriginalT | TableColumn<Schema>,
          condition.operator,
          condition.value
        );
      } else if (isFilterGroup(condition)) {
        if (condition.operator === 'AND') {
          builder.orWhereGroup(innerBuilder => {
            const feature = new CrossFilteringFeature(innerBuilder);
            feature.applyAndConditions(condition.conditions);
          });
        } else {
          builder.orWhereGroup(innerBuilder => {
            const feature = new CrossFilteringFeature(innerBuilder);
            feature.applyOrConditions(condition.conditions, innerBuilder);
          });
        }
      }
    }
  }
}