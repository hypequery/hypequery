//@ts-

import type { BuilderState } from '../types/builder-state.js';
import { QueryBuilder } from '../query-builder.js';
import { CrossFilter, FilterGroup } from '../cross-filter.js';
import { FilterConditionInput } from '../../types/index.js';
import { AnySchema } from '../../types/schema.js';

function isFilterCondition(obj: any): obj is FilterConditionInput<any, any, any> {
  return obj && 'column' in obj && 'operator' in obj && 'value' in obj;
}

function isFilterGroup(obj: any): obj is FilterGroup<any, any> {
  return obj && 'conditions' in obj && 'operator' in obj;
}

export class CrossFilteringFeature<
  Schema extends AnySchema,
  State extends BuilderState<Schema, keyof Schema, any, keyof Schema>
> {
  constructor(private builder: QueryBuilder<Schema, State>) { }

  applyCrossFilters(crossFilter: CrossFilter<Schema, Extract<keyof Schema, string>>) {
    const filterGroup = crossFilter.getConditions();

    if (filterGroup.conditions.length === 0) {
      return this.builder.getConfig();
    }

    if (filterGroup.operator === 'AND') {
      this.applyAndConditions(filterGroup.conditions);
    } else {
      this.builder.whereGroup(builder => {
        this.applyOrConditions(filterGroup.conditions, builder);
      });
    }

    return this.builder.getConfig();
  }

  private applyAndConditions(conditions: Array<FilterConditionInput<any, Schema, any> | FilterGroup<Schema, any>>): void {
    conditions.forEach(condition => {
      if (isFilterCondition(condition)) {
        this.builder.where(
          condition.column as any,
          condition.operator,
          condition.value
        );
      } else if (isFilterGroup(condition)) {
        if (condition.operator === 'AND') {
          this.builder.whereGroup(builder => {
            const feature = new CrossFilteringFeature(builder);
            feature.applyAndConditions(condition.conditions);
          });
        } else {
          this.builder.whereGroup(builder => {
            const feature = new CrossFilteringFeature(builder);
            feature.applyOrConditions(condition.conditions, builder);
          });
        }
      }
    });
  }

  private applyOrConditions(
    conditions: Array<FilterConditionInput<any, Schema, any> | FilterGroup<Schema, any>>,
    builder: QueryBuilder<Schema, State> = this.builder
  ): void {
    if (conditions.length === 0) return;

    const firstCondition = conditions[0];
    if (isFilterCondition(firstCondition)) {
      builder.where(
        firstCondition.column as any,
        firstCondition.operator,
        firstCondition.value
      );
    } else if (isFilterGroup(firstCondition)) {
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

    for (let i = 1; i < conditions.length; i++) {
      const condition = conditions[i];
      if (isFilterCondition(condition)) {
        builder.orWhere(
          condition.column as any,
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
