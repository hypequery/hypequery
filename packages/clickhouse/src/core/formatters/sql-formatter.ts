import { FilterOperator, type CompiledQuery, type ExprNode, type SelectQueryNode, type SourceNode, type ValueNode } from '../../types/index.js';

export class SQLFormatter {
  formatSelect(query: SelectQueryNode<any, any>): string {
    const distinctClause = query.distinct ? 'DISTINCT ' : '';
    if (!query.select?.length) return distinctClause + '*';
    return distinctClause + query.select.map(item => item.selection).join(', ');
  }

  formatGroupBy(query: SelectQueryNode<any, any>): string {
    const groupBy = query.groupBy;
    if (!groupBy?.length) return '';
    return groupBy.map(item => item.expression).join(', ');
  }

  formatArrayJoins(query: SelectQueryNode<any, any>): string {
    if (!query.arrayJoins?.length) return '';
    return query.arrayJoins
      .map(item => `${item.type} JOIN ${item.expression}`)
      .join(' ');
  }

  formatPrewhere(query: SelectQueryNode<any, any>): string {
    return this.compileExpr(query.prewhere).query;
  }

  formatWhere(query: SelectQueryNode<any, any>): string {
    return this.compileExpr(query.where).query;
  }

  formatFrom(source?: SourceNode): string {
    if (!source) return '';
    switch (source.kind) {
      case 'table':
        return `${source.name}${source.final ? ' FINAL' : ''}`;
      default:
        throw new Error(`Unsupported source kind: ${String((source as { kind?: string }).kind)}`);
    }
  }

  compileExpr(expr?: ExprNode, nested = false): CompiledQuery {
    if (!expr) return { query: '', parameters: [] };

    switch (expr.kind) {
      case 'raw':
        return {
          query: expr.expression,
          parameters: expr.parameters.map(parameter => parameter.value),
        };
      case 'group':
        if (!expr.expression) {
          return { query: '', parameters: [] };
        }
        const compiledGroup = this.compileExpr(expr.expression);
        if (!compiledGroup.query) {
          return { query: '', parameters: [] };
        }
        return {
          query: `(${compiledGroup.query})`,
          parameters: compiledGroup.parameters,
        };
      case 'sequence':
        return this.combineCompiled(
          expr.items
            .map((item, index) => {
              const rendered = this.compileExpr(item.expression, true);
              return {
                query: index === 0 ? rendered.query : ` ${item.conjunction} ${rendered.query}`,
                parameters: rendered.parameters,
              };
            })
            .filter(part => part.query.length > 0)
        );
      case 'logical': {
        const rendered = expr.conditions
          .map(condition => this.compileExpr(condition, true))
          .filter(part => part.query.length > 0);
        if (rendered.length === 0) return { query: '', parameters: [] };
        const combined = this.combineCompiledWithSeparator(rendered, ` ${expr.operator} `);
        return {
          query: nested ? `(${combined.query})` : combined.query,
          parameters: combined.parameters,
        };
      }
      case 'condition':
        return this.compileCondition(expr);
      default:
        throw new Error(`Unsupported expression kind: ${String((expr as { kind?: string }).kind)}`);
    }
  }

