export function baseOptions() {
  return {
    nav: {
      title: (
        <div className="flex items-center px-3 font-mono text-lg font-bold text-text">
          &gt; hypequery
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
