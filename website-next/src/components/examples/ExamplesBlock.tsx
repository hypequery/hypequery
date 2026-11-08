import Link from 'next/link';
import { marketing } from '@/components/ui/marketing';
import ExampleCard from '@/components/examples/ExampleCard';
import { entriesForFunction, entriesForLeadPage, type RegistryEntry } from '@/lib/examples';

type Props =
  | { leadPage: string; functionPage?: never; title?: string }
  | { functionPage: string; leadPage?: never; title?: string };

/**
 * The example/recipe block injected into pages that already rank. Renders
 * nothing when no registry entry targets the page, so adding a tag to a
 * manifest is the only step to surface an example here.
 */
export default function ExamplesBlock(props: Props) {
  const entries: RegistryEntry[] = 'leadPage' in props && props.leadPage
    ? entriesForLeadPage(props.leadPage)
    : entriesForFunction(props.functionPage as string);
  if (entries.length === 0) return null;

  const examples = entries.filter((e) => e.manifest.kind === 'example');
  const guidesOnly = entries.every((e) => e.manifest.kind === 'guide');
  const title = props.title ?? (guidesOnly ? 'Guides with SQL that runs in CI' : examples.length === 0 ? 'Recipes and guides you can run against a seeded ClickHouse' : 'Runnable examples, tested in CI');

  return (
    <section className={marketing.band}>
      <div className={`${marketing.container} py-14 sm:py-16`}>
        <p className={marketing.eyebrow}>Examples</p>
        <h2 className={`mt-3 ${marketing.sectionTitle}`}>{title}</h2>
        <p className="mt-4 max-w-3xl text-sm leading-6 text-text-muted">
          Every example runs against the same seeded ClickHouse dataset and is smoke-tested on every change. Scaffold one with{' '}
          <code className="font-mono text-xs text-text">npx hypequery create &lt;slug&gt; -y</code>, or browse the{' '}
          <Link href="/examples" className="text-accent hover:opacity-70">full list</Link>.
        </p>
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          {entries.map((entry) => (
            <ExampleCard key={entry.manifest.slug} entry={entry} compact />
          ))}
        </div>
      </div>
    </section>
  );
}
