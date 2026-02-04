import {
  Book,
  Braces,
} from 'lucide-react';
import { SearchToggle } from 'fumadocs-ui/components/dialog/search';

export function baseOptions() {
  return {
    nav: {
      title: (
        <div className="px-3 font-mono text-lg font-bold text-indigo-300 flex items-center">
          &gt; hypequery
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
      search: {
        component: <SearchToggle />,
      },
    },
    theme: false,
  };
}
