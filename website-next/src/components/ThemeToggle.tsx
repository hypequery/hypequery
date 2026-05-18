'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';

export type ThemeMode = 'light' | 'dark' | 'system';

const options: Array<{ label: string; value: ThemeMode; icon: typeof Sun }> = [
  { label: 'System', value: 'system', icon: Monitor },
  { label: 'Light', value: 'light', icon: Sun },
  { label: 'Dark', value: 'dark', icon: Moon },
];

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="inline-flex items-center gap-1 rounded-[100px] border border-border bg-bg-card p-1">
        {options.map((option) => {
          const Icon = option.icon;
          return (
            <div
              key={option.value}
              className="inline-flex items-center gap-1.5 rounded-[100px] px-3 py-1.5 text-[12px] font-medium text-text-muted"
            >
              <Icon className="h-3.5 w-3.5" />
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className="inline-flex items-center gap-1 rounded-[100px] border border-border bg-bg-card p-1"
      aria-label="Theme"
      role="group"
    >
      {options.map((option) => {
        const Icon = option.icon;
        const isActive = theme === option.value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setTheme(option.value)}
            aria-pressed={isActive}
            aria-label={option.label}
            title={option.label}
            className={`inline-flex items-center gap-1.5 rounded-[100px] px-3 py-1.5 text-[12px] font-medium transition ${
              isActive
                ? 'bg-text text-bg'
                : 'text-text-muted hover:bg-bg-alt hover:text-text'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
