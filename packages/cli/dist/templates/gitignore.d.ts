/**
 * Content to append to .gitignore
 */
export declare const GITIGNORE_CONTENT = "\n# Hypequery\n.env\n";
/**
 * Check if .gitignore already has hypequery entries
 */
export declare function hasHypequeryEntries(content: string): boolean;
/**
 * Append hypequery entries to .gitignore
 */
export declare function appendToGitignore(existingContent: string): string;
//# sourceMappingURL=gitignore.d.ts.map