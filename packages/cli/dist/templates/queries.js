/**
 * Generate queries.ts file
 */
export function generateQueriesTemplate(options) {
    var hasExample = options.hasExample, tableName = options.tableName;
    var metricKey = hasExample && tableName ? "".concat(camelCase(tableName), "Query") : 'exampleMetric';
    var typeAlias = "".concat(pascalCase(metricKey), "Result");
    var template = "import { initServe } from '@hypequery/serve';\nimport type { InferApiType } from '@hypequery/serve';\nimport { z } from 'zod';\nimport { db } from './client';\n\nconst serve = initServe({\n  context: () => ({ db }),\n});\nconst { query } = serve;\n\nexport const api = serve.define({\n  queries: serve.queries({";
    if (hasExample && tableName) {
        template += "\n    ".concat(camelCase(tableName), "Query: query\n      .describe('Example query using the ").concat(tableName, " table')\n      .query(async ({ ctx }) =>\n        ctx.db\n          .table('").concat(tableName, "')\n          .select('*')\n          .limit(10)\n          .execute()\n      ),");
    }
    else {
        template += "\n    exampleMetric: query\n      .describe('Example metric that returns a simple value')\n      .output(z.object({ ok: z.boolean() }))\n      .query(async () => ({ ok: true })),";
    }
    template += "\n  }),\n});\n\nexport type ApiDefinition = InferApiType<typeof api>;\n\n/**\n * Inline usage example:\n *\n * const result = await api.execute('".concat(metricKey, "');\n * console.log(result);\n *\n * // import type { InferQueryResult } from '@hypequery/serve';\n * type ").concat(typeAlias, " = InferQueryResult<typeof api, '").concat(metricKey, "'>;\n *\n * // Register HTTP route:\n * api.route('/metrics/").concat(metricKey, "', api.queries.").concat(metricKey, ");\n *\n * Dev server:\n * npx hypequery dev\n */\n");
    return template;
}
/**
 * Convert table name to camelCase
 */
function camelCase(str) {
    return str.replace(/_([a-z])/g, function (_, letter) { return letter.toUpperCase(); });
}
function pascalCase(str) {
    var camel = camelCase(str);
    return camel.charAt(0).toUpperCase() + camel.slice(1);
}
