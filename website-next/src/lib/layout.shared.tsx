import { Book, History } from 'lucide-react';
import { legacyTabUrls } from '@/lib/docs-sections';

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
      defaultOpenLevel: 0,
      tabs: [
        {
          title: 'Documentation',
          description: 'Framework guide and getting started',
          url: '/docs',
          icon: <Book className="w-4 h-4 text-indigo-400" />,
        },
        {
          title: 'Legacy Serve API',
          description: 'Builder-first serve docs for existing integrations',
          url: '/docs/legacy-serve/query-definitions',
          icon: <History className="w-4 h-4 text-amber-400" />,
          urls: legacyTabUrls,
        },
      ],
      search: {
        enabled: true,
      },
    },
  };
}
