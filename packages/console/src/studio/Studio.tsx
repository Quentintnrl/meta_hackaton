import { useCallback, useEffect, useState } from 'react';
import { contentApi, teamApi, type AgentId, type ContentView, type Feature, type Project, type TeamView } from '../api';
import { InboxView } from './InboxView';
import { CalendarView } from './CalendarView';
import { RoadmapView } from './RoadmapView';
import { SettingsView } from './SettingsView';
import { DirectorPage } from './DirectorPage';
import { AgentPage } from './AgentPage';
import { AccountCard, AccountData, AuditCard } from './Insights';
import { ItemEditor } from './ItemEditor';
import { TeamPulse, agentState } from './Agents';

export type View = 'inbox' | 'calendar' | 'roadmap' | 'field' | 'account' | 'orders' | `agent:${AgentId}`;

const PAGES: Record<Exclude<View, `agent:${string}`>, { title: string; about: string }> = {
  inbox: { title: 'Inbox', about: 'What needs your decision today.' },
  calendar: { title: 'Calendar', about: 'Everything planned, by date. Click a piece to work on it.' },
  roadmap: { title: 'Roadmap', about: 'Your milestones, and where the team projects they will really land.' },
  field: { title: 'The field', about: 'What works for projects like yours, found by the Scout.' },
  account: { title: 'Your account', about: 'How your posts compare with the field, found by the Analyst.' },
  orders: { title: 'Orders & voice', about: 'What you tell the team once.' },
};

// The communication team of a project: a sub-menu on the left, one page at a time.
export function Studio({ project, features }: { project: Project; features: Feature[] }) {
  const [page, setPage] = useState<View>('inbox');
  const [view, setView] = useState<ContentView | null>(null);
  const [team, setTeam] = useState<TeamView | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [v, t] = await Promise.all([contentApi.view(project.id), teamApi.view(project.id)]);
    setView(v); setTeam(t);
  }, [project.id]);
  useEffect(() => { reload().catch(() => {}); }, [reload]);

  // While the team works, keep watching: proposals appear as soon as the Strategist is done.
  useEffect(() => {
    if (!team?.working) return;
    const timer = setInterval(() => void reload().catch(() => {}), 2000);
    return () => clearInterval(timer);
  }, [team?.working, reload]);

  if (!view || !team) return <section className="card"><p className="hint">Loading…</p></section>;

  const waiting = view.items.filter(i => i.status === 'idea').length + view.items.filter(i => i.status === 'drafted').length;
  const late = view.milestones.filter(m => m.atRisk).length;
  const nav: Array<{ group?: string; items: Array<[View, string, number?, string?]> }> = [
    { items: [['inbox', 'Inbox', waiting]] },
    { group: 'Plan', items: [['calendar', 'Calendar'], ['roadmap', 'Roadmap', late, 'late']] },
    { group: 'Research', items: [['field', 'The field'], ['account', 'Your account']] },
    { group: 'Team', items: [['agent:director', 'Director'], ['agent:scout', 'Scout'], ['agent:analyst', 'Analyst'], ['agent:strategist', 'Strategist'], ['agent:writer', 'Writer'], ['orders', 'Orders & voice']] },
  ];
  const open = view.items.find(i => i.id === openId);
  const agentId = page.startsWith('agent:') ? page.slice(6) as AgentId : undefined;
  const agentInfo = agentId && team.agents.find(a => a.id === agentId);
  const info = agentInfo ? { title: agentInfo.name, about: agentInfo.role + '.' } : PAGES[page as keyof typeof PAGES];

  return (
    <div className="studio">
      <nav className="subnav" aria-label="Studio">
        <span className="eyebrow">{project.name}</span>
        {nav.map((g, i) => (
          <div key={i} className="navgroup">
            {g.group && <span className="navlabel">{g.group}</span>}
            {g.items.map(([id, label, n, tone]) => (
              <button key={id} className={page === id ? 'navitem on' : 'navitem'} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}>
                <span className="navlabelrow">{id.startsWith('agent:') && <i className={`ndot ${agentState(team, id.slice(6) as AgentId)} ${team.config[id.slice(6) as AgentId]?.enabled === false ? 'off' : ''}`} />}{label}</span>{n ? <span className={`count ${tone ?? ''}`}>{n}</span> : null}
              </button>
            ))}
          </div>
        ))}
        <TeamPulse team={team} onOpen={() => setPage('agent:director')} />
      </nav>

      <div className="studio-main">
        <header className="page-head"><h2>{info.title}</h2><p className="hint">{info.about}</p></header>
        {page === 'inbox' && <InboxView pid={project.id} team={team} view={view} reload={reload} go={setPage} open={setOpenId} />}
        {page === 'calendar' && <CalendarView view={view} openId={openId} open={setOpenId} />}
        {page === 'roadmap' && <RoadmapView view={view} project={project} features={features} reload={reload} go={setPage} />}
        {page === 'field' && <AuditCard audit={team.audit} />}
        {page === 'account' && <div className="stack"><AccountCard team={team} /><AccountData pid={project.id} team={team} reload={reload} /></div>}
        {page === 'agent:director' && <DirectorPage pid={project.id} team={team} view={view} reload={reload} go={setPage} />}
        {agentId && agentId !== 'director' && <AgentPage key={agentId} pid={project.id} agent={agentId} team={team} view={view} reload={reload} go={setPage} />}
        {page === 'orders' && <SettingsView pid={project.id} view={view} reload={reload} />}
      </div>
      {open && <ItemEditor item={open} milestones={view.milestones} reload={reload} onClose={() => setOpenId(null)} />}
    </div>
  );
}
