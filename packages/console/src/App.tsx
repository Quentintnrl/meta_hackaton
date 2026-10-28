import { useCallback, useEffect, useRef, useState } from 'react';
import { api, label, tone, type Feature, type JournalEntry, type Project } from './api';
import { NewFeature } from './NewFeature';
import { NewProject } from './NewProject';
import { ProjectPanel } from './ProjectPanel';
import { Studio } from './studio/Studio';
import { FeaturePanel } from './FeaturePanel';
import { Timeline } from './Timeline';

type View = { kind: 'new-project' } | { kind: 'project'; id: string } | { kind: 'content'; id: string } | { kind: 'new-feature'; projectId: string; prefill?: { title: string; design: string } } | { kind: 'feature'; id: string };

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]); // all projects; each feature carries its projectId
  const [view, setView] = useState<View | null>(null);
  const [events, setEvents] = useState<JournalEntry[]>([]);
  const [online, setOnline] = useState(false);
  const [rev, setRev] = useState(0); // bumped on every event so open panels refetch

  const refresh = useCallback(async () => {
    try {
      const ps = await api.projects();
      setProjects(ps);
      setFeatures((await Promise.all(ps.map(p => api.features(p.id)))).flat());
    } catch { /* offline: the status dot says so */ }
  }, []);

  const lastId = useRef(0);
  const add = useCallback((incoming: JournalEntry[]) => {
    const fresh = incoming.filter(e => e.id > lastId.current);
    if (!fresh.length) return;
    lastId.current = Math.max(...fresh.map(e => e.id));
    setEvents(prev => [...prev, ...fresh.filter(e => !prev.some(p => p.id === e.id))]);
    setRev(r => r + 1);
    refresh();
  }, [refresh]);

  // Two ways to learn what happened. The event stream is instant, but can silently die (a proxy outliving a server
  // restart keeps the connection open and carries nothing). So the journal is also polled: the page always catches up.
  useEffect(() => {
    const es = new EventSource('/api/events');
    const types = ['CREATED', 'STATE', 'EVENT', 'PLAN', 'BUILD', 'BEFORE', 'VISUAL', 'VISUAL_SKIPPED', 'MERGE', 'ERROR'];
    types.forEach(t => es.addEventListener(t, m => add([JSON.parse((m as MessageEvent).data) as JournalEntry])));
    es.onopen = () => refresh();

    const poll = async () => {
      if (document.hidden) return;
      try {
        add(await api.journal(lastId.current));
        setOnline(true);
      } catch {
        setOnline(false);
      }
    };
    void poll();
    const timer = setInterval(poll, 2500);
    document.addEventListener('visibilitychange', poll); // catch up the moment the tab comes back
    return () => { es.close(); clearInterval(timer); document.removeEventListener('visibilitychange', poll); };
  }, [add, refresh]);

  // Land on something useful: the first project, or the form to add one.
  const effective: View = view ?? (projects[0] ? { kind: 'project', id: projects[0].id } : { kind: 'new-project' });
  const feature = effective.kind === 'feature' ? features.find(f => f.id === effective.id) : undefined;
  const projectOf = (id: string) => projects.find(p => p.id === id);
  const currentProject = projectOf(effective.kind === 'feature' ? feature?.projectId ?? '' : effective.kind === 'new-project' ? '' : effective.kind === 'new-feature' ? effective.projectId : effective.id);

  const scope = currentProject ? new Set(features.filter(f => f.projectId === currentProject.id).map(f => f.id)) : undefined;
  const shown = effective.kind === 'feature' ? events.filter(e => e.featureId === effective.id) : scope ? events.filter(e => scope.has(e.featureId)) : events;

  return (
    <div className={effective.kind === 'content' ? 'layout wide' : 'layout'}>
      <aside className="side">
        <div className="brand">
          <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden>
            <circle cx="16" cy="16" r="4" fill="currentColor" />
            <circle cx="16" cy="16" r="9" stroke="currentColor" strokeWidth="2" opacity=".6" />
            <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" opacity=".3" />
          </svg>
          <div>
            <h1>Ripple_handoff</h1>
            <p className={online ? 'status on' : 'status off'}><i />{online ? 'Connected' : 'Offline'}</p>
          </div>
        </div>

        <h3 className="eyebrow">Projects</h3>
        {projects.map(p => {
          const mine = features.filter(f => f.projectId === p.id);
          return (
            <div key={p.id} className="project">
              <button className={effective.kind === 'project' && effective.id === p.id ? 'item active' : 'item'} onClick={() => setView({ kind: 'project', id: p.id })}>
                <b>{p.name}</b>
              </button>
              <div className="children">
                {mine.map(f => (
                  <button key={f.id} className={effective.kind === 'feature' && effective.id === f.id ? 'item child active' : 'item child'} onClick={() => setView({ kind: 'feature', id: f.id })}>
                    <span>{f.title}</span>
                    <span className={`badge ${tone(f.state)}`}><i />{label(f.state)}</span>
                  </button>
                ))}
                <button className="add" onClick={() => setView({ kind: 'new-feature', projectId: p.id })}>+ New feature</button>
                <button className={effective.kind === 'content' && effective.id === p.id ? 'add active' : 'add'} onClick={() => setView({ kind: 'content', id: p.id })}>Communication studio</button>
              </div>
            </div>
          );
        })}
        <button className="new" onClick={() => setView({ kind: 'new-project' })}><span>+</span> Add project</button>
      </aside>

      <main className="main">
        {effective.kind === 'new-project' && <NewProject first={projects.length === 0} onCreated={(p, description) => {
          refresh();
          // From scratch: the description is the first feature, ready to plan.
          setView(description ? { kind: 'new-feature', projectId: p.id, prefill: { title: `First version of ${p.name}`, design: description } } : { kind: 'project', id: p.id });
        }} />}
        {effective.kind === 'project' && projectOf(effective.id) && (
          <ProjectPanel
            key={effective.id}
            project={projectOf(effective.id)!}
            features={features.filter(f => f.projectId === effective.id)}
            onOpen={id => setView({ kind: 'feature', id })}
            onNewFeature={() => setView({ kind: 'new-feature', projectId: effective.id })}
            onRemoved={() => { setView(null); refresh(); }}
          />
        )}
        {effective.kind === 'content' && projectOf(effective.id) && <Studio key={effective.id} project={projectOf(effective.id)!} features={features.filter(f => f.projectId === effective.id)} />}
        {effective.kind === 'new-feature' && projectOf(effective.projectId) && (
          <NewFeature
            key={effective.projectId + (effective.prefill?.title ?? '')}
            projectId={effective.projectId}
            projectName={projectOf(effective.projectId)!.name}
            prefill={effective.prefill}
            existing={features.map(f => f.id)}
            onCreated={id => { refresh(); setView({ kind: 'feature', id }); }}
          />
        )}
        {effective.kind === 'feature' && feature && <FeaturePanel key={feature.id} id={feature.id} rev={rev} project={projectOf(feature.projectId)} />}
      </main>

      {effective.kind !== 'content' && <aside className="timeline">
        <h3 className="eyebrow">Timeline{currentProject ? ` · ${currentProject.name}` : ''}</h3>
        <div className="tl-scroll">
          <Timeline events={shown} only={effective.kind === 'feature' ? effective.id : undefined} />
        </div>
      </aside>}
    </div>
  );
}
