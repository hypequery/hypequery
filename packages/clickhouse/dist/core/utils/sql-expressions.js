/**
 * Creates a raw SQL expression
 * @param sql The SQL expression string
 * @returns A SqlExpression object
 */
export function raw(sql) {
    return {
        __type: 'expression',
        toSql: () => sql,
        expressionType: undefined
    };
}
export function selectExpr(sql, alias) {
    return alias ? rawAs(sql, alias) : raw(sql);
}
/**
 * Creates an aliased SQL expression for use in SELECT clauses
 * @param sql The SQL expression string
 * @param alias The alias to use for the expression
 * @returns An AliasedExpression object
 */
export function rawAs(sql, alias) {
    return {
        __type: 'aliased_expression',
        alias,
        toSql: () => `${sql} AS ${alias}`,
        expressionType: undefined
    };
}
export function toDateTime(field, alias) {
    return alias
        ? rawAs(`toDateTime(${field})`, alias)
        : raw(`toDateTime(${field})`);
}
export function formatDateTime(field, format, options = {}) {
    const { timezone, alias } = options;
    let sql = `formatDateTime(${field}, '${format}'`;
    if (timezone) {
        sql += `, '${timezone}'`;
    }
    sql += ')';
    return alias ? rawAs(sql, alias) : raw(sql);
}
export function toStartOfInterval(field, interval, alias) {
    return alias
        ? rawAs(`toStartOfInterval(${field}, INTERVAL ${interval})`, alias)
        : raw(`toStartOfInterval(${field}, INTERVAL ${interval})`);
}
export function datePart(part, field, alias) {
    const functionName = `to${part.charAt(0).toUpperCase() + part.slice(1)}`;
    return alias
        ? rawAs(`${functionName}(${field})`, alias)
        : raw(`${functionName}(${field})`);
}
