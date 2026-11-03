const TABS: { path: string; label: string; match: (p: string) => boolean }[] = [
  { path: '/', label: 'Today', match: (p) => p === '/' },
  { path: '/program', label: 'Program', match: (p) => p.startsWith('/program') },
  { path: '/history', label: 'History', match: (p) => p.startsWith('/history') },
  { path: '/settings', label: 'Settings', match: (p) => p.startsWith('/settings') },
];

export function TabBar({ path }: { path: string }) {
  return (
    <nav class="tabbar" aria-label="Main">
      {TABS.map((t) => (
        <a key={t.path} href={`#${t.path}`} class={`tab ${t.match(path) ? 'active' : ''}`} aria-current={t.match(path) ? 'page' : undefined}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}
