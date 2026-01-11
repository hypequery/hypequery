/**
 * Generate .env file content for ClickHouse
 */
export function generateEnvTemplate(config: {
  host: string;
  database: string;
  username: string;
  password: string;
}): string {
  const isPlaceholder = config.host.includes('YOUR_');

  if (isPlaceholder) {
    return `# Hypequery Configuration
# Replace these placeholder values with your actual ClickHouse credentials

CLICKHOUSE_HOST=${config.host}
CLICKHOUSE_DATABASE=${config.database}
CLICKHOUSE_USERNAME=${config.username}
CLICKHOUSE_PASSWORD=${config.password}
`;
  }

  return `# Hypequery Configuration
CLICKHOUSE_HOST=${config.host}
CLICKHOUSE_DATABASE=${config.database}
CLICKHOUSE_USERNAME=${config.username}
CLICKHOUSE_PASSWORD=${config.password}
`;
}

/**
 * Append to existing .env file
 */
export function appendToEnv(existingContent: string, newContent: string): string {
  // Check if hypequery section already exists
  if (existingContent.includes('# Hypequery Configuration')) {
    // Replace existing section
    const lines = existingContent.split('\n');
    const startIndex = lines.findIndex(l => l.includes('# Hypequery Configuration'));

    if (startIndex !== -1) {
      // Find the end of the hypequery section
      let endIndex = startIndex + 1;
      while (
        endIndex < lines.length &&
        (lines[endIndex].startsWith('CLICKHOUSE_') || lines[endIndex].trim() === '')
      ) {
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
