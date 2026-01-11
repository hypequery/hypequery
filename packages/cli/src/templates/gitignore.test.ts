import { describe, it, expect } from 'vitest';
import { hasHypequeryEntries, appendToGitignore, GITIGNORE_CONTENT } from './gitignore.js';

describe('gitignore template', () => {
  describe('hasHypequeryEntries', () => {
    it('should detect hypequery comment', () => {
      const content = '# Hypequery\n.env\n';
      expect(hasHypequeryEntries(content)).toBe(true);
    });

    it('should detect .env entry', () => {
      const content = 'node_modules/\n.env\ndist/\n';
      expect(hasHypequeryEntries(content)).toBe(true);
    });

    it('should return false for empty gitignore', () => {
      expect(hasHypequeryEntries('')).toBe(false);
    });

    it('should return false for gitignore without hypequery entries', () => {
      const content = 'node_modules/\ndist/\n*.log\n';
      expect(hasHypequeryEntries(content)).toBe(false);
    });
  });

  describe('appendToGitignore', () => {
    it('should append to empty gitignore', () => {
      const result = appendToGitignore('');
      expect(result).toContain('# Hypequery');
      expect(result).toContain('.env');
    });

    it('should append to existing gitignore', () => {
      const existing = 'node_modules/\ndist/\n';
      const result = appendToGitignore(existing);

      expect(result).toContain('node_modules/');
      expect(result).toContain('# Hypequery');
      expect(result).toContain('.env');
    });

    it('should not duplicate entries if already present', () => {
      const existing = '# Hypequery\n.env\n';
      const result = appendToGitignore(existing);

      expect(result).toBe(existing);
    });

    it('should handle gitignore without trailing newline', () => {
      const existing = 'node_modules/';
      const result = appendToGitignore(existing);

      expect(result).toContain('node_modules/\n');
      expect(result).toContain('# Hypequery');
    });

    it('should preserve existing content', () => {
      const existing = '# Project specific\nnode_modules/\ndist/\n*.log\n';
      const result = appendToGitignore(existing);

      expect(result).toContain('# Project specific');
      expect(result).toContain('node_modules/');
      expect(result).toContain('dist/');
      expect(result).toContain('*.log');
      expect(result).toContain('# Hypequery');
    });
  });

  describe('GITIGNORE_CONTENT', () => {
    it('should include .env', () => {
      expect(GITIGNORE_CONTENT).toContain('.env');
    });

    it('should include comment header', () => {
      expect(GITIGNORE_CONTENT).toContain('# Hypequery');
    });
  });
});
