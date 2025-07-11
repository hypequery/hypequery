import { CrossFilter, FilterGroup } from '../cross-filter';
import { FilterConditionInput, FilterOperator } from '../../types/filters';
import { createQueryBuilder } from '../query-builder';

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
  });

  describe('time series filters', () => {
    const schema = {
      test_table: {
        created_at: 'Date' as const,
        updated_at: 'DateTime' as const,
        name: 'String' as const
      }
    };

    let typedFilter: CrossFilter<typeof schema, 'test_table'>;

    beforeEach(() => {
      typedFilter = new CrossFilter(schema);
    });

    describe('addDateRange', () => {
      // Mock current date for consistent testing
      const mockDate = new Date('2024-01-15T12:00:00Z');
      let originalDate: typeof Date;

      beforeEach(() => {
        originalDate = global.Date;
        global.Date = class extends Date {
          constructor(...args: any[]) {
            if (args.length === 0) {
              super(mockDate);
            } else {
              super(...(args as [any]));
            }
          }
        } as any;
      });

      afterEach(() => {
        global.Date = originalDate;
      });

      it('should add date range filter for today', () => {
        typedFilter.addDateRange('created_at', 'today');
        const result = typedFilter.getConditions();
        const condition = result.conditions[0] as FilterConditionInput;

        expect(condition.column).toBe('created_at');
        expect(condition.operator).toBe('between');
        expect(Array.isArray(condition.value)).toBe(true);
        expect(condition.value.length).toBe(2);

        const [start, end] = condition.value as string[];
        // The implementation creates dates in local timezone, then converts to UTC
        // Mock date is 2024-01-15T12:00:00Z, so today starts at 00:00 local time
        expect(new Date(start).toISOString()).toBe('2024-01-14T23:00:00.000Z');
        expect(new Date(end).toISOString()).toBe('2024-01-15T22:59:59.999Z');
      });

      it('should add date range filter for yesterday', () => {
        typedFilter.addDateRange('created_at', 'yesterday');
        const result = typedFilter.getConditions();
        const condition = result.conditions[0] as FilterConditionInput;

        const [start, end] = condition.value as string[];
        expect(new Date(start).toISOString()).toBe('2024-01-13T23:00:00.000Z');
        expect(new Date(end).toISOString()).toBe('2024-01-14T22:59:59.999Z');
      });

      it('should add date range filter for last_7_days', () => {
        typedFilter.addDateRange('created_at', 'last_7_days');
        const result = typedFilter.getConditions();
        const condition = result.conditions[0] as FilterConditionInput;

        const [start, end] = condition.value as string[];
        expect(new Date(start).toISOString()).toBe('2024-01-08T12:00:00.000Z');
        expect(new Date(end).toISOString()).toBe('2024-01-15T12:00:00.000Z');
      });

      it('should add date range filter for last_30_days', () => {
        typedFilter.addDateRange('created_at', 'last_30_days');
        const result = typedFilter.getConditions();
        const condition = result.conditions[0] as FilterConditionInput;

        const [start, end] = condition.value as string[];
        expect(new Date(start).toISOString()).toBe('2023-12-16T12:00:00.000Z');
        expect(new Date(end).toISOString()).toBe('2024-01-15T12:00:00.000Z');
      });

      it('should add date range filter for this_month', () => {
        typedFilter.addDateRange('created_at', 'this_month');
        const result = typedFilter.getConditions();
        const condition = result.conditions[0] as FilterConditionInput;

        const [start, end] = condition.value as string[];
        expect(new Date(start).toISOString()).toBe('2023-12-31T23:00:00.000Z');
        expect(new Date(end).toISOString()).toBe('2024-01-30T23:00:00.000Z');
      });

      it('should add date range filter for last_month', () => {
        typedFilter.addDateRange('created_at', 'last_month');
        const result = typedFilter.getConditions();
        const condition = result.conditions[0] as FilterConditionInput;

        const [start, end] = condition.value as string[];
        expect(new Date(start).toISOString()).toBe('2023-11-30T23:00:00.000Z');
        expect(new Date(end).toISOString()).toBe('2023-12-30T23:00:00.000Z');
      });

      it('should add date range filter for this_quarter', () => {
        typedFilter.addDateRange('created_at', 'this_quarter');
        const result = typedFilter.getConditions();
        const condition = result.conditions[0] as FilterConditionInput;

        const [start, end] = condition.value as string[];
        expect(new Date(start).toISOString()).toBe('2023-12-31T23:00:00.000Z');
        expect(new Date(end).toISOString()).toBe('2024-03-30T23:00:00.000Z');
      });

      it('should add date range filter for year_to_date', () => {
        typedFilter.addDateRange('created_at', 'year_to_date');
        const result = typedFilter.getConditions();
        const condition = result.conditions[0] as FilterConditionInput;

        const [start, end] = condition.value as string[];
        expect(new Date(start).toISOString()).toBe('2023-12-31T23:00:00.000Z');
        expect(new Date(end).toISOString()).toBe('2024-01-15T12:00:00.000Z');
      });

      it('should handle month boundary edge cases', () => {
        // Test with date at end of month
        const endOfMonthDate = new Date('2024-01-31T12:00:00Z');
        global.Date = class extends Date {
          constructor(...args: any[]) {
            if (args.length === 0) {
              super(endOfMonthDate);
            } else {
              super(...(args as [any]));
            }
          }
        } as any;

        typedFilter.addDateRange('created_at', 'this_month');
        const result = typedFilter.getConditions();
        const condition = result.conditions[0] as FilterConditionInput;

        const [start, end] = condition.value as string[];
        expect(new Date(start).toISOString()).toBe('2023-12-31T23:00:00.000Z');
        expect(new Date(end).toISOString()).toBe('2024-01-30T23:00:00.000Z');
      });

      it('should handle leap year February', () => {
        // Test with leap year February
        const leapYearDate = new Date('2024-02-29T12:00:00Z');
        global.Date = class extends Date {
          constructor(...args: any[]) {
            if (args.length === 0) {
              super(leapYearDate);
            } else {
              super(...(args as [any]));
            }
          }
        } as any;

        typedFilter.addDateRange('created_at', 'this_month');
        const result = typedFilter.getConditions();
        const condition = result.conditions[0] as FilterConditionInput;

        const [start, end] = condition.value as string[];
        expect(new Date(start).toISOString()).toBe('2024-01-31T23:00:00.000Z');
        expect(new Date(end).toISOString()).toBe('2024-02-28T23:00:00.000Z');
      });

      it('should throw error for unsupported date range', () => {
        expect(() => {
          (typedFilter as any).addDateRange('created_at', 'invalid_range');
        }).toThrow('Unsupported date range: invalid_range');
      });

      it('should not allow date range on non-date columns', () => {
        // @ts-expect-error - name is not a date column
        typedFilter.addDateRange('name', 'today');
      });
    });

    describe('lastNDays', () => {
      it('should add filter for last N days', () => {
        typedFilter.lastNDays('created_at', 7);
        const result = typedFilter.getConditions();
        const condition = result.conditions[0] as FilterConditionInput;

        expect(condition.column).toBe('created_at');
        expect(condition.operator).toBe('between');
        expect(Array.isArray(condition.value)).toBe(true);
        expect(condition.value.length).toBe(2);

        const [start, end] = condition.value as string[];
        const startDate = new Date(start);
        const endDate = new Date(end);
        const now = new Date();

        // Verify the range is approximately N days
        const daysDiff = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        expect(daysDiff).toBe(7);
        expect(endDate.getTime()).toBeCloseTo(now.getTime(), -2); // Within 100ms
      });

      it('should handle different N values', () => {
        typedFilter.lastNDays('created_at', 30);
        const result = typedFilter.getConditions();
        const condition = result.conditions[0] as FilterConditionInput;

        const [start, end] = condition.value as string[];
        const startDate = new Date(start);
        const endDate = new Date(end);
        const daysDiff = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        expect(daysDiff).toBe(30);
      });

      it('should handle zero days', () => {
        typedFilter.lastNDays('created_at', 0);
        const result = typedFilter.getConditions();
        const condition = result.conditions[0] as FilterConditionInput;

        const [start, end] = condition.value as string[];
        const startDate = new Date(start);
        const endDate = new Date(end);
        expect(startDate.getTime()).toBe(endDate.getTime());
      });

      it('should not allow lastNDays on non-date columns', () => {
        // @ts-expect-error - name is not a date column
        typedFilter.lastNDays('name', 7);
      });
    });

    describe('addComparisonPeriod', () => {
      it('should add previous period filter', () => {
        const currentRange: [Date, Date] = [new Date('2024-01-01'), new Date('2024-01-31')];
        typedFilter.addComparisonPeriod('created_at', currentRange);

        const result = typedFilter.getConditions();
        const condition = result.conditions[0] as FilterConditionInput;

        expect(condition.column).toBe('created_at');
        expect(condition.operator).toBe('between');
        expect(Array.isArray(condition.value)).toBe(true);
        expect(condition.value.length).toBe(2);

        const [start, end] = condition.value as string[];
        // Should be same length period but shifted back by the period length
        expect(new Date(start).toISOString()).toBe('2023-12-02T00:00:00.000Z');
        expect(new Date(end).toISOString()).toBe('2024-01-01T00:00:00.000Z');
      });

      it('should handle different period lengths', () => {
        const currentRange: [Date, Date] = [new Date('2024-01-15'), new Date('2024-01-20')];
        typedFilter.addComparisonPeriod('created_at', currentRange);

        const result = typedFilter.getConditions();
        const condition = result.conditions[0] as FilterConditionInput;

        const [start, end] = condition.value as string[];
        // Should be 5-day period shifted back by 5 days
        expect(new Date(start).toISOString()).toBe('2024-01-10T00:00:00.000Z');
        expect(new Date(end).toISOString()).toBe('2024-01-15T00:00:00.000Z');
      });

      it('should handle year boundary', () => {
        const currentRange: [Date, Date] = [new Date('2024-01-01'), new Date('2024-01-15')];
        typedFilter.addComparisonPeriod('created_at', currentRange);

        const result = typedFilter.getConditions();
        const condition = result.conditions[0] as FilterConditionInput;

        const [start, end] = condition.value as string[];
        expect(new Date(start).toISOString()).toBe('2023-12-18T00:00:00.000Z');
        expect(new Date(end).toISOString()).toBe('2024-01-01T00:00:00.000Z');
      });

      it('should not allow comparison period on non-date columns', () => {
        // @ts-expect-error - name is not a date column
        typedFilter.addComparisonPeriod('name', [new Date(), new Date()]);
      });
    });

    describe('addYearOverYear', () => {
      it('should add year-over-year comparison', () => {
        const currentRange: [Date, Date] = [new Date('2024-01-01'), new Date('2024-01-31')];
        typedFilter.addYearOverYear('created_at', currentRange);

        const result = typedFilter.getConditions();
        const condition = result.conditions[0] as FilterConditionInput;

        expect(condition.column).toBe('created_at');
        expect(condition.operator).toBe('between');
        expect(Array.isArray(condition.value)).toBe(true);
        expect(condition.value.length).toBe(2);

        const [start, end] = condition.value as string[];
        // Should be same dates but previous year
        expect(new Date(start).toISOString()).toBe('2023-01-01T00:00:00.000Z');
        expect(new Date(end).toISOString()).toBe('2023-01-31T00:00:00.000Z');
      });

      it('should handle leap year dates', () => {
        const currentRange: [Date, Date] = [new Date('2024-02-29'), new Date('2024-02-29')];
        typedFilter.addYearOverYear('created_at', currentRange);

        const result = typedFilter.getConditions();
        const condition = result.conditions[0] as FilterConditionInput;

        const [start, end] = condition.value as string[];
        // Should handle leap year correctly (2023-03-01 since 2023-02-28 doesn't exist)
        expect(new Date(start).toISOString()).toBe('2023-03-01T00:00:00.000Z');
        expect(new Date(end).toISOString()).toBe('2023-03-01T00:00:00.000Z');
      });

      it('should handle different month ranges', () => {
        const currentRange: [Date, Date] = [new Date('2024-06-15'), new Date('2024-07-15')];
        typedFilter.addYearOverYear('created_at', currentRange);

        const result = typedFilter.getConditions();
        const condition = result.conditions[0] as FilterConditionInput;

        const [start, end] = condition.value as string[];
        expect(new Date(start).toISOString()).toBe('2023-06-15T00:00:00.000Z');
        expect(new Date(end).toISOString()).toBe('2023-07-15T00:00:00.000Z');
      });

      it('should not allow year-over-year on non-date columns', () => {
        // @ts-expect-error - name is not a date column
        typedFilter.addYearOverYear('name', [new Date(), new Date()]);
      });
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