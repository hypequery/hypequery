/**
 * Hands out the field names of one generated dataset. A field's name is also
 * its SQL alias, and ClickHouse resolves an alias before a column of the same
 * name, so a field may take a source column's name only when it reads exactly
 * that column; otherwise every expression reading that column would read the
 * aliased field instead. A name that is taken, or is another column's name,
 * gets the lowest free numeric suffix (`fareTotal2`).
 */
export function createFieldNamer(columnNames: readonly string[]) {
  const columns = new Set(columnNames);
  const taken = new Set<string>();
  return (base: string, ownColumn?: string): string => {
    let name = base;
    for (let suffix = 2; taken.has(name) || (columns.has(name) && name !== ownColumn); suffix += 1) {
      name = `${base}${suffix}`;
    }
    taken.add(name);
    return name;
  };
}
