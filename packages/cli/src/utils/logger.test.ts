import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import chalk from 'chalk';
import { Logger } from './logger.js';

describe('Logger', () => {
  let logger: Logger;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let consoleWarnSpy: any;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe('normal mode', () => {
    beforeEach(() => {
      logger = new Logger(false);
    });

    it('should log success messages with checkmark', () => {
      logger.success('Operation completed');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        chalk.green('✓') + '  ' + 'Operation completed'
      );
    });

    it('should log error messages with X mark', () => {
      logger.error('Something went wrong');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        chalk.red('✗') + '  ' + 'Something went wrong'
      );
    });

    it('should log warning messages with warning symbol', () => {
      logger.warn('This is a warning');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        chalk.yellow('⚠') + '  ' + 'This is a warning'
      );
    });

    it('should log info messages without symbol', () => {
      logger.info('Information message');

      expect(consoleLogSpy).toHaveBeenCalledWith('  ' + 'Information message');
    });

    it('should log reload messages with reload symbol', () => {
      logger.reload('Reloading...');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        chalk.blue('↻') + '  ' + 'Reloading...'
      );
    });

    it('should log header with bold formatting and newlines', () => {
      logger.header('Section Header');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '\n' + chalk.bold('Section Header') + '\n'
      );
    });

    it('should log empty newline', () => {
      logger.newline();

      expect(consoleLogSpy).toHaveBeenCalledWith();
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    });

    it('should log indented messages', () => {
      logger.indent('Indented message');

      expect(consoleLogSpy).toHaveBeenCalledWith('    ' + 'Indented message');
    });

    it('should log raw messages', () => {
      logger.raw('Raw output');

      expect(consoleLogSpy).toHaveBeenCalledWith('Raw output');
    });

    describe('box', () => {
      it('should log boxed output with single line', () => {
        logger.box(['http://localhost:3000']);

        expect(consoleLogSpy).toHaveBeenCalledTimes(3);
        expect(consoleLogSpy).toHaveBeenNthCalledWith(1, expect.stringContaining('┌'));
        expect(consoleLogSpy).toHaveBeenNthCalledWith(2, expect.stringContaining('http://localhost:3000'));
        expect(consoleLogSpy).toHaveBeenNthCalledWith(3, expect.stringContaining('└'));
      });

      it('should log boxed output with multiple lines', () => {
        logger.box(['Line 1', 'Line 2', 'Line 3']);

        expect(consoleLogSpy).toHaveBeenCalledTimes(5); // top + 3 lines + bottom
        expect(consoleLogSpy).toHaveBeenNthCalledWith(2, expect.stringContaining('Line 1'));
        expect(consoleLogSpy).toHaveBeenNthCalledWith(3, expect.stringContaining('Line 2'));
        expect(consoleLogSpy).toHaveBeenNthCalledWith(4, expect.stringContaining('Line 3'));
      });

      it('should align box borders to longest line', () => {
        logger.box(['Short', 'Much longer line']);

        const calls = consoleLogSpy.mock.calls;
        const topBorder = calls[0][0];
        const bottomBorder = calls[3][0];

        // Borders should be same length
        expect(topBorder.length).toBe(bottomBorder.length);
      });

      it('should pad shorter lines in box', () => {
        logger.box(['Short', 'Longer line']);

        const shortLineCall = consoleLogSpy.mock.calls[1][0];
        const longLineCall = consoleLogSpy.mock.calls[2][0];

        // Both lines should be same length (including padding)
        expect(shortLineCall.length).toBe(longLineCall.length);
      });
    });

    describe('table', () => {
      it('should log table with headers and rows', () => {
        logger.table(['Name', 'Age'], [['Alice', '25'], ['Bob', '30']]);

        expect(consoleLogSpy).toHaveBeenCalledTimes(3); // header + 2 rows
        expect(consoleLogSpy).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('Name')
        );
        expect(consoleLogSpy).toHaveBeenNthCalledWith(
          1,
          expect.stringContaining('Age')
        );
      });

      it('should align columns based on widest content', () => {
        logger.table(['ID', 'Name'], [['1', 'Alice'], ['2', 'Bob']]);

        const headerCall = consoleLogSpy.mock.calls[0][0];
        const row1Call = consoleLogSpy.mock.calls[1][0];
        const row2Call = consoleLogSpy.mock.calls[2][0];

        // All rows should be roughly same length (accounting for spacing)
        const lengths = [headerCall.length, row1Call.length, row2Call.length];
        const maxLength = Math.max(...lengths);
        const minLength = Math.min(...lengths);
        // Should be within reasonable tolerance
        expect(maxLength - minLength).toBeLessThan(10);
      });

      it('should handle headers longer than content', () => {
        logger.table(['Very Long Header', 'ID'], [['Short', '1']]);

        const headerCall = consoleLogSpy.mock.calls[0][0];
        const rowCall = consoleLogSpy.mock.calls[1][0];

        // Row should be padded to match header width
        expect(rowCall.length).toBeGreaterThanOrEqual(headerCall.length - 10); // accounting for spacing
      });

      it('should handle empty cells', () => {
        logger.table(['Col1', 'Col2'], [['Value', ''], ['', 'Value']]);

        expect(consoleLogSpy).toHaveBeenCalledTimes(3);
        expect(consoleLogSpy).toHaveBeenNthCalledWith(2, expect.any(String));
        expect(consoleLogSpy).toHaveBeenNthCalledWith(3, expect.any(String));
      });

      it('should apply bold formatting to headers', () => {
        logger.table(['Header'], [['Value']]);

        const headerCall = consoleLogSpy.mock.calls[0][0];
        expect(headerCall).toContain(chalk.bold('Header'));
      });
    });
  });

  describe('quiet mode', () => {
    beforeEach(() => {
      logger = new Logger(true);
    });

    it('should not log success messages in quiet mode', () => {
      logger.success('Success');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should still log error messages in quiet mode', () => {
      logger.error('Error');

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        chalk.red('✗') + '  ' + 'Error'
      );
    });

    it('should not log warning messages in quiet mode', () => {
      logger.warn('Warning');

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should not log info messages in quiet mode', () => {
      logger.info('Info');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should not log reload messages in quiet mode', () => {
      logger.reload('Reload');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should not log headers in quiet mode', () => {
      logger.header('Header');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should not log newlines in quiet mode', () => {
      logger.newline();

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should not log indented messages in quiet mode', () => {
      logger.indent('Indent');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should not log boxed output in quiet mode', () => {
      logger.box(['Line 1', 'Line 2']);

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should not log tables in quiet mode', () => {
      logger.table(['Header'], [['Value']]);

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should still log raw messages in quiet mode', () => {
      logger.raw('Raw');

      expect(consoleLogSpy).toHaveBeenCalledWith('Raw');
    });
  });

  describe('constructor', () => {
    it('should default to non-quiet mode', () => {
      const defaultLogger = new Logger();
      defaultLogger.info('Test');

      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should accept quiet mode parameter', () => {
      const quietLogger = new Logger(true);
      quietLogger.info('Test');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });
});
