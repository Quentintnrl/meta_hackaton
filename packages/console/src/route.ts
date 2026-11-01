import { useEffect, useState } from 'react';

// Hash URLs so a refresh lands back on the same page instead of the home
// screen. Hash routing needs no server fallback (unlike history routing),
// which matters for the Vite dev server, and no new dependency.
export function readHashPath(): string {
  return window.location.hash.replace(/^#/, '') || '/';
}

export function writeHashPath(path: string): void {
  if (readHashPath() !== path) window.location.hash = path;
}

export function useHashPath(): string {
  const [path, setPath] = useState(readHashPath);
  useEffect(() => {
    const onChange = () => setPath(readHashPath());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return path;
}