  private compileCondition({ column, operator, value }: Extract<ExprNode, { kind: 'condition' }>): CompiledQuery {
    if (operator === 'isNull' || operator === 'isNotNull') {
      return {
        query: `${column} IS ${operator === 'isNull' ? '' : 'NOT '}NULL`.trim(),
        parameters: [],
      };
    }
    if (operator === 'in' || operator === 'notIn') {
      if (!Array.isArray(value)) {
        throw new Error(`Expected an array for ${operator} operator, but got ${typeof value}`);
      }
      if (value.length === 0) {
        return { query: operator === 'in' ? '1 = 0' : '1 = 1', parameters: [] };
      }
      return {
        query: `${column} ${operator === 'in' ? 'IN' : 'NOT IN'} (${value.map(() => '?').join(', ')})`,
        parameters: (value as ValueNode[]).map(item => item.value),
      };
    }
    if (operator === 'globalIn' || operator === 'globalNotIn') {
      if (!Array.isArray(value)) {
        throw new Error(`Expected an array for ${operator} operator, but got ${typeof value}`);
      }
      if (value.length === 0) {
        return { query: operator === 'globalIn' ? '1 = 0' : '1 = 1', parameters: [] };
      }
      return {
        query: `${column} ${operator === 'globalIn' ? 'GLOBAL IN' : 'GLOBAL NOT IN'} (${value.map(() => '?').join(', ')})`,
        parameters: (value as ValueNode[]).map(item => item.value),
      };
    }
    if (operator === 'inSubquery' || operator === 'globalInSubquery') {
      if (typeof value !== 'string') {
        throw new Error(`Expected a string (subquery) for ${operator} operator, but got ${typeof value}`);
      }
      return {
        query: `${column} ${operator === 'inSubquery' ? 'IN' : 'GLOBAL IN'} (${value})`,
        parameters: [],
      };
    }
    if (operator === 'inTable' || operator === 'globalInTable') {
      if (typeof value !== 'string') {
        throw new Error(`Expected a string (table name) for ${operator} operator, but got ${typeof value}`);
      }
      return {
        query: `${column} ${operator === 'inTable' ? 'IN' : 'GLOBAL IN'} ${value}`,
        parameters: [],
      };
    }
    if (operator === 'inTuple' || operator === 'globalInTuple') {
      if (!Array.isArray(value)) {
        throw new Error(`Expected an array of tuples for ${operator} operator, but got ${typeof value}`);
      }
      if (value.length === 0) {
        return { query: '1 = 0', parameters: [] };
      }
      const tupleWidth = (value[0] as ValueNode[]).length;
      if (tupleWidth === 0) {
        throw new Error(`Expected non-empty tuples for ${operator} operator`);
      }
      const tuplePlaceholder = `(${Array.from({ length: tupleWidth }, () => '?').join(', ')})`;
      return {
        query: `${column} ${operator === 'inTuple' ? 'IN' : 'GLOBAL IN'} (${value.map(() => tuplePlaceholder).join(', ')})`,
        parameters: (value as ValueNode[][]).flatMap(tuple => tuple.map(item => item.value)),
      };
    }
    if (operator === 'between') {
      const range = value as [ValueNode, ValueNode];
      return {
        query: `${column} BETWEEN ? AND ?`,
        parameters: [range[0].value, range[1].value],
      };
    }
    if (operator === 'like') {
      const parameter = value as ValueNode;
      return {
        query: `${column} LIKE ?`,
        parameters: [parameter.value],
      };
    }
    const parameter = value as ValueNode;
    return {
      query: `${column} ${this.getSqlOperator(operator)} ?`,
      parameters: [parameter.value],
    };
  }

  compileHaving(query: SelectQueryNode<any, any>): CompiledQuery {
    if (!query.having?.length) return { query: '', parameters: [] };

    return this.combineCompiledWithSeparator(
      query.having.map(item => ({
        query: item.expression,
        parameters: item.parameters?.map(parameter => parameter.value) || [],
      })),
      ' AND '
    );
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

  formatJoins(query: SelectQueryNode<any, any>): string {
    if (!query.joins?.length) return '';

    return query.joins.map(join => {
      const tableClause = join.alias
        ? `${join.table} AS ${join.alias}`
        : join.table;
      const leftColumn = join.leftSource && !join.leftColumn.includes('.')
        ? `${join.leftSource}.${join.leftColumn}`
        : join.leftColumn;
      return `${join.type} JOIN ${tableClause} ON ${leftColumn} = ${join.rightColumn}`;
    }).join(' ');
  }

  formatCtes(query: SelectQueryNode<any, any>): string {
    if (!query.ctes?.length) return '';
    return query.ctes.map(item => item.expression).join(', ');
  }

  formatOrderBy(query: SelectQueryNode<any, any>): string {
    if (!query.orderBy?.length) return '';
    return query.orderBy
      .map(({ column, direction }) => `${String(column)} ${direction}`.trim())
      .join(', ');
  }

  formatLimitBy(query: SelectQueryNode<any, any>): string {
    if (!query.limitBy) return '';
    return `${query.limitBy.limit} BY ${query.limitBy.by.join(', ')}`;
  }

  private combineCompiled(parts: CompiledQuery[]): CompiledQuery {
    return {
      query: parts.map(part => part.query).join(''),
      parameters: parts.flatMap(part => part.parameters),
    };
  }

  private combineCompiledWithSeparator(parts: CompiledQuery[], separator: string): CompiledQuery {
    return {
      query: parts.map(part => part.query).join(separator),
      parameters: parts.flatMap(part => part.parameters),
    };
  }
} 
