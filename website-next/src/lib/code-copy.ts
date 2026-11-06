// Classifies copied code for the `code_copy` analytics event.

const INSTALL_COMMAND = /^\s*(?:\$\s*)?(?:npm\s+(?:i|install|add)|pnpm\s+(?:i|install|add)|yarn\s+add|bun\s+(?:add|install)|npx|pnpm\s+dlx|bunx|pip3?\s+install|uv\s+(?:add|pip\s+install)|poetry\s+add)(?=\s|$)/;

const SNIPPET_LENGTH = 80;

export type CopiedCode = {
  /** `install` for package-manager or scaffolding commands, `code` for everything else. */
  kind: 'install' | 'code';
  /** First non-empty line, trimmed, so events show which block was copied. */
  snippet: string;
};

export function classifyCopiedCode(text: string): CopiedCode {
  const firstLine = text.split('\n').find((line) => line.trim() !== '')?.trim() ?? '';

  return {
    kind: INSTALL_COMMAND.test(firstLine) ? 'install' : 'code',
    snippet: firstLine.slice(0, SNIPPET_LENGTH),
  };
}
