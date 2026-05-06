import { describe, it, expect } from 'vitest';
import { generateQueriesTemplate } from './queries.js';
import { generateClientTemplate } from './client.js';

describe('queries template', () => {
  it('should generate basic template without example', () => {
    const result = generateQueriesTemplate({
      hasExample: false,
    });

    expect(result).toContain('import { initServe }');
    expect(result).toContain('import { db } from \'./client.js\'');
    expect(result).toContain('exampleMetric');
    expect(result).toContain('ok: true');
  });

  it('should generate template with example query', () => {
    const result = generateQueriesTemplate({
      hasExample: true,
      tableName: 'orders',
    });

    expect(result).toContain('ordersQuery');
    expect(result).toContain('.table(\'orders\')');
    expect(result).toContain('Example query using the orders table');
  });

  it('should convert snake_case table names to camelCase', () => {
    const result = generateQueriesTemplate({
      hasExample: true,
      tableName: 'user_orders',
    });

    expect(result).toContain('userOrdersQuery');
  });

  it('should include inline usage example', () => {
    const result = generateQueriesTemplate({
      hasExample: false,
    });

    expect(result).toContain('Inline usage example:');
    expect(result).toContain('api.execute(');
  });

  it('registers a default HTTP route', () => {
    const result = generateQueriesTemplate({
      hasExample: false,
    });

    expect(result).toContain("api.route('/metrics/exampleMetric', api.queries.exampleMetric);");
  });

  it('should reference correct query in usage example', () => {
    const resultBasic = generateQueriesTemplate({
      hasExample: false,
    });
    expect(resultBasic).toContain('api.execute(\'exampleMetric\')');

    const resultWithTable = generateQueriesTemplate({
      hasExample: true,
      tableName: 'orders',
    });
    expect(resultWithTable).toContain('api.execute(\'ordersQuery\')');
  });

  it('should include dev server instruction', () => {
    const result = generateQueriesTemplate({
      hasExample: false,
    });

    expect(result).toContain('npx hypequery dev');
  });

  it('should handle complex table names', () => {
    const result = generateQueriesTemplate({
      hasExample: true,
      tableName: 'customer_order_items',
    });

    expect(result).toContain('customerOrderItemsQuery');
  });

  it('emits NodeNext-safe relative imports in generated files', () => {
    const client = generateClientTemplate();
    const queries = generateQueriesTemplate({
      hasExample: false,
    });

    expect(client).toContain("import type { IntrospectedSchema } from './schema.js';");
    expect(queries).toContain("import { db } from './client.js';");
  });
});
