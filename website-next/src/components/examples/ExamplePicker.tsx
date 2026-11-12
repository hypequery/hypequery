'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { InstallCommand } from '@/components/home/InstallCommand';

export interface ExamplePickerOption {
  slug: string;
  kind: 'example' | 'recipe';
  language: 'typescript' | 'python';
  command: string;
}

/**
 * Pick a registry example or recipe and copy its `create` command. Options are
 * built on the server from the registry, so the command always matches the
 * entry's page.
 */
export default function ExamplePicker({
  options,
  label = 'Start from an example',
  location = 'hub_example',
  defaultSlug = 'nextjs-dashboard',
  className = '',
}: {
  options: ExamplePickerOption[];
  label?: string;
  /** Sent with the `code_copy` event. */
  location?: string;
  defaultSlug?: string;
  className?: string;
}) {
  const id = useId();
  const [slug, setSlug] = useState(options.some((option) => option.slug === defaultSlug) ? defaultSlug : options[0]?.slug);
  const active = options.find((option) => option.slug === slug) ?? options[0];
  if (!active) return null;

  const groups = [
    { label: 'Examples', items: options.filter((option) => option.kind === 'example') },
    { label: 'Recipes', items: options.filter((option) => option.kind === 'recipe') },
  ].filter((group) => group.items.length > 0);

  return (
    <div className={`flex max-w-full flex-wrap items-center gap-2 ${className}`}>
      <label htmlFor={id} className="text-sm text-text-muted">
        {label}
      </label>
      <select
        id={id}
        value={active.slug}
        onChange={(event) => setSlug(event.target.value)}
        className="h-9 max-w-full rounded-lg border border-border-strong bg-bg-card px-2 font-mono text-[13px] text-text transition hover:border-text focus:outline-none focus-visible:ring-2 focus-visible:ring-text/40"
      >
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.items.map((option) => (
              <option key={option.slug} value={option.slug}>
                {option.slug}
                {option.language === 'python' ? ' (Python)' : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <InstallCommand command={active.command} location={location} className="max-w-full" />
      <Link href={`/${active.kind === 'example' ? 'examples' : 'recipes'}/${active.slug}`} className="text-sm text-text-muted underline-offset-4 hover:text-text hover:underline">
        What it builds <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
