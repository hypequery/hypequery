import chalk from 'chalk';
/**
 * Calm, professional CLI logger
 * Follows Vercel-style output: informative, actionable, no noise
 */
var Logger = /** @class */ (function () {
    function Logger(quiet) {
        if (quiet === void 0) { quiet = false; }
        this.quiet = quiet;
    }
    /**
     * Success message with checkmark
     */
    Logger.prototype.success = function (message) {
        if (!this.quiet) {
            console.log(chalk.green('✓') + '  ' + message);
        }
    };
    /**
     * Error message with X mark
     */
    Logger.prototype.error = function (message) {
        console.error(chalk.red('✗') + '  ' + message);
    };
    /**
     * Warning message with warning symbol
     */
    Logger.prototype.warn = function (message) {
        if (!this.quiet) {
            console.warn(chalk.yellow('⚠') + '  ' + message);
        }
    };
    /**
     * Info message (no symbol)
     */
    Logger.prototype.info = function (message) {
        if (!this.quiet) {
            console.log('  ' + message);
        }
    };
    /**
     * Reload/change message
     */
    Logger.prototype.reload = function (message) {
        if (!this.quiet) {
            console.log(chalk.blue('↻') + '  ' + message);
        }
    };
    /**
     * Section header
     */
    Logger.prototype.header = function (message) {
        if (!this.quiet) {
            console.log('\n' + chalk.bold(message) + '\n');
        }
    };
    /**
     * Empty line
     */
    Logger.prototype.newline = function () {
        if (!this.quiet) {
            console.log();
        }
    };
    /**
     * Indented message (for sub-items)
     */
    Logger.prototype.indent = function (message) {
        if (!this.quiet) {
            console.log('    ' + message);
        }
    };
    /**
     * Boxed URL output
     */
    Logger.prototype.box = function (lines) {
        if (!this.quiet) {
            var maxLength = Math.max.apply(Math, lines.map(function (l) { return l.length; }));
            var border = '─'.repeat(maxLength + 4);
            console.log('  ┌' + border + '┐');
            for (var _i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
                var line = lines_1[_i];
                var padding = ' '.repeat(maxLength - line.length);
                console.log('  │  ' + line + padding + '  │');
            }
            console.log('  └' + border + '┘');
        }
    };
    /**
     * Table output (for dev server stats)
     */
    Logger.prototype.table = function (headers, rows) {
        if (!this.quiet) {
            var columnWidths_1 = headers.map(function (header, i) {
                var maxContentWidth = Math.max.apply(Math, rows.map(function (row) { return (row[i] || '').length; }));
                return Math.max(header.length, maxContentWidth);
            });
            // Header
            var headerRow = headers
                .map(function (h, i) { return h.padEnd(columnWidths_1[i]); })
                .join('    ');
            console.log('  ' + chalk.bold(headerRow));
            // Rows
            for (var _i = 0, rows_1 = rows; _i < rows_1.length; _i++) {
                var row = rows_1[_i];
                var formattedRow = row
                    .map(function (cell, i) { return cell.padEnd(columnWidths_1[i]); })
                    .join('    ');
                console.log('  ' + formattedRow);
            }
        }
    };
    /**
     * Raw console.log (bypass quiet mode)
     */
    Logger.prototype.raw = function (message) {
        console.log(message);
    };
    return Logger;
}());
export { Logger };
export var logger = new Logger();
