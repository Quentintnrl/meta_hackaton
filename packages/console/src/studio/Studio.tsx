import { useCallback, useEffect, useState } from 'react';
import { contentApi, teamApi, type AgentId, type ContentView, type Feature, type Project, type TeamView } from '../api';
import { useHashPath, writeHashPath } from '../route';
import { parseStudio as parseStudioPath, studioToHash, type About } from '../route-path.ts';
import { CalendarView } from './CalendarView';
import { RoadmapView } from './RoadmapView';
import { DirectorPage } from './DirectorPage';
import { ABOUT, AgentPage } from './AgentPage';
import { ChatDrawer } from './Chat';
import { ItemEditor } from './ItemEditor';
import { TodayView } from './TodayView';
import { CreateView } from './CreateView';
import { TeamView as TeamPage } from './TeamView';
import { TeamPulse } from './Agents';

export type View = 'today' | 'create' | 'calendar' | 'team' | `agent:${AgentId}`;

const PAGES: Record<Exclude<View, `agent:${string}`>, { title: string; about: string }> = {
  today: { title: 'Today', about: 'Decide, review, publish.' },
  create: { title: 'Create', about: 'Ask for ideas, write what was accepted.' },
  calendar: { title: 'Calendar', about: 'Goals and dates. Click a piece to work on it.' },
  team: { title: 'Team', about: 'Who does what, what they found, what you told them.' },
};

// The communication team of a project: a sub-menu on the left, one page at a time.
// The open page (and drawer) lives in the URL, so a refresh lands back here.
const parseStudio = (path: string, projectId: string): { page: View; openId: string | null; about: About | null } => {
  const { page, openId, about } = parseStudioPath(path, projectId);
  return { page: page as View, openId, about };
};

