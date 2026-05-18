import Link from 'next/link';

export type RelatedContentLink = {
  href: string;
  title: string;
  description: string;
};

export default function RelatedContent({
  eyebrow = 'Related content',
  title = 'Continue with the most relevant next reads',
  links,
}: {
  eyebrow?: string;
  title?: string;
  links: RelatedContentLink[];
}) {
  if (links.length === 0) {
    return null;
  }

  return (
    <section className="mt-12 border-t border-border pt-8">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-2xl font-bold text-text">{title}</h2>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {links.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-lg border border-border bg-bg-card p-5 transition hover:-translate-y-px hover:border-border-strong hover:shadow-card"
          >
            <h3 className="font-semibold text-text">{item.title}</h3>
            <p className="mt-2 text-sm leading-7 text-text-muted">{item.description}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
