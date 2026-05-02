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
   * Phase marker for multi-step commands.
   */
  phase(message: string) {
    if (!this.quiet) {
      console.log(chalk.cyan('○') + '  ' + chalk.bold(message));
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
   * Command header with a consistent hypequery brand line.
   */
  command(name: string, subtitle?: string) {
    if (!this.quiet) {
      console.log('\n' + chalk.dim('hypequery') + ' ' + chalk.bold(name));
      if (subtitle) {
        console.log(chalk.dim('  ' + subtitle));
      }
      console.log();
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
   * Callout block for warnings or follow-up guidance.
   */
  callout(title: string, lines: string[]) {
    if (!this.quiet) {
      const content = [chalk.bold(title), ...lines];
      const maxLength = Math.max(...content.map(line => visibleLength(line)));
      const border = '─'.repeat(maxLength + 4);

      console.log('  ┌' + border + '┐');
      for (const line of content) {
        const padding = ' '.repeat(maxLength - visibleLength(line));
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
          ...rows.map(row => visibleLength(row[i] || ''))
        );
        return Math.max(visibleLength(header), maxContentWidth);
      });

      // Header
      const headerRow = headers
        .map((h, i) => padAnsi(h, columnWidths[i]))
        .join('    ');
      console.log('  ' + chalk.bold(headerRow));

      // Rows
      for (const row of rows) {
        const formattedRow = row
          .map((cell, i) => padAnsi(cell, columnWidths[i]))
          .join('    ');
        console.log('  ' + formattedRow);
      }
    }
  }

  /**
   * Aligned key/value rows for compact command summaries.
   */
  kv(rows: Array<[string, string]>) {
    if (!this.quiet) {
      const labelWidth = rows.reduce((max, [label]) => Math.max(max, label.length), 0);

      for (const [label, value] of rows) {
        console.log(`  ${chalk.dim(label.padEnd(labelWidth))}  ${value}`);
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

function visibleLength(value: string): number {
  return value.replace(/\u001B\[[0-9;]*m/g, '').length;
}

function padAnsi(value: string, width: number): string {
  const padding = Math.max(0, width - visibleLength(value));
  return value + ' '.repeat(padding);
}
