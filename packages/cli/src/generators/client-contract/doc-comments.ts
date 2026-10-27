import type { ClientFieldAnnotation } from '@hypequery/protocol';

/** One-line JSDoc from backend presentation text; validated text has no line breaks. */
export function docComment(annotation: ClientFieldAnnotation | undefined, indent = ''): string {
  const parts = [annotation?.label, annotation?.description].filter((part): part is string => part !== undefined);
  if (parts.length === 0) return '';
  // The comment terminator is the only sequence that can escape a block comment.
  return `${indent}/** ${parts.join(' — ').replaceAll('*/', '*\\/')} */\n`;
}
