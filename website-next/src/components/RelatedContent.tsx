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
    <section className="mt-12 border-t border-gray-200 pt-8 dark:border-gray-800">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-2xl font-bold text-gray-900 dark:text-gray-100">{title}</h2>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {links.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="border border-gray-200 bg-white p-5 transition hover:border-indigo-400 dark:border-gray-800 dark:bg-gray-950 dark:hover:border-indigo-500"
          >
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">{item.title}</h3>
            <p className="mt-2 text-sm leading-7 text-gray-600 dark:text-gray-300">{item.description}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
