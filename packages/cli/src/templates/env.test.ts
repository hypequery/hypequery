import { describe, it, expect } from 'vitest';
import { generateEnvTemplate, appendToEnv } from './env.js';

describe('env template', () => {
  describe('generateEnvTemplate', () => {
    it('should generate env template with real credentials', () => {
      const result = generateEnvTemplate({
        host: 'http://localhost:8123',
        database: 'default',
        username: 'admin',
        password: 'secret123',
      });

      expect(result).toContain('CLICKHOUSE_HOST=http://localhost:8123');
      expect(result).toContain('CLICKHOUSE_DATABASE=default');
      expect(result).toContain('CLICKHOUSE_USERNAME=admin');
      expect(result).toContain('CLICKHOUSE_PASSWORD=secret123');
      expect(result).not.toContain('Replace these placeholder');
    });

    it('should generate env template with placeholders', () => {
      const result = generateEnvTemplate({
        host: 'YOUR_CLICKHOUSE_HOST',
        database: 'YOUR_DATABASE',
        username: 'YOUR_USERNAME',
        password: 'YOUR_PASSWORD',
      });

      expect(result).toContain('CLICKHOUSE_HOST=YOUR_CLICKHOUSE_HOST');
      expect(result).toContain('Replace these placeholder values');
    });

    it('should include helpful comments in placeholder mode', () => {
      const result = generateEnvTemplate({
        host: 'YOUR_CLICKHOUSE_HOST',
        database: 'YOUR_DATABASE',
        username: 'YOUR_USERNAME',
        password: 'YOUR_PASSWORD',
      });

      expect(result).toContain('# Hypequery Configuration');
      expect(result).toContain('# Replace these placeholder values with your actual ClickHouse credentials');
    });
  });

  describe('appendToEnv', () => {
    it('should append to empty env file', () => {
      const result = appendToEnv('', generateEnvTemplate({
        host: 'http://localhost:8123',
        database: 'default',
        username: 'admin',
        password: 'secret',
      }));

      expect(result).toContain('CLICKHOUSE_HOST=http://localhost:8123');
    });

    it('should append to existing env file', () => {
      const existing = 'EXISTING_VAR=value\nANOTHER_VAR=value2\n';
      const result = appendToEnv(existing, generateEnvTemplate({
        host: 'http://localhost:8123',
        database: 'default',
        username: 'admin',
        password: 'secret',
      }));

      expect(result).toContain('EXISTING_VAR=value');
      expect(result).toContain('CLICKHOUSE_HOST=http://localhost:8123');
    });

    it('should replace existing hypequery section', () => {
      const existing = `EXISTING_VAR=value

# Hypequery Configuration
CLICKHOUSE_HOST=http://old:8123
CLICKHOUSE_DATABASE=old_db
CLICKHOUSE_USERNAME=old_user
CLICKHOUSE_PASSWORD=old_pass

OTHER_VAR=value
`;

      const result = appendToEnv(existing, generateEnvTemplate({
        host: 'http://new:8123',
        database: 'new_db',
        username: 'new_user',
        password: 'new_pass',
      }));

      expect(result).toContain('CLICKHOUSE_HOST=http://new:8123');
      expect(result).toContain('CLICKHOUSE_DATABASE=new_db');
      expect(result).not.toContain('old_db');
      expect(result).toContain('EXISTING_VAR=value');
      expect(result).toContain('OTHER_VAR=value');
    });

    it('should handle env file without trailing newline', () => {
      const existing = 'EXISTING_VAR=value';
      const result = appendToEnv(existing, generateEnvTemplate({
        host: 'http://localhost:8123',
        database: 'default',
        username: 'admin',
        password: 'secret',
      }));

      expect(result).toContain('EXISTING_VAR=value\n');
      expect(result).toContain('CLICKHOUSE_HOST=http://localhost:8123');
    });
  });
});
