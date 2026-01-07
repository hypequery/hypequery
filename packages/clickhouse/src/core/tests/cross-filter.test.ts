import { CrossFilter, FilterGroup } from '../cross-filter.js';
import { FilterConditionInput, FilterOperator } from '../../types/filters.js';

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

    it('should support nested groups with complex structure', () => {
      // Create a filter with nested groups
      const crossFilter = new CrossFilter();

      // Create an inner group with AND logic (price between 100 and 200)
      const innerGroup: FilterGroup = {
        operator: 'AND',
        conditions: [
          { column: 'price', operator: 'gte', value: 100 },
          { column: 'price', operator: 'lte', value: 200 }
        ]
      };

      // Create another inner group with OR logic (status is active OR pending)
      const statusGroup: FilterGroup = {
        operator: 'OR',
        conditions: [
          { column: 'status', operator: 'eq', value: 'active' },
          { column: 'status', operator: 'eq', value: 'pending' }
        ]
      };

      // Add a group with OR logic between:
      // 1. region is North
      // 2. price is between 100 and 200 (inner AND group)
      // 3. status is active OR pending (inner OR group)
      crossFilter.addGroup([
        { column: 'region', operator: 'eq', value: 'North' },
        innerGroup,
        statusGroup
      ], 'OR');

      // Verify the in-memory structure is correct
      const result = crossFilter.getConditions();
      expect(result.conditions).toHaveLength(1);

      const outerGroup = result.conditions[0] as FilterGroup;
      expect(outerGroup.operator).toBe('OR');
      expect(outerGroup.conditions).toHaveLength(3);

      // Verify the first condition is a simple equality
      const firstCondition = outerGroup.conditions[0] as FilterConditionInput;
      expect(firstCondition.column).toBe('region');
      expect(firstCondition.operator).toBe('eq');
      expect(firstCondition.value).toBe('North');

      // Verify the second condition is a nested AND group for price range
      const priceGroup = outerGroup.conditions[1] as FilterGroup;
      expect(priceGroup.operator).toBe('AND');
      expect(priceGroup.conditions).toHaveLength(2);
      expect((priceGroup.conditions[0] as FilterConditionInput).column).toBe('price');
      expect((priceGroup.conditions[0] as FilterConditionInput).operator).toBe('gte');
      expect((priceGroup.conditions[0] as FilterConditionInput).value).toBe(100);
      expect((priceGroup.conditions[1] as FilterConditionInput).column).toBe('price');
      expect((priceGroup.conditions[1] as FilterConditionInput).operator).toBe('lte');
      expect((priceGroup.conditions[1] as FilterConditionInput).value).toBe(200);

      // Verify the third condition is a nested OR group for status
      const statusGroupResult = outerGroup.conditions[2] as FilterGroup;
      expect(statusGroupResult.operator).toBe('OR');
      expect(statusGroupResult.conditions).toHaveLength(2);
      expect((statusGroupResult.conditions[0] as FilterConditionInput).column).toBe('status');
      expect((statusGroupResult.conditions[0] as FilterConditionInput).operator).toBe('eq');
      expect((statusGroupResult.conditions[0] as FilterConditionInput).value).toBe('active');
      expect((statusGroupResult.conditions[1] as FilterConditionInput).column).toBe('status');
      expect((statusGroupResult.conditions[1] as FilterConditionInput).operator).toBe('eq');
      expect((statusGroupResult.conditions[1] as FilterConditionInput).value).toBe('pending');
    });

    // Original test can remain for structural checks only
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

    it('should validate only the provided table when schema and table name are passed', () => {
      const schema = {
        orders: {
          total: 'Float64' as const,
          status: 'String' as const
        },
        drivers: {
          name: 'String' as const
        }
      };

      const typedFilter = new CrossFilter(schema, 'orders');

      expect(() => typedFilter.add({ column: 'total', operator: 'gt', value: 100 })).not.toThrow();
      expect(() => typedFilter.add({ column: 'status', operator: 'eq', value: 'active' })).not.toThrow();
      expect(() => typedFilter.add({ column: 'name', operator: 'eq', value: 'Jamal' })).toThrow("Column 'name' not found in schema");
    });
  });

  describe('topN', () => {
    const schema = {
      test_table: {
        price: 'Float64' as const,
        quantity: 'Int32' as const,
        name: 'String' as const
      }
    };

    let typedFilter: CrossFilter<typeof schema, 'test_table'>;

    beforeEach(() => {
      typedFilter = new CrossFilter(schema);
    });

    it('should create a filter for top N records', () => {
      typedFilter.topN('price', 5);
      const result = typedFilter.getConditions();

      // Check the filter condition
      const condition = result.conditions[0] as FilterConditionInput;
      expect(condition.column).toBe('price');
      expect(condition.operator).toBe('gt');
      expect(condition.value).toBe(0);

      // Check limit and order
      expect(result.limit).toBe(5);
      expect(result.orderBy).toEqual({
        column: 'price',
        direction: 'DESC'
      });
    });

    it('should allow ascending order', () => {
      typedFilter.topN('quantity', 10, 'asc');
      const result = typedFilter.getConditions();

      expect(result.limit).toBe(10);
      expect(result.orderBy).toEqual({
        column: 'quantity',
        direction: 'ASC'
      });
    });

    it('should default to descending order', () => {
      typedFilter.topN('price', 3);
      const result = typedFilter.getConditions();

      expect(result.orderBy?.direction).toBe('DESC');
    });

    it('should maintain type safety for column names', () => {
      // These should type check
      typedFilter.topN('price', 5);
      typedFilter.topN('quantity', 10, 'asc');

      // This should fail type checking
      // @ts-expect-error - invalid column
      const _unused = () => typedFilter.topN('invalid_column', 5);
    });
  });
});
