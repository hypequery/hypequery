/**
 * Content to append to .gitignore
 */
export const GITIGNORE_CONTENT = `
# Hypequery
.env
`;

function hasEntry(content: string, entry: string): boolean {
  return content
    .split(/\r?\n/)
    .some((line) => line.trim() === entry);
}

/**
 * Check if .gitignore already has hypequery entries
 */
export function hasHypequeryEntries(content: string): boolean {
  return hasEntry(content, '# Hypequery') || hasEntry(content, '.env');
}

/**
 * Append hypequery entries to .gitignore
 */
export function appendToGitignore(
  existingContent: string,
  additionalEntries: readonly string[] = [],
): string {
  const entries = ['.env', ...additionalEntries];
  const missingEntries = entries.filter(
    (entry, index) => entry.length > 0 && entries.indexOf(entry) === index && !hasEntry(existingContent, entry),
  );

  if (missingEntries.length === 0) {
    return existingContent;
  }

  let updatedContent = existingContent;
  if (updatedContent.length > 0 && !updatedContent.endsWith('\n')) {
    updatedContent += '\n';
  }

  if (!hasHypequeryEntries(existingContent)) {
    if (updatedContent.length > 0 && !updatedContent.endsWith('\n\n')) {
      updatedContent += '\n';
    }
    updatedContent += '# Hypequery\n';
  }

  return `${updatedContent}${missingEntries.join('\n')}\n`;
}
