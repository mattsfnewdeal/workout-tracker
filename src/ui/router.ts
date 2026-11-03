import { useEffect, useState } from 'preact/hooks';

export function currentPath(): string {
  const h = location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h : `/${h}`;
}

export function useHashRoute(): string {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const on = () => setPath(currentPath());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return path;
}

export function navigate(path: string, replace = false): void {
  if (replace) location.replace(`#${path}`);
  else location.hash = path;
}

/** Match "/log/:id" style patterns. Returns params or null. */
export function matchRoute(path: string, pattern: string): Record<string, string> | null {
  const a = path.split('/').filter(Boolean);
  const b = pattern.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < b.length; i++) {
    if (b[i].startsWith(':')) params[b[i].slice(1)] = decodeURIComponent(a[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}
