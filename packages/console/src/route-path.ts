// Pure URL helpers for the hash routing: parsing a hash into a view and
// building hashes back. No imports (not even types), so plain `node --test`
// runs them with no dependency. The React hook lives in route.ts.
export type AppView = { kind: 'new-project' } | { kind: 'project'; id: string } | { kind: 'content'; id: string } | { kind: 'new-feature'; projectId: string } | { kind: 'feature'; id: string };

export function parseAppView(path: string): AppView | null {
  const segs = path.split('/').filter(Boolean);
  if (segs.length === 0) return null;
  if (segs[0] === 'new') return { kind: 'new-project' };
  if (segs[0] === 'features' && segs[1]) return { kind: 'feature', id: segs[1] };
  if (segs[0] === 'projects' && segs[1]) {
    if (segs[2] === 'content') return { kind: 'content', id: segs[1] };
    if (segs[2] === 'new-feature') return { kind: 'new-feature', projectId: segs[1] };
    if (segs.length === 2) return { kind: 'project', id: segs[1] };
  }
  return null;
}

export function appViewToHash(view: AppView): string {
  switch (view.kind) {
    case 'new-project': return '/new';
    case 'project': return `/projects/${view.id}`;
    case 'content': return `/projects/${view.id}/content`;
    case 'new-feature': return `/projects/${view.projectId}/new-feature`;
    case 'feature': return `/features/${view.id}`;
  }
}

export const STUDIO_PAGES = ['next', 'settings', 'today', 'create', 'calendar', 'insights', 'team'];
export const STUDIO_AGENTS = ['director', 'scout', 'analyst', 'strategist', 'writer'];

// Old pages land on their replacement: nothing bookmarked breaks.
const LEGACY_PAGE: Record<string, string> = { inbox: 'today', roadmap: 'calendar', field: 'insights', account: 'insights', orders: 'team' };

export function studioBase(projectId: string): string {
  return `/projects/${projectId}/content`;
}

// The studio page and open drawer from the hash. Unknown pages fall back to
// the inbox; unknown agents are not pages. `page` is 'inbox' | ... | 'agent:x'.
// `about` opens a side chat drawer with an agent: the agent sees the piece or
// goal, the manager just asks. It lives on any page, next to the open drawer.
export type About = { agent: string; kind: 'item' | 'milestone' | null; id: string | null };

export function parseStudio(path: string, projectId: string): { page: string; openId: string | null; about: About | null } {
  const prefix = studioBase(projectId);
  const rest = path.startsWith(prefix) ? path.slice(prefix.length).split('/').filter(Boolean) : [];
  let page = 'next';
  let tail = rest;
  if (tail[0] === 'agent' && STUDIO_AGENTS.includes(tail[1])) { page = `agent:${tail[1]}`; tail = tail.slice(2); }
  else if ((STUDIO_PAGES as string[]).includes(tail[0])) { page = tail[0]; tail = tail.slice(1); }
  else if (LEGACY_PAGE[tail[0]]) { page = LEGACY_PAGE[tail[0]]; tail = tail.slice(1); }
  const openId = tail[0] === 'item' && tail[1] ? tail[1] : null;
  if (openId) tail = tail.slice(2);
  const about: About | null = (tail[0] === 'about' && STUDIO_AGENTS.includes(tail[1]))
    ? { agent: tail[1], kind: (tail[2] === 'item' || tail[2] === 'milestone') && tail[3] ? tail[2] : null, id: (tail[2] === 'item' || tail[2] === 'milestone') && tail[3] ? tail[3] : null }
    : null;
  return { page, openId, about };
}

export function studioToHash(projectId: string, page: string, openId: string | null, about?: About | null): string {
  const seg = page.startsWith('agent:') ? `agent/${page.slice(6)}` : page;
  let h = openId ? `${studioBase(projectId)}/${seg}/item/${openId}` : `${studioBase(projectId)}/${seg}`;
  if (about && STUDIO_AGENTS.includes(about.agent)) {
    h += `/about/${about.agent}`;
    if ((about.kind === 'item' || about.kind === 'milestone') && about.id) h += `/${about.kind}/${about.id}`;
  }
  return h;
}
