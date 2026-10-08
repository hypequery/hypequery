'use client';

import { useState } from 'react';
import { SiPython, SiTypescript } from 'react-icons/si';
import { InstallCommand } from './InstallCommand';

const LANGUAGES = [
  { id: 'typescript', label: 'TypeScript', Icon: SiTypescript, color: 'text-[#3178c6]', command: 'npx @hypequery/cli init' },
  { id: 'python', label: 'Python', Icon: SiPython, color: 'text-[#3776ab]', command: 'pip install "hypequery[clickhouse]"' },
] as const;

type Language = (typeof LANGUAGES)[number]['id'];

/** The setup command, with a switch between the TypeScript and Python SDKs. */
export function SetupCommand({ className = '' }: { className?: string }) {
  const [language, setLanguage] = useState<Language>('typescript');
  const active = LANGUAGES.find((option) => option.id === language) ?? LANGUAGES[0];

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <div role="radiogroup" aria-label="SDK language" className="inline-flex rounded-lg border border-border-strong bg-bg-card p-0.5">
        {LANGUAGES.map(({ id, label, Icon, color }) => {
          const selected = id === language;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={label}
              title={label}
              onClick={() => setLanguage(id)}
              className={`flex h-8 w-8 items-center justify-center rounded-md transition ${selected ? 'bg-bg-alt' : 'opacity-50 hover:opacity-100'}`}
            >
              <Icon className={`h-3.5 w-3.5 ${color}`} aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <InstallCommand command={active.command} />
    </div>
  );
}
