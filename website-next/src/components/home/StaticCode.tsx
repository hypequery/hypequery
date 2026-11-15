import { codeToHtml } from 'shiki';

/**
 * Highlights a short code sample on the server, so it ships as HTML with no
 * highlighter in the browser. Both themes are baked in; CSS picks the dark one.
 */
export async function StaticCode({ code, lang = 'ts', className = '' }: { code: string; lang?: string; className?: string }) {
  const options = { themes: { light: 'github-light', dark: 'aurora-x' }, defaultColor: 'light' } as const;
  // A language Shiki does not bundle (a typo, or a fence such as ```env) renders as plain text
  // instead of failing the build.
  const html = await codeToHtml(code.trim(), { lang, ...options }).catch(() =>
    codeToHtml(code.trim(), { lang: 'text', ...options }),
  );

  return <div className={`static-code not-prose overflow-x-auto font-mono ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
