/**
 * Content to append to .gitignore
 */
export const GITIGNORE_CONTENT = `
# Hypequery
.env
`;

/**
 * Check if .gitignore already has hypequery entries
 */
export function hasHypequeryEntries(content: string): boolean {
  return content.includes('# Hypequery') || content.includes('.env');
}

/**
 * Append hypequery entries to .gitignore
 */
export function appendToGitignore(existingContent: string): string {
  if (hasHypequeryEntries(existingContent)) {
    return existingContent;
  }

  if (!existingContent.endsWith('\n')) {
    existingContent += '\n';
  }

  return existingContent + GITIGNORE_CONTENT;
}
