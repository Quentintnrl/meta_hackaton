import { useCallback, useEffect, useState } from 'react';
import { api, type Project } from './api';
import { NewStudio } from './NewStudio';
import { Studio } from './studio/Studio';
import { useHashPath, writeHashPath } from './route';
import { parseAppView as parseView } from './route-path.ts';

// Content only: the dev pipeline (projects panel, features, timeline) is
// hidden from the UI but kept on disk and in the API. One studio per project.
export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false); // projects fetched at least once
  const [online, setOnline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setProjects(await api.projects());
      setOnline(true);
    } catch { setOnline(false); }
    setLoaded(true);
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 10000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [refresh]);

  // The URL drives the view: every navigation writes it, back/forward just work.
  const path = useHashPath();
  const view = parseView(path);
  const studioId = view?.kind === 'content' ? view.id : undefined;
  const showForm = view?.kind === 'new-project';

  // Land on the studio, with a real URL. Old dev URLs land here too.
  useEffect(() => {
    if (!loaded || showForm) return;
    const known = studioId && projects.some(p => p.id === studioId);
    if (!known) writeHashPath(projects[0] ? `/projects/${projects[0].id}/content` : '/new');
  }, [path, loaded, projects, showForm, studioId]);

  const project = projects.find(p => p.id === studioId);

  return (
    <div className="layout wide">
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

        <h3 className="eyebrow">Studios</h3>
        {projects.map(p => (
          <div key={p.id} className="project">
            <button className={p.id === studioId ? 'item active' : 'item'} onClick={() => writeHashPath(`/projects/${p.id}/content`)}>
              <b>{p.name}</b>
            </button>
          </div>
        ))}
        <button className="new" onClick={() => writeHashPath('/new')}><span>+</span> New studio</button>
      </aside>

      <main className="main">
        {showForm && <NewStudio first={projects.length === 0} onCreated={p => { refresh(); writeHashPath(`/projects/${p.id}/content`); }} />}
        {!showForm && project && <Studio key={project.id} project={project} />}
      </main>
    </div>
  );
}
