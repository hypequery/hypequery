function createExpression(sql, parameters = []) {
    return {
        __type: 'predicate_expression',
        sql,
        parameters,
        expressionType: undefined
    };
}
function literal(value) {
    return {
        __type: 'predicate_literal',
        value
    };
}
function isPredicateExpression(value) {
    return value?.__type === 'predicate_expression';
}
function isPredicateLiteral(value) {
    return value?.__type === 'predicate_literal';
}
function buildArrayLiteral(values) {
    const parts = [];
    const parameters = [];
    values.forEach(value => {
        const normalized = normalizeLiteralValue(value);
        parts.push(normalized.sql);
        parameters.push(...normalized.parameters);
    });
    return createExpression(`[${parts.join(', ')}]`, parameters);
}
function normalizeLiteralValue(value) {
    if (isPredicateLiteral(value)) {
        return createExpression('?', [value.value]);
    }
    if (value === null) {
        return createExpression('NULL');
    }
    if (value instanceof Date || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
        return createExpression('?', [value]);
    }
    throw new Error('Unsupported literal value in predicate array');
}
function normalizeArgument(arg) {
    if (isPredicateExpression(arg)) {
        return arg;
    }
    if (isPredicateLiteral(arg)) {
        return createExpression('?', [arg.value]);
    }
    if (Array.isArray(arg)) {
        return buildArrayLiteral(arg);
    }
    if (arg === null) {
        return createExpression('NULL');
    }
    if (arg instanceof Date || typeof arg === 'number' || typeof arg === 'boolean') {
        return createExpression('?', [arg]);
    }
    if (typeof arg === 'string') {
        return createExpression(arg);
    }
    throw new Error('Unsupported predicate argument type');
}
function buildFunctionExpression(name, args) {
    const builtArgs = args.map(arg => normalizeArgument(arg));
    const sql = `${name}(${builtArgs.map(arg => arg.sql).join(', ')})`;
    const parameters = builtArgs.flatMap(arg => arg.parameters);
    return createExpression(sql, parameters);
}
function buildLogical(operator, expressions) {
    if (!expressions.length) {
        throw new Error(`${operator} requires at least one expression`);
    }
    if (expressions.length === 1) {
        return expressions[0];
    }
    const sql = expressions.map(expr => `(${expr.sql})`).join(` ${operator} `);
    const parameters = expressions.flatMap(expr => expr.parameters);
    return createExpression(sql, parameters);
}
export function createPredicateBuilder() {
    return {
        fn: (name, ...args) => buildFunctionExpression(name, args),
        col: column => createExpression(String(column)),
        value: value => literal(value),
        literal: value => literal(value),
        array: values => buildArrayLiteral(values),
        raw: sql => createExpression(sql),
        and: expressions => buildLogical('AND', expressions),
        or: expressions => buildLogical('OR', expressions)
    };
}
