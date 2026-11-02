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
import { InsightsView } from './InsightsView';
import { TeamPulse } from './Agents';
import { NextView } from './NextView';
import { SettingsView } from './SettingsView';
import { CommunityBoard, CreateBoard, DutyLine, PlatformsBoard, WatchBoard } from './boards';

export type View = 'studio' | 'platforms' | 'community' | 'watch' | 'next' | 'settings' | 'today' | 'create' | 'calendar' | 'insights' | 'team' | `agent:${AgentId}`;

const PAGES: Record<Exclude<View, `agent:${string}`>, { title: string; about: string }> = {
  studio: { title: 'Create', about: 'What the team proposes, what is being written, what is ready. You say yes or no; nothing is written or posted without you.' },
  platforms: { title: 'Platforms', about: 'One card per place you publish: its audience, its rhythm, what is planned there, and where to feed it.' },
  community: { title: 'Community', about: 'Who follows, what they reacted to, and whether anyone talks back.' },
  watch: { title: 'Competitors', about: 'What comparable players actually post, with the links, and the dates your audience gathers around.' },
  next: { title: 'What to post next', about: 'The team proposes, with its reasons. You say yes or no. Nothing is written or posted without you.' },
  settings: { title: 'Voice, orders and publishing', about: 'Written once, read by every agent before it works.' },
  today: { title: 'Today', about: 'What the team did, and what waits for you: ideas to judge, drafts to review, pieces to post.' },
  create: { title: 'Brief the team', about: 'Say what you want. The Scout researches, the Analyst scores your posts, the Strategist proposes. The ideas land in Today.' },
  calendar: { title: 'Calendar', about: 'What you are building towards and when it really lands, then every piece on its day.' },
  insights: { title: 'Insights', about: 'The numbers: the plan, your account against the field, and what the research measured.' },
  team: { title: 'Team', about: 'Five agents: what each one does, what it did last, how many of them work at once, and the rules they all follow.' },
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

  // Escape closes the piece editor, like any drawer.
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenId(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [openId]);

  // While the team works, keep watching: proposals appear as soon as the Strategist is done.
  useEffect(() => {
    if (!team?.working) return;
    const timer = setInterval(() => void reload().catch(() => {}), 2000);
    return () => clearInterval(timer);
  }, [team?.working, reload]);

  if (!view || !team) return <section className="card" role="status">{loadError ? <><p className="error">The studio did not load: {loadError}</p><p><button className="primary" onClick={() => reload().catch(e => setLoadError((e as Error).message))}>Retry</button></p></> : <p className="hint pulse-text">Loading your studio…</p>}</section>;

  const waiting = view.items.filter(i => i.status === 'idea').length + view.items.filter(i => i.status === 'drafted').length + view.items.filter(i => i.status === 'approved').length;
  const late = view.milestones.filter(m => m.atRisk).length;
  // One page, plus the settings. The older pages stay reachable from the foot of the page and by URL.
  const nav: Array<[View, string, number?, string?]> = [
    ['studio', 'Create', waiting],
    ['platforms', 'Platforms'],
    ['community', 'Community'],
    ['watch', 'Competitors'],
    ['settings', 'Settings'],
    ...(['next', 'today', 'create', 'calendar', 'insights', 'team'].includes(page) ? [[page, PAGES[page as keyof typeof PAGES].title, page === 'calendar' ? late : undefined, 'late'] as [View, string, number?, string?]] : []),
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
      const media = i.media ? ` Media: ${i.media.format} with ${i.media.slides.length} shot(s): ${i.media.slides.map((s, n) => `${n + 1}. made from "${s.visual}"${s.text ? `, on it: "${s.text}"` : ''} (${s.file ? 'picture generated' : 'no picture yet'})`).join('; ')}` : '';
      return { agent: a.agent as AgentId, kind: 'item', id: a.id, label: i.title, context: `Piece "${i.title}" (${i.kind}, ${i.status}). Brief: ${i.brief || '(none)'}${i.rationale ? ` Why it was suggested: ${i.rationale}` : ''}${i.draft ? ` Current text (may be long): ${i.draft.slice(0, 600)}` : ''}${media}` };
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
  const aboutKey = (r: { kind: 'item' | 'milestone' | null; id: string | null }) => r.kind && r.id ? `${r.kind}:${r.id}` : undefined;
  const pageCtx = onOwnPage && resolved ? { label: resolved.label, context: resolved.context || undefined, about: aboutKey(resolved) } : null;
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
        <header className="page-head"><h2>{info.title}</h2><p className="hint">{info.about}</p><DutyLine team={team} go={setPage} /></header>
        {page === 'studio' && <CreateBoard pid={project.id} team={team} view={view} reload={reload} go={setPage} open={setOpenId} askAgent={askAgent} />}
        {page === 'platforms' && <PlatformsBoard pid={project.id} team={team} view={view} reload={reload} go={setPage} open={setOpenId} askAgent={askAgent} />}
        {page === 'community' && <CommunityBoard pid={project.id} team={team} view={view} reload={reload} go={setPage} open={setOpenId} askAgent={askAgent} />}
        {page === 'watch' && <WatchBoard pid={project.id} team={team} view={view} reload={reload} go={setPage} open={setOpenId} askAgent={askAgent} />}
        {page === 'next' && <NextView pid={project.id} team={team} view={view} reload={reload} go={setPage} open={setOpenId} askAgent={askAgent} />}
        {page === 'settings' && <SettingsView pid={project.id} view={view} reload={reload} />}
        {page === 'today' && <TodayView team={team} view={view} reload={reload} go={setPage} open={setOpenId} askAgent={askAgent} />}
        {page === 'create' && <CreateView pid={project.id} team={team} view={view} reload={reload} go={setPage} open={setOpenId} askAgent={askAgent} />}
        {page === 'calendar' && <div className="stack"><RoadmapView view={view} project={project} features={[]} reload={reload} go={setPage} askAgent={askAgent} /><CalendarView view={view} openId={openId} open={setOpenId} /></div>}
        {page === 'insights' && <InsightsView pid={project.id} team={team} view={view} reload={reload} go={setPage} askAgent={askAgent} />}
        {page === 'team' && <TeamPage pid={project.id} team={team} view={view} reload={reload} go={setPage} askAgent={askAgent} />}
        {page === 'agent:director' && <DirectorPage pid={project.id} team={team} view={view} reload={reload} go={setPage} />}
        {agentId && agentId !== 'director' && <AgentPage key={agentId} pid={project.id} agent={agentId} team={team} view={view} reload={reload} go={setPage} aboutCtx={pageCtx} onClearAbout={clearAbout} />}
      </div>
      {open && <ItemEditor item={open} milestones={view.milestones} series={view.series} reload={reload} onClose={() => setOpenId(null)} goItem={id => { setPage('studio'); setOpenId(id); }} askAgent={askAgent} />}
      {drawerCtx && <ChatDrawer pid={project.id} agent={drawerCtx.agent} role={team.agents.find(a => a.id === drawerCtx.agent)?.role ?? ''} team={team} starters={drawerCtx.agent === 'director' ? [] : ABOUT[drawerCtx.agent].starters} context={drawerCtx.context || undefined} about={aboutKey(drawerCtx)} aboutLabel={drawerCtx.label || undefined} onClose={clearAbout} reload={reload} goAgent={a => writeHashPath(studioToHash(project.id, `agent:${a}`, openId, { agent: a, kind: drawerCtx.kind, id: drawerCtx.id }))} />}
    </div>
  );
}
