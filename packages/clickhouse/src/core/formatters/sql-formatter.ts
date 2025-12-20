import { QueryConfig, FilterOperator } from '../../types/index.js';

export class SQLFormatter {
  formatSelect(config: QueryConfig<any, any>): string {
    const distinctClause = config.distinct ? 'DISTINCT ' : '';
    if (!config.select?.length) return distinctClause + '*';
    return distinctClause + config.select.join(', ');
  }

  formatGroupBy(config: QueryConfig<any, any>): string {
    const groupBy = config.groupBy;
    if (!groupBy?.length) return '';
    if (Array.isArray(groupBy)) {
      return groupBy.join(', ');
    }
    return String(groupBy);
  }

  formatWhere(config: QueryConfig<any, any>): string {
    if (!config.where?.length) return '';

    let afterGroupStart = false; // Track whether we're immediately after a group-start

    // First pass - generate the SQL fragments for each condition
    const fragments = config.where.map((condition, index) => {
      // Handle expression predicates
      if (condition.type === 'expression') {
        const prefix = index === 0 || afterGroupStart ? '' : ` ${condition.conjunction} `;
        afterGroupStart = false;
        return `${prefix}${condition.expression}`.trim();
      }

      // Handle special group markers
      if (condition.type === 'group-start') {
        const prefix = index === 0 ? '' : ` ${condition.conjunction} `;
        afterGroupStart = true; // Mark that the next condition follows a group-start
        return `${prefix}(`.trim();
      }

      if (condition.type === 'group-end') {
        afterGroupStart = false; // Reset the flag after group-end
        return ')';
      }

      // Normal conditions
      const { column, operator, value, conjunction } = condition;

      // Don't add conjunction if it's the first condition or right after a group-start
      const prefix = index === 0 || afterGroupStart ? '' : ` ${conjunction} `;

      // Reset the afterGroupStart flag
      afterGroupStart = false;

      // Handle IN operators
      if (operator === 'in' || operator === 'notIn') {
        if (!Array.isArray(value)) {
          throw new Error(`Expected an array for ${operator} operator, but got ${typeof value}`);
        }
        if (value.length === 0) {
          return `${prefix}1 = 0`;
        }
        const placeholders = value.map(() => '?').join(', ');
        return `${prefix}${column} ${operator === 'in' ? 'IN' : 'NOT IN'} (${placeholders})`.trim();
      }
      // Handle GLOBAL IN operators
      else if (operator === 'globalIn' || operator === 'globalNotIn') {
        if (!Array.isArray(value)) {
          throw new Error(`Expected an array for ${operator} operator, but got ${typeof value}`);
        }
        if (value.length === 0) {
          return `${prefix}1 = 0`;
        }
        const placeholders = value.map(() => '?').join(', ');
        return `${prefix}${column} ${operator === 'globalIn' ? 'GLOBAL IN' : 'GLOBAL NOT IN'} (${placeholders})`.trim();
      }
      // Handle subquery IN operators
      else if (operator === 'inSubquery' || operator === 'globalInSubquery') {
        if (typeof value !== 'string') {
          throw new Error(`Expected a string (subquery) for ${operator} operator, but got ${typeof value}`);
        }
        return `${prefix}${column} ${operator === 'inSubquery' ? 'IN' : 'GLOBAL IN'} (${value})`.trim();
      }
      // Handle table reference IN operators
      else if (operator === 'inTable' || operator === 'globalInTable') {
        if (typeof value !== 'string') {
          throw new Error(`Expected a string (table name) for ${operator} operator, but got ${typeof value}`);
        }
        return `${prefix}${column} ${operator === 'inTable' ? 'IN' : 'GLOBAL IN'} ${value}`.trim();
      }
      // Handle tuple IN operators
      else if (operator === 'inTuple' || operator === 'globalInTuple') {
        if (!Array.isArray(value)) {
          throw new Error(`Expected an array of tuples for ${operator} operator, but got ${typeof value}`);
        }
        if (value.length === 0) {
          return `${prefix}1 = 0`;
        }
        const placeholders = value.map(() => '(?, ?)').join(', ');
        return `${prefix}${column} ${operator === 'inTuple' ? 'IN' : 'GLOBAL IN'} (${placeholders})`.trim();
      }
      else if (operator === 'between') {
        return `${prefix}${column} BETWEEN ? AND ?`.trim();
      } else if (operator === 'like') {
        return `${prefix}${column} LIKE ?`.trim();
      } else {
        return `${prefix}${column} ${this.getSqlOperator(operator)} ?`.trim();
      }
    });

    // Join fragments and then remove extra spaces around parentheses
    let result = fragments.join(' ');

    // Replace "( " with "(" and " )" with ")"
    result = result.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');

    return result;
  }

  private getSqlOperator(operator: FilterOperator): string {
    switch (operator) {
      case 'eq': return '=';
      case 'neq': return '!=';
      case 'gt': return '>';
      case 'gte': return '>=';
      case 'lt': return '<';
      case 'lte': return '<=';
      case 'like': return 'LIKE';
      default:
        throw new Error(`Unsupported operator: ${operator}`);
    }
  }

  formatJoins(config: QueryConfig<any, any>): string {
    if (!config.joins?.length) return '';

    return config.joins.map(join => {
      const tableClause = join.alias
        ? `${join.table} AS ${join.alias}`
        : join.table;
      return `${join.type} JOIN ${tableClause} ON ${join.leftColumn} = ${join.rightColumn}`;
    }).join(' ');
  }
} 
