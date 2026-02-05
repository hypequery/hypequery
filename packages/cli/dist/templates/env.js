/**
 * Generate .env file content for ClickHouse
 */
export function generateEnvTemplate(config) {
    var isPlaceholder = config.host.includes('YOUR_');
    if (isPlaceholder) {
        return "# Hypequery Configuration\n# Replace these placeholder values with your actual ClickHouse credentials\n\nCLICKHOUSE_HOST=".concat(config.host, "\nCLICKHOUSE_DATABASE=").concat(config.database, "\nCLICKHOUSE_USERNAME=").concat(config.username, "\nCLICKHOUSE_PASSWORD=").concat(config.password, "\n");
    }
    return "# Hypequery Configuration\nCLICKHOUSE_HOST=".concat(config.host, "\nCLICKHOUSE_DATABASE=").concat(config.database, "\nCLICKHOUSE_USERNAME=").concat(config.username, "\nCLICKHOUSE_PASSWORD=").concat(config.password, "\n");
}
/**
 * Append to existing .env file
 */
export function appendToEnv(existingContent, newContent) {
    // Check if hypequery section already exists
    if (existingContent.includes('# Hypequery Configuration')) {
        // Replace existing section
        var lines = existingContent.split('\n');
        var startIndex = lines.findIndex(function (l) { return l.includes('# Hypequery Configuration'); });
        if (startIndex !== -1) {
            // Find the end of the hypequery section
            var endIndex = startIndex + 1;
            while (endIndex < lines.length &&
                (lines[endIndex].startsWith('CLICKHOUSE_') || lines[endIndex].trim() === '')) {
                endIndex++;
            }
            // Replace the section
            lines.splice(startIndex, endIndex - startIndex, newContent.trim());
            return lines.join('\n');
        }
    }
    // Append to end
    if (!existingContent.endsWith('\n')) {
        existingContent += '\n';
    }
    return existingContent + '\n' + newContent;
}
