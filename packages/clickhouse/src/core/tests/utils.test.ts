import { describe, it, expect } from 'vitest';
import { escapeValue, substituteParameters } from '../utils';

describe('escapeValue', () => {
  it('should escape single quotes in strings', () => {
    expect(escapeValue("O'Reilly")).toBe("'O''Reilly'");
  });

  it('should handle backslashes correctly', () => {
    // Backslashes need to be escaped to prevent them from escaping the closing quote
    expect(escapeValue('test\\')).toBe("'test\\\\'");
    expect(escapeValue('path\\to\\file')).toBe("'path\\\\to\\\\file'");
  });

  it('should handle numbers', () => {
    expect(escapeValue(42)).toBe('42');
    expect(escapeValue(3.14)).toBe('3.14');
  });

  it('should reject non-finite numbers', () => {
    expect(() => escapeValue(Number.NaN)).toThrow(/non-finite number/);
    expect(() => escapeValue(Number.POSITIVE_INFINITY)).toThrow(/non-finite number/);
  });

  it('should handle booleans', () => {
    expect(escapeValue(true)).toBe('true');
    expect(escapeValue(false)).toBe('false');
  });

  it('should handle dates', () => {
    const date = new Date('2024-01-01T00:00:00.000Z');
    expect(escapeValue(date)).toBe("'2024-01-01T00:00:00.000Z'");
  });

  it('should reject invalid dates', () => {
    expect(() => escapeValue(new Date(Number.NaN))).toThrow(/invalid Date/);
  });

  it('should handle objects by JSON stringifying', () => {
    expect(escapeValue({ key: 'value' })).toBe("'{\"key\":\"value\"}'");
  });

  it('should escape quotes inside JSON-stringified values', () => {
    expect(escapeValue({ key: "O'Reilly" })).toBe("'{\"key\":\"O''Reilly\"}'");
  });

  it('should render null and reject unsupported values', () => {
    expect(escapeValue(null)).toBe('NULL');
    expect(() => escapeValue(undefined)).toThrow(/Cannot render undefined/);
  });
});

describe('substituteParameters', () => {
  it('should NOT allow SQL injection via trailing backslash', () => {
    const maliciousValue1 = '\\';
    const maliciousValue2 = ' OR 1=1 -- ';

    const sql = 'SELECT * FROM users WHERE name = ? AND status = ?';
    const result = substituteParameters(sql, [maliciousValue1, maliciousValue2]);
    expect(result).toBe("SELECT * FROM users WHERE name = '\\\\' AND status = ' OR 1=1 -- '");
  });

  it('should handle multiple backslashes correctly', () => {
    const sql = 'SELECT * FROM files WHERE path = ?';
    // Input has 3 backslashes
    const result = substituteParameters(sql, ['C:\\Users\\Admin\\']);

    // Each backslash should be doubled for ClickHouse escaping
    expect(result).toBe("SELECT * FROM files WHERE path = 'C:\\\\Users\\\\Admin\\\\'");
  });

  it('should handle complex injection attempts', () => {
    // Attempt 1: trailing backslash in first param, injection in second
    const sql1 = 'INSERT INTO logs (value1, value2) VALUES (?, ?)';
    const result1 = substituteParameters(sql1, ['test\\', '); DROP TABLE logs; --']);

    // The backslash should be escaped, keeping the second parameter as a string literal
    expect(result1).toBe("INSERT INTO logs (value1, value2) VALUES ('test\\\\', '); DROP TABLE logs; --')");

    // Verify the DROP TABLE is contained within quotes (safe as a string, not executable)
    const afterFirstValue = result1.indexOf("'test\\\\', '");
    expect(afterFirstValue).toBeGreaterThan(-1);
  });

  it('should handle backslash followed by single quote', () => {
    const sql = 'SELECT * FROM data WHERE field = ?';
    const result = substituteParameters(sql, ["test\\'value"]);

    // Both backslash and quote should be properly escaped
    expect(result).toBe("SELECT * FROM data WHERE field = 'test\\\\''value'");
  });

  it('should not allow injection through JSON-stringified parameters', () => {
    const sql = 'SELECT * FROM events WHERE metadata = ? AND tenant_id = 7';
    const result = substituteParameters(sql, [{ note: "' OR 1=1 #" }]);

    expect(result).toBe(
      "SELECT * FROM events WHERE metadata = '{\"note\":\"'' OR 1=1 #\"}' AND tenant_id = 7"
    );
  });

  it('should only substitute question marks in SQL code', () => {
    const sql = [
      "SELECT '?' AS quoted, \"?\" AS identifier, `?` AS backticked, $$?$$ AS heredoc",
      'FROM events /* ? */',
      'WHERE id = ? -- ?',
      'AND enabled = ? # ?',
    ].join('\n');

    expect(substituteParameters(sql, [42, true])).toBe([
      "SELECT '?' AS quoted, \"?\" AS identifier, `?` AS backticked, $$?$$ AS heredoc",
      'FROM events /* ? */',
      'WHERE id = 42 -- ?',
      'AND enabled = true # ?',
    ].join('\n'));
  });

  it('should fail closed when a parameter only matches a quoted question mark', () => {
    expect(() => substituteParameters("SELECT '?'", ["' OR 1=1 #"]))
      .toThrow('Found 0 placeholders but 1 parameters');
  });

  it('should fail closed when a SQL placeholder has no parameter', () => {
    expect(() => substituteParameters('SELECT * FROM events WHERE id = ?', []))
      .toThrow('Found 1 placeholders but 0 parameters');
  });
});
