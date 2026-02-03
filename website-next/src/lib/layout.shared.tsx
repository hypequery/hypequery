import {
  Book,
  Braces,
} from 'lucide-react';

export function baseOptions() {
  return {
    nav: {
      title: (
        <div className="flex items-center">
          <img src="/logo.svg" width={175} alt="HypeQuery" />
        </div>
      ),
    },
    sidebar: {
      defaultOpenLevel: 1,
      tabs: [
        {
          title: 'Documentation',
          description: 'Framework guide and getting started',
          url: '/docs',
          icon: <Book className="w-4 h-4 text-indigo-400" />,
        },
        {
          title: 'Standalone Query Builder',
          description: 'Build type safe queries with the ClickHouse client directly',
          url: '/docs/standalone-query-builder/introduction',
          icon: <Braces className="w-4 h-4 text-purple-500" />,
        },
      ],
    },
    theme: false,
  };
}
