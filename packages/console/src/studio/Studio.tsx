import { useCallback, useEffect, useRef, useState } from 'react';
import { contentApi, teamApi, type ContentView, type Feature, type Project, type TeamView as Team } from '../api';
import { TeamView } from './TeamView';
import { CalendarView } from './CalendarView';
import { RoadmapView } from './RoadmapView';
import { SettingsView } from './SettingsView';

type Tab = 'team' | 'calendar' | 'roadmap' | 'settings';

// The communication team of a project: brief it, decide on its proposals, follow the calendar and the roadmap.
export function Studio({ project, features }: { project: Project; features: Feature[] }) {
  const [tab, setTab] = useState<Tab>('team');
  const [view, setView] = useState<ContentView | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const wasWorking = useRef(false);

  const reload = useCallback(async () => {
    const [v, t] = await Promise.all([contentApi.view(project.id), teamApi.view(project.id)]);
    setView(v); setTeam(t);
    wasWorking.current = Boolean(t.working);
  }, [project.id]);
  useEffect(() => { reload().catch(() => {}); }, [reload]);

  // While the team works, keep watching; the proposals appear as soon as the Strategist is done.
  useEffect(() => {
    if (!team?.working) return;
    const timer = setInterval(() => void reload().catch(() => {}), 2000);
    return () => clearInterval(timer);
  }, [team?.working, reload]);

  if (!view || !team) return <section className="card"><p className="hint">Loading…</p></section>;
  const waiting = view.items.filter(i => i.status === 'idea').length;
  const tabs: Array<[Tab, string, number?]> = [['team', 'Team', waiting], ['calendar', 'Calendar'], ['roadmap', 'Roadmap'], ['settings', 'Orders & account']];

  return (
    <div className="studio">
      <header className="studio-head">
        <div><span className="eyebrow">{project.name}</span><h2>Communication studio</h2></div>
        <nav className="tabs" role="tablist">
          {tabs.map(([id, name, n]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{name}{n ? <span className="count">{n}</span> : null}</button>)}
        </nav>
      </header>
      {tab === 'team' && <TeamView pid={project.id} team={team} view={view} reload={reload} onSettings={() => setTab('settings')} />}
      {tab === 'calendar' && <CalendarView view={view} reload={reload} />}
      {tab === 'roadmap' && <RoadmapView view={view} project={project} features={features} reload={reload} />}
      {tab === 'settings' && <SettingsView pid={project.id} view={view} team={team} reload={reload} />}
    </div>
  );
}
