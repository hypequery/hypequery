function splitLines(contents: string): string[] {
  if (contents.length === 0) {
    return [];
  }
  // Keep a trailing empty line so newline-only changes remain visible.
  return contents.split('\n');
}

/**
 * Formats one unified hunk spanning the changed region, with nearby context.
 * Generated files are replaced as a unit, so a compact single hunk is easier
 * to review than treating every regenerated line as an unrelated edit.
 */
export function formatGeneratedFileDiff(
  currentContents: string,
  generatedContents: string,
  displayPath: string,
): string {
  if (currentContents === generatedContents) {
    return '';
  }

  const currentLines = splitLines(currentContents);
  const generatedLines = splitLines(generatedContents);
  let sharedPrefix = 0;
  while (
    sharedPrefix < currentLines.length
    && sharedPrefix < generatedLines.length
    && currentLines[sharedPrefix] === generatedLines[sharedPrefix]
  ) {
    sharedPrefix += 1;
  }

  let sharedSuffix = 0;
  while (
    sharedSuffix < currentLines.length - sharedPrefix
    && sharedSuffix < generatedLines.length - sharedPrefix
    && currentLines[currentLines.length - sharedSuffix - 1]
      === generatedLines[generatedLines.length - sharedSuffix - 1]
  ) {
    sharedSuffix += 1;
  }

  const contextLines = 3;
  const currentStart = Math.max(0, sharedPrefix - contextLines);
  const generatedStart = Math.max(0, sharedPrefix - contextLines);
  const currentChangedEnd = currentLines.length - sharedSuffix;
  const generatedChangedEnd = generatedLines.length - sharedSuffix;
  const currentEnd = Math.min(currentLines.length, currentChangedEnd + contextLines);
  const generatedEnd = Math.min(generatedLines.length, generatedChangedEnd + contextLines);
  const prefixContext = currentLines.slice(currentStart, sharedPrefix);
  const suffixContext = currentLines.slice(currentChangedEnd, currentEnd);
  const removedLines = currentLines.slice(sharedPrefix, currentChangedEnd);
  const addedLines = generatedLines.slice(sharedPrefix, generatedChangedEnd);

  return [
    `--- ${displayPath}`,
    `+++ ${displayPath} (generated)`,
    `@@ -${currentStart + 1},${currentEnd - currentStart} +${generatedStart + 1},${generatedEnd - generatedStart} @@`,
    ...prefixContext.map((line) => ` ${line}`),
    ...removedLines.map((line) => `-${line}`),
    ...addedLines.map((line) => `+${line}`),
    ...suffixContext.map((line) => ` ${line}`),
  ].join('\n');
}
