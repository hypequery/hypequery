import chalk from 'chalk';

/**
 * Calm, professional CLI logger
 * Follows Vercel-style output: informative, actionable, no noise
 */
export class Logger {
  private quiet: boolean;

  constructor(quiet = false) {
    this.quiet = quiet;
  }

  /**
   * Success message with checkmark
   */
  success(message: string) {
    if (!this.quiet) {
      console.log(chalk.green('✓') + '  ' + message);
    }
  }

  /**
   * Error message with X mark
   */
  error(message: string) {
    console.error(chalk.red('✗') + '  ' + message);
  }

  /**
   * Warning message with warning symbol
   */
  warn(message: string) {
    if (!this.quiet) {
      console.warn(chalk.yellow('⚠') + '  ' + message);
    }
  }

  /**
   * Info message (no symbol)
   */
  info(message: string) {
    if (!this.quiet) {
      console.log('  ' + message);
    }
  }

  /**
   * Reload/change message
   */
  reload(message: string) {
    if (!this.quiet) {
      console.log(chalk.blue('↻') + '  ' + message);
    }
  }

  /**
   * Section header
   */
  header(message: string) {
    if (!this.quiet) {
      console.log('\n' + chalk.bold(message) + '\n');
    }
  }

  /**
   * Empty line
   */
  newline() {
    if (!this.quiet) {
      console.log();
    }
  }

  /**
   * Indented message (for sub-items)
   */
  indent(message: string) {
    if (!this.quiet) {
      console.log('    ' + message);
    }
  }

  /**
   * Boxed URL output
   */
  box(lines: string[]) {
    if (!this.quiet) {
      const maxLength = Math.max(...lines.map(l => l.length));
      const border = '─'.repeat(maxLength + 4);

      console.log('  ┌' + border + '┐');
      for (const line of lines) {
        const padding = ' '.repeat(maxLength - line.length);
        console.log('  │  ' + line + padding + '  │');
      }
      console.log('  └' + border + '┘');
    }
  }

  /**
   * Table output (for dev server stats)
   */
  table(headers: string[], rows: string[][]) {
    if (!this.quiet) {
      const columnWidths = headers.map((header, i) => {
        const maxContentWidth = Math.max(
          ...rows.map(row => (row[i] || '').length)
        );
        return Math.max(header.length, maxContentWidth);
      });

      // Header
      const headerRow = headers
        .map((h, i) => h.padEnd(columnWidths[i]))
        .join('    ');
      console.log('  ' + chalk.bold(headerRow));

      // Rows
      for (const row of rows) {
        const formattedRow = row
          .map((cell, i) => cell.padEnd(columnWidths[i]))
          .join('    ');
        console.log('  ' + formattedRow);
      }
    }
  }

  /**
   * Raw console.log (bypass quiet mode)
   */
  raw(message: string) {
    console.log(message);
  }
}

export const logger = new Logger();
