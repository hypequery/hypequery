import { CrossFilter } from '../cross-filter';
import { FilterConditionInput } from '../../types/filters';

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
      expect(crossFilter.getConditions()).toHaveLength(1);
      expect(crossFilter.getConditions()[0]).toEqual(condition);
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

      const conditions = crossFilter.getConditions();
      expect(conditions).toHaveLength(3);
      expect(conditions[0].operator).toBe('gt');
      expect(conditions[1].operator).toBe('in');
      expect(conditions[2].operator).toBe('between');
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
      expect(crossFilter.getConditions()).toHaveLength(2);
      expect(crossFilter.getConditions()).toEqual(conditions);
    });

    it('should return this for method chaining', () => {
      const result = crossFilter.addMultiple([]);
      expect(result).toBe(crossFilter);
    });

    it('should handle empty array', () => {
      crossFilter.addMultiple([]);
      expect(crossFilter.getConditions()).toHaveLength(0);
    });
  });

  describe('getConditions', () => {
    it('should return empty array when no conditions added', () => {
      expect(crossFilter.getConditions()).toEqual([]);
    });

    it('should return copy of conditions array', () => {
      const condition: FilterConditionInput = {
        column: 'status',
        operator: 'eq',
        value: 'active'
      };

      crossFilter.add(condition);
      const conditions = crossFilter.getConditions();
      conditions.push({
        column: 'test',
        operator: 'eq',
        value: 'test'
      });

      // Original conditions should not be modified
      expect(crossFilter.getConditions()).toHaveLength(2);
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
      expect(crossFilter.getConditions()[0]).toEqual(dateFilter);
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

      const conditions = crossFilter.getConditions();
      expect(conditions).toHaveLength(2);
      expect(conditions[0].column).toBe('price');
      expect(conditions[1].column).toBe('price');
    });

    it('should handle array values for in operator', () => {
      const inFilter: FilterConditionInput = {
        column: 'status',
        operator: 'in',
        value: ['active', 'pending', 'completed']
      };

      crossFilter.add(inFilter);
      expect(crossFilter.getConditions()[0]).toEqual(inFilter);
      expect(Array.isArray(crossFilter.getConditions()[0].value)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle boolean values', () => {
      crossFilter.add({
        column: 'is_active',
        operator: 'eq',
        value: 1
      });

      expect(crossFilter.getConditions()[0].value).toBe(1);
    });

    it('should handle numeric values', () => {
      crossFilter.add({
        column: 'count',
        operator: 'gt',
        value: 0
      });

      expect(typeof crossFilter.getConditions()[0].value).toBe('number');
    });

    it('should handle null values', () => {
      crossFilter.add({
        column: 'optional_field',
        operator: 'eq',
        value: null
      });

      expect(crossFilter.getConditions()[0].value).toBeNull();
    });
  });
});