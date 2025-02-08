import { CrossFilter, FilterGroup } from '../cross-filter';
import { FilterConditionInput, FilterOperator } from '../../types/filters';

describe('CrossFilter', () => {
  let crossFilter: CrossFilter;

  beforeEach(() => {
    crossFilter = new CrossFilter();
  });

  describe('add', () => {
    it('should add a single filter condition', () => {
      const condition: FilterConditionInput = {
        column: 'status',
        operator: 'eq',
        value: 'active'
      };

      crossFilter.add(condition);
      const result = crossFilter.getConditions();
      expect(result.conditions[0]).toEqual(condition);
    });

    it('should return this for method chaining', () => {
      const result = crossFilter.add({
        column: 'status',
        operator: 'eq',
        value: 'active'
      });

      expect(result).toBe(crossFilter);
    });

    it('should handle different operator types', () => {
      crossFilter
        .add({
          column: 'age',
          operator: 'gt',
          value: 18
        })
        .add({
          column: 'status',
          operator: 'in',
          value: ['active', 'pending']
        })
        .add({
          column: 'date',
          operator: 'between',
          value: ['2023-01-01', '2023-12-31']
        });

      const result = crossFilter.getConditions();
      expect(result.conditions).toHaveLength(3);
      expect(result.conditions[0].operator).toBe('gt');
      expect(result.conditions[1].operator).toBe('in');
      expect(result.conditions[2].operator).toBe('between');
    });
  });

  describe('addMultiple', () => {
    it('should add multiple filter conditions', () => {
      const conditions: FilterConditionInput[] = [
        {
          column: 'status',
          operator: 'eq',
          value: 'active'
        },
        {
          column: 'age',
          operator: 'gt',
          value: 18
        }
      ];

      crossFilter.addMultiple(conditions);
      const result = crossFilter.getConditions();
      expect(result.conditions).toHaveLength(2);
      expect(result.conditions).toEqual(conditions);
    });

    it('should return this for method chaining', () => {
      const result = crossFilter.addMultiple([]);
      expect(result).toBe(crossFilter);
    });

    it('should handle empty array', () => {
      crossFilter.addMultiple([]);
      const result = crossFilter.getConditions();
      expect(result.conditions).toHaveLength(0);
    });
  });

  describe('getConditions', () => {
    it('should return empty conditions array when no conditions added', () => {
      const result = crossFilter.getConditions();
      expect(result.conditions).toHaveLength(0);
    });

    it('should return copy of conditions array', () => {
      const condition: FilterConditionInput = {
        column: 'status',
        operator: 'eq',
        value: 'active'
      };

      crossFilter.add(condition);
      const result = crossFilter.getConditions();

      // Modify the copy
      result.conditions.push({
        column: 'test',
        operator: 'eq',
        value: 'test'
      });

      expect(result.conditions).toHaveLength(2);
      expect(result.conditions[0]).toEqual(condition);
    });
  });

  describe('complex filtering scenarios', () => {
    it('should handle date range filters', () => {
      const dateFilter: FilterConditionInput = {
        column: 'created_at',
        operator: 'between',
        value: ['2023-01-01', '2023-12-31']
      };

      crossFilter.add(dateFilter);
      const result = crossFilter.getConditions();
      const condition = result.conditions[0] as FilterConditionInput;
      expect(condition).toEqual(dateFilter);
    });

    it('should handle multiple conditions for same column', () => {
      crossFilter
        .add({
          column: 'price',
          operator: 'gte',
          value: 100
        })
        .add({
          column: 'price',
          operator: 'lte',
          value: 200
        });

      const result = crossFilter.getConditions();
      expect(result.conditions).toHaveLength(2);
      const firstCondition = result.conditions[0] as FilterConditionInput;
      const secondCondition = result.conditions[1] as FilterConditionInput;
      expect(firstCondition.column).toBe('price');
      expect(secondCondition.column).toBe('price');
    });

    it('should handle array values for in operator', () => {
      const inFilter: FilterConditionInput = {
        column: 'status',
        operator: 'in',
        value: ['active', 'pending', 'completed']
      };

      crossFilter.add(inFilter);
      const result = crossFilter.getConditions();
      const condition = result.conditions[0] as FilterConditionInput;
      expect(condition).toEqual(inFilter);
      expect(Array.isArray(condition.value)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle boolean values', () => {
      crossFilter.add({
        column: 'is_active',
        operator: 'eq',
        value: 1
      });

      const result = crossFilter.getConditions();
      const condition = result.conditions[0] as FilterConditionInput;
      expect(condition.value).toBe(1);
    });

    it('should handle numeric values', () => {
      crossFilter.add({
        column: 'count',
        operator: 'gt',
        value: 0
      });

      const result = crossFilter.getConditions();
      const condition = result.conditions[0] as FilterConditionInput;
      expect(typeof condition.value).toBe('number');
    });

    it('should handle null values', () => {
      crossFilter.add({
        column: 'optional_field',
        operator: 'eq',
        value: null
      });

      const result = crossFilter.getConditions();
      const condition = result.conditions[0] as FilterConditionInput;
      expect(condition.value).toBeNull();
    });
  });

  describe('addGroup', () => {
    it('should add a group with AND operator', () => {
      const conditions: FilterConditionInput[] = [
        { column: 'region', operator: 'eq', value: 'North' },
        { column: 'price', operator: 'gt', value: 1000 }
      ];
      crossFilter.addGroup(conditions, 'AND');

      const result = crossFilter.getConditions();
      expect(result.operator).toBe('AND');
      expect(result.conditions).toHaveLength(1);

      const group = result.conditions[0] as FilterGroup;
      expect(group.operator).toBe('AND');
      expect(group.conditions).toEqual(conditions);
    });

    it('should add a group with OR operator', () => {
      const conditions: FilterConditionInput[] = [
        { column: 'status', operator: 'eq', value: 'active' },
        { column: 'region', operator: 'eq', value: 'South' }
      ];
      crossFilter.addGroup(conditions, 'OR');

      const result = crossFilter.getConditions();
      expect(result.conditions).toHaveLength(1);

      const group = result.conditions[0] as FilterGroup;
      expect(group.operator).toBe('OR');
      expect(group.conditions).toEqual(conditions);
    });

    it('should support mixing single conditions and groups', () => {
      // Add a single condition
      crossFilter.add({
        column: 'status',
        operator: 'eq',
        value: 'active'
      });

      // Add a group
      crossFilter.addGroup([
        { column: 'region', operator: 'eq', value: 'North' },
        { column: 'price', operator: 'gt', value: 1000 }
      ], 'AND');

      const result = crossFilter.getConditions();
      expect(result.conditions).toHaveLength(2);
      expect(result.operator).toBe('AND');

      // First condition should be the single condition
      const firstCondition = result.conditions[0] as FilterConditionInput;
      expect(firstCondition.column).toBe('status');

      // Second condition should be the group
      const group = result.conditions[1] as FilterGroup;
      expect(group.operator).toBe('AND');
      expect(group.conditions).toHaveLength(2);
    });

    it('should support nested groups', () => {
      const innerGroup: FilterGroup = {
        operator: 'AND',
        conditions: [
          { column: 'price', operator: 'gte', value: 100 },
          { column: 'price', operator: 'lte', value: 200 }
        ]
      };

      crossFilter.addGroup([
        { column: 'region', operator: 'eq', value: 'North' },
        innerGroup
      ], 'OR');

      const result = crossFilter.getConditions();
      expect(result.conditions).toHaveLength(1);

      const outerGroup = result.conditions[0] as FilterGroup;
      expect(outerGroup.operator).toBe('OR');
      expect(outerGroup.conditions).toHaveLength(2);

      const nestedGroup = outerGroup.conditions[1] as FilterGroup;
      expect(nestedGroup.operator).toBe('AND');
      expect(nestedGroup.conditions).toHaveLength(2);
    });

    it('should maintain type safety with schema validation', () => {
      const schema = {
        test_table: {
          price: 'Float64' as const,
          region: 'String' as const
        }
      };

      const typedFilter = new CrossFilter(schema);

      // This should work with valid types
      typedFilter.addGroup([
        { column: 'price', operator: 'gt', value: 1000 },
        { column: 'region', operator: 'eq', value: 'North' }
      ], 'AND');

      const result = typedFilter.getConditions();
      expect(result.conditions).toHaveLength(1);
    });
  });
});