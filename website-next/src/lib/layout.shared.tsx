import {
  Book,
  Braces,
} from 'lucide-react';

export function baseOptions() {
  return {
    nav: {
      title: (
        <div className="flex items-center">
          <img src="/logo.svg" width={175} />
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
          title: 'Standalone Usage',
          description: 'Use the ClickHouse client directly',
          url: '/docs/standalone-usage/introduction',
          icon: <Braces className="w-4 h-4 text-purple-500" />,
        },
      ],
    },
  };
}
