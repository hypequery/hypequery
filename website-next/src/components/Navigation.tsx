import Link from 'next/link';
import { ChevronDown, Github } from 'lucide-react';

const navigation: NavigationItem[] = [
  { name: 'Docs', href: '/docs' },
  { name: 'Blog', href: '/blog' },
  // {
  //   name: 'Use Cases',
  //   href: '/use-cases',
  //   children: [
  //     {
  //       name: 'Internal Product APIs',
  //       href: '/use-cases/internal-product-apis',
  //     },
  //     {
  //       name: 'Multi-tenant SaaS',
  //       href: '/use-cases/multi-tenant-saas',
  //     },
  //   ],
  // },
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
          <Link href="/" className="flex items-center">
            <span className="font-mono text-xl font-bold text-white">
              &gt; hypequery
            </span>
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
              ) : item.children?.length ? (
                <div key={item.name} className="group relative">
                  <Link
                    href={item.href}
                    className="nav-link text-sm font-semibold leading-6 flex items-center gap-1 text-gray-900 dark:text-gray-100 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                  >
                    {item.name}
                    <ChevronDown className="h-4 w-4" />
                  </Link>
                  <div className="invisible absolute left-0 top-full mt-2 min-w-[220px] border border-gray-200 bg-white p-2 opacity-0 shadow-lg transition-all group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 dark:border-gray-700 dark:bg-[#111827]">
                    {item.children.map((child) => (
                      <Link
                        key={child.name}
                        href={child.href}
                        className="block px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-indigo-600 dark:text-gray-200 dark:hover:bg-gray-800 dark:hover:text-indigo-300"
                      >
                        {child.name}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                <Link
                  key={item.name}
                  href={item.href}
                  className="nav-link text-sm font-semibold leading-6 flex items-center gap-1 text-gray-900 dark:text-gray-100 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                >
                  {item.name}
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
    </header >
  );
}
