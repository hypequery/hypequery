import Link from 'next/link';
import { Github, ExternalLink } from 'lucide-react';

const navigation = [
  { name: 'Docs', href: '/docs' },
  { name: 'Blog', href: '/blog' },
  {
    name: 'GitHub',
    href: 'https://github.com/hypequery/hypequery',
    icon: true,
  },
];

type NavigationLink = {
  name: string;
  href: string;
  icon?: boolean;
  isNew?: boolean;
  isBeta?: boolean;
  external?: boolean;
};

type NavigationItem = NavigationLink & { children?: NavigationLink[] };

function isNewBadge(item: NavigationLink): boolean {
  return 'isNew' in item && item.isNew === true;
}

function isBetaBadge(item: NavigationLink): boolean {
  return 'isBeta' in item && item.isBeta === true;
}

export default function Navigation() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-gray-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:border-gray-800 dark:bg-[#0b1120]">
      <nav
        className="flex h-20 items-center justify-between px-6 lg:px-8"
        aria-label="Global"
      >
        <div className="flex lg:flex-1">
          <Link
            href="/"
            className="font-mono text-xl font-bold text-indigo-600 flex items-center"
          >
            <img src="/logo.svg" alt="Hypequery" className="w-[180px]" />
          </Link>
        </div>
        <div className="flex items-center gap-x-6 justify-end flex-1">
          <div className="flex gap-x-8 items-center">
            {navigation.map((item) =>
              item.icon ? (
                <a
                  key={item.name}
                  href={item.href}
                  className="nav-link text-sm font-semibold leading-6 flex items-center text-gray-900 dark:text-gray-100 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                  target="_blank"
                  rel="noopener"
                >
                  <span className="sr-only">GitHub</span>
                  <Github className="h-6 w-6" />
                </a>
              ) : (
                <Link
                  key={item.name}
                  href={item.href}
                  className="nav-link text-sm font-semibold leading-6 flex items-center gap-1 text-gray-900 dark:text-gray-100 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                  target={item.external ? '_blank' : undefined}
                  rel={item.external ? 'noopener' : undefined}
                >
                  {item.name}
                  {item.external && (
                    <ExternalLink className="h-3 w-3 text-gray-400" />
                  )}
                  {isNewBadge(item) && (
                    <span className="ml-2 inline-flex items-center rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-700/10 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/20">
                      {isBetaBadge(item) ? 'Coming soon' : 'New'}
                    </span>
                  )}
                </Link>
              ),
            )}
          </div>
        </div>
      </nav>
    </header>
  );
}
