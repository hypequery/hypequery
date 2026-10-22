import { HypequeryMascotIcon } from '@/components/HypequeryMascotIcon';

export function baseOptions() {
  return {
    nav: {
      title: (
        <div className="flex items-center gap-2 px-3 font-mono text-[15px] font-bold text-text">
          <HypequeryMascotIcon className="h-6 w-auto shrink-0" />
          <span>hypequery</span>
        </div>
      ),
    },
    sidebar: {
      defaultOpenLevel: 0,
      // Sidebar tabs come from the `"root": true` folders under docs/.
      search: {
        enabled: true,
      },
    },
  };
}
