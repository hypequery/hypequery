import Link from 'next/link';
import { marketing } from '@/components/ui/marketing';
import CodeHighlight from '@/components/CodeHighlight';
import MarkdownContent from '@/components/MarkdownContent';
import ExampleCard from '@/components/examples/ExampleCard';
import {
  createCommand,
  entryHref,
  kindPath,
  label,
  readmeBody,
  relatedEntries,
  REPO_TREE_URL,
  type RegistryEntry,
} from '@/lib/examples';
import { absoluteUrl } from '@/lib/site';

function CodeBlock({ title, code, language }: { title: string; code: string; language: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <p className="font-mono text-xs text-text-dim">{title}</p>
      </div>
      <div className="overflow-x-auto p-4 text-sm">
        <CodeHighlight code={code} language={language} />
      </div>
    </div>
  );
}

export default function ExampleDetail({ entry }: { entry: RegistryEntry }) {
  const { manifest } = entry;
  const kindLabel = manifest.kind === 'example' ? 'Example' : 'Recipe';
  const hubLabel = manifest.kind === 'example' ? 'Examples' : 'Recipes';
  const pageUrl = absoluteUrl(entryHref(entry)).toString();
  const related = relatedEntries(entry);

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: hubLabel, item: absoluteUrl(kindPath(manifest.kind)).toString() },
      { '@type': 'ListItem', position: 2, name: manifest.title, item: pageUrl },
    ],
  };
  const sourceCode = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: manifest.title,
    description: manifest.outcome,
    url: pageUrl,
    codeRepository: `${REPO_TREE_URL}/${entry.dir}`,
    programmingLanguage: label(manifest.language),
    runtimePlatform: manifest.stack.map(label).join(', '),
    keywords: manifest.keywords.join(', '),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(sourceCode) }} />

      <section className="border-b border-border">
        <div className={`${marketing.container} pb-12 pt-12 sm:pb-14 sm:pt-16`}>
          <nav aria-label="Breadcrumb" className="font-mono text-xs text-text-dim">
            <Link href={kindPath(manifest.kind)} className="hover:text-text">{hubLabel}</Link>
            <span className="mx-2" aria-hidden="true">/</span>
            <span className="text-text-muted">{manifest.slug}</span>
          </nav>
          <p className={`mt-6 ${marketing.eyebrow}`}>{kindLabel} · {label(manifest.language)}</p>
          <h1 className={`mt-4 max-w-[980px] ${marketing.heroTitle}`}>{manifest.title}</h1>
          <p className={`mt-5 max-w-[760px] ${marketing.heroLead}`}>{manifest.outcome}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <code className="rounded-lg border border-border bg-bg-card px-4 py-2.5 font-mono text-sm text-text">{createCommand(entry)}</code>
            <a
              href={`${REPO_TREE_URL}/${entry.dir}`}
              target="_blank"
              rel="noreferrer"
              className={marketing.secondaryButton}
            >
              Source on GitHub
            </a>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            {[...manifest.stack, ...manifest.useCases].map((tag) => (
              <span key={tag} className="border border-border px-2.5 py-1 font-mono text-[11px] text-text-muted">{label(tag)}</span>
            ))}
          </div>
        </div>
      </section>

      <section className={`${marketing.container} py-12 sm:py-16`}>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.66fr)_minmax(0,0.34fr)]">
          <article className="prose prose-invert max-w-none">
            <MarkdownContent content={readmeBody(entry)} />

            <h2 id="key-file">Full key file: <code>{entry.keyFile.path}</code></h2>
            <div className="not-prose">
              <CodeBlock title={entry.keyFile.path} code={entry.keyFile.source} language={entry.keyFile.language} />
            </div>

            {entry.recipe && (
              <>
                <h2 id="dataset">Dataset: <code>{entry.recipe.dataset.path}</code></h2>
                <div className="not-prose">
                  <CodeBlock title={entry.recipe.dataset.path} code={entry.recipe.dataset.source} language={entry.recipe.dataset.language} />
                </div>
                <h2 id="generated-sql">Generated SQL</h2>
                <p>What hypequery sends to ClickHouse for this recipe. The smoke test asserts it does not drift.</p>
                <div className="not-prose">
                  <CodeBlock title={manifest.kind === 'recipe' ? manifest.expectedSqlFile : 'expected.sql'} code={entry.recipe.expectedSql} language="sql" />
                </div>
                <h2 id="output">Output on the seed dataset</h2>
                <div className="not-prose">
                  <CodeBlock title={manifest.kind === 'recipe' ? manifest.outputFile : 'output'} code={entry.recipe.output} language="json" />
                </div>
              </>
            )}
          </article>

          <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
            <div className={marketing.card}>
              <p className="font-mono text-xs text-text-dim">Run it</p>
              <dl className="mt-4 space-y-3 text-sm">
                <div><dt className="text-text-muted">Install</dt><dd className="mt-1 font-mono text-xs text-text">{manifest.run.install}</dd></div>
                <div><dt className="text-text-muted">Dev</dt><dd className="mt-1 font-mono text-xs text-text">{manifest.run.dev}</dd></div>
                <div><dt className="text-text-muted">Test</dt><dd className="mt-1 font-mono text-xs text-text">{manifest.run.test}</dd></div>
                {manifest.exampleRequest && (
                  <div><dt className="text-text-muted">Verify</dt><dd className="mt-1 break-all font-mono text-xs text-text">{manifest.exampleRequest}</dd></div>
                )}
              </dl>
            </div>

            <div className={marketing.card}>
              <p className="font-mono text-xs text-text-dim">Packages</p>
              <ul className="mt-4 space-y-2 text-sm">
                {manifest.packages.map((pkg) => (
                  <li key={pkg}>
                    <a href={`https://www.npmjs.com/package/${pkg}`} target="_blank" rel="noreferrer" className="font-mono text-xs text-text hover:text-accent">{pkg}</a>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-text-muted">Tested from hypequery {manifest.minVersion}.</p>
            </div>

            {manifest.env.length > 0 && (
              <div className={marketing.card}>
                <p className="font-mono text-xs text-text-dim">Environment</p>
                <ul className="mt-4 space-y-3 text-sm">
                  {manifest.env.map((variable) => (
                    <li key={variable.name}>
                      <p className="font-mono text-xs text-text">
                        {variable.name}
                        {variable.required && <span className="ml-2 text-accent">required</span>}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-text-muted">{variable.description}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {manifest.leadPages.length > 0 && (
              <div className={marketing.card}>
                <p className="font-mono text-xs text-text-dim">Appears on</p>
                <ul className="mt-4 space-y-2 text-sm">
                  {manifest.leadPages.map((page) => (
                    <li key={page}><Link href={page} className="text-text hover:text-accent">{page}</Link></li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>

        {related.length > 0 && (
          <div className="mt-16 border-t border-border pt-10">
            <p className={marketing.eyebrow}>Related</p>
            <h2 className={`mt-3 ${marketing.sectionTitle}`}>Keep going with the same seed dataset</h2>
            <div className="mt-8 grid gap-6 lg:grid-cols-2">
              {related.map((item) => (
                <ExampleCard key={item.manifest.slug} entry={item} compact />
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
