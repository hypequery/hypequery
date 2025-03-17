import { QueryConfig, FilterOperator } from '../../types';

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

    return config.where
      .map((condition, index) => {
        const { column, operator, value, conjunction } = condition;
        const prefix = index === 0 ? '' : ` ${conjunction} `;

        if (operator === 'in' || operator === 'notIn') {
          if (!Array.isArray(value)) {
            throw new Error(`Expected an array for ${operator} operator, but got ${typeof value}`);
          }
          if (value.length === 0) {
            return `${prefix}1 = 0`;
          }
          const placeholders = value.map(() => '?').join(', ');
          return `${prefix}${column} ${operator === 'in' ? 'IN' : 'NOT IN'} (${placeholders})`.trim();
        } else if (operator === 'between') {
          return `${prefix}${column} BETWEEN ? AND ?`.trim();
        } else if (operator === 'like') {
          return `${prefix}${column} LIKE ?`.trim();
        } else {
          return `${prefix}${column} ${this.getSqlOperator(operator)} ?`.trim();
        }
      })
      .join(' ');
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