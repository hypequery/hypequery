/**
 * Content to append to .gitignore
 */
export var GITIGNORE_CONTENT = "\n# Hypequery\n.env\n";
/**
 * Check if .gitignore already has hypequery entries
 */
export function hasHypequeryEntries(content) {
    return content.includes('# Hypequery') || content.includes('.env');
}
/**
 * Append hypequery entries to .gitignore
 */
export function appendToGitignore(existingContent) {
    if (hasHypequeryEntries(existingContent)) {
        return existingContent;
    }
    if (!existingContent.endsWith('\n')) {
        existingContent += '\n';
    }
    return existingContent + GITIGNORE_CONTENT;
}
