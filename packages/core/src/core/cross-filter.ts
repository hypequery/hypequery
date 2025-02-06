// This file defines the CrossFilter class for centralizing shared filter criteria.

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'in'
  | 'notIn'
  | 'between'
  | 'like';

export type FilterCondition = {
  column: string;
  operator: FilterOperator;
  value: any;
};

export class CrossFilter {
  private conditions: FilterCondition[] = [];

  /**
   * Adds a single filter condition.
   */
  add(condition: FilterCondition): this {
    this.conditions.push(condition);
    return this;
  }

  /**
   * Adds multiple filter conditions at once.
   */
  addMultiple(conditions: FilterCondition[]): this {
    this.conditions.push(...conditions);
    return this;
  }

  /**
   * Returns the current filter conditions.
   */
  getConditions(): FilterCondition[] {
    return this.conditions;
  }
}