export function Studio({ project }: { project: Project }) {
  const hashPath = useHashPath();
  const { page, openId, about } = parseStudio(hashPath, project.id);
  // The drawer lives next to the page: navigating keeps it, closing drops it.
  const setPage = (v: View) => writeHashPath(studioToHash(project.id, v, openId, about));
  const setOpenId = (id: string | null) => writeHashPath(studioToHash(project.id, page, id, about));
  const clearAbout = () => writeHashPath(studioToHash(project.id, page, openId));
  const [view, setView] = useState<ContentView | null>(null);
  const [team, setTeam] = useState<TeamView | null>(null);
  const [loadError, setLoadError] = useState('');

  const reload = useCallback(async () => {
    const [v, t] = await Promise.all([contentApi.view(project.id), teamApi.view(project.id)]);
    setView(v); setTeam(t); setLoadError('');
  }, [project.id]);
  useEffect(() => { reload().catch(e => setLoadError((e as Error).message)); }, [reload]);

  // While the team works, keep watching: proposals appear as soon as the Strategist is done.
  useEffect(() => {
    if (!team?.working) return;
    const timer = setInterval(() => void reload().catch(() => {}), 2000);
    return () => clearInterval(timer);
  }, [team?.working, reload]);

  if (!view || !team) return <section className="card">{loadError ? <><p className="error">The studio did not load: {loadError}</p><p><button className="primary" onClick={() => reload().catch(e => setLoadError((e as Error).message))}>Retry</button></p></> : <p className="hint">Loading…</p>}</section>;

  const waiting = view.items.filter(i => i.status === 'idea').length + view.items.filter(i => i.status === 'drafted').length + view.items.filter(i => i.status === 'approved').length;
  const late = view.milestones.filter(m => m.atRisk).length;
  const nav: Array<[View, string, number?, string?]> = [
    ['today', 'Today', waiting],
    ['create', 'Create'],
    ['calendar', 'Calendar', late, 'late'],
    ['team', 'Team'],
  ];
  // Open a side chat with an agent, staying on the page: the agent sees the
  // piece or goal, the manager just asks. Closing the drawer drops the context.
  const askAgent = (agent: AgentId, kind?: 'item' | 'milestone', id?: string) =>
    writeHashPath(studioToHash(project.id, page, openId, { agent, kind: kind ?? null, id: id ?? null }));
  const open = view.items.find(i => i.id === openId);
  const agentId = page.startsWith('agent:') ? page.slice(6) as AgentId : undefined;
  const agentInfo = agentId && team.agents.find(a => a.id === agentId);
  const info = agentInfo ? { title: agentInfo.name, about: agentInfo.role + '.' } : PAGES[page as keyof typeof PAGES];
  // What a chat is about, resolved for the prompt; nothing is shown except its title.
  const resolveAbout = (a: About): { agent: AgentId; kind: 'item' | 'milestone' | null; id: string | null; label: string; context: string } | null => {
    if (!( ['director', 'scout', 'analyst', 'strategist', 'writer'] as string[] ).includes(a.agent)) return null;
    if (a.kind === 'item' && a.id) {
      const i = view.items.find(x => x.id === a.id);
      if (!i) return null;
      return { agent: a.agent as AgentId, kind: 'item', id: a.id, label: i.title, context: `Piece "${i.title}" (${i.kind}, ${i.status}). Brief: ${i.brief || '(none)'}${i.rationale ? ` Why it was suggested: ${i.rationale}` : ''}${i.draft ? ` Current text (may be long): ${i.draft.slice(0, 600)}` : ''}` };
    }
    if (a.kind === 'milestone' && a.id) {
      const m = view.milestones.find(x => x.id === a.id);
      if (!m) return null;
      return { agent: a.agent as AgentId, kind: 'milestone', id: a.id, label: m.title, context: `Goal "${m.title}": ${m.intent || '(no description)'}. Wanted by ${m.targetDate}.` };
    }
    return { agent: a.agent as AgentId, kind: null, id: null, label: '', context: '' };
  };
  const resolved = about ? resolveAbout(about) : null;
  // On the agent's own page the chat is the page: feed it there. Anywhere
  // else the same context opens the side drawer instead.
  const onOwnPage = resolved ? page === `agent:${resolved.agent}` : false;
  const pageCtx = onOwnPage && resolved ? { label: resolved.label, context: resolved.context || undefined } : null;
  const drawerCtx = !onOwnPage ? resolved : null;

  return (
    <div className="studio">
      <nav className="subnav" aria-label="Studio">
        <span className="eyebrow">{project.name}</span>
        {nav.map(([id, label, n, tone]) => (
          <button key={id} className={page === id || (id === 'team' && page.startsWith('agent:')) ? 'navitem on' : 'navitem'} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}>
            <span className="navlabelrow">{label}</span>{n ? <span className={`count ${tone ?? ''}`}>{n}</span> : null}
          </button>
        ))}
        <TeamPulse team={team} onOpen={() => setPage('agent:director')} />
      </nav>

      <div className="studio-main">
        <header className="page-head"><h2>{info.title}</h2><p className="hint">{info.about} An AI team proposes, you decide.</p></header>
        {page === 'today' && <TodayView team={team} view={view} reload={reload} go={setPage} open={setOpenId} askAgent={askAgent} />}
        {page === 'create' && <CreateView pid={project.id} team={team} view={view} reload={reload} go={setPage} open={setOpenId} askAgent={askAgent} />}
        {page === 'calendar' && <div className="stack"><RoadmapView view={view} project={project} features={[]} reload={reload} go={setPage} askAgent={askAgent} /><CalendarView view={view} openId={openId} open={setOpenId} /></div>}
        {page === 'team' && <TeamPage pid={project.id} team={team} view={view} reload={reload} go={setPage} askAgent={askAgent} />}
        {page === 'agent:director' && <DirectorPage pid={project.id} team={team} view={view} reload={reload} go={setPage} />}
        {agentId && agentId !== 'director' && <AgentPage key={agentId} pid={project.id} agent={agentId} team={team} view={view} reload={reload} go={setPage} aboutCtx={pageCtx} onClearAbout={clearAbout} />}
      </div>
      {open && <ItemEditor item={open} milestones={view.milestones} series={view.series} reload={reload} onClose={() => setOpenId(null)} goItem={id => { setPage('today'); setOpenId(id); }} askAgent={askAgent} />}
      {drawerCtx && <ChatDrawer pid={project.id} agent={drawerCtx.agent} role={team.agents.find(a => a.id === drawerCtx.agent)?.role ?? ''} team={team} starters={drawerCtx.agent === 'director' ? [] : ABOUT[drawerCtx.agent].starters} context={drawerCtx.context || undefined} aboutLabel={drawerCtx.label || undefined} onClose={clearAbout} reload={reload} goAgent={a => writeHashPath(studioToHash(project.id, `agent:${a}`, openId, { agent: a, kind: drawerCtx.kind, id: drawerCtx.id }))} />}
    </div>
  );
}
