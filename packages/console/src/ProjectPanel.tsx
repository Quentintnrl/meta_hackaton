import { useEffect, useState } from 'react';
import { api, label, tone, type Feature, type FixKind, type Project } from './api';

const FIX_NAMES: Record<FixKind, string> = {
  retry: 'Try the failed step again',
  'prune-worktrees': 'Clean git\'s list of working folders, then retry',
  'reset-branch': 'Remove the leftovers of an earlier attempt, then rebuild',
};

export function ProjectPanel({ project, features, onOpen, onNewFeature, onRemoved }: {
  project: Project;
  features: Feature[];
  onOpen: (id: string) => void;
  onNewFeature: () => void;
  onRemoved: () => void;
}) {
  const [error, setError] = useState('');
  const [auto, setAuto] = useState<FixKind[]>([]);
  useEffect(() => { api.autofix().then(setAuto).catch(() => {}); }, []);

  return (
    <div className="stack">
      <section className="card">
        <div className="head">
          <h2>{project.name}</h2>
          <button className="primary" onClick={onNewFeature}>+ New feature</button>
        </div>
        <dl className="meta">
          <dt>Repo</dt>
          <dd>{project.repoUrl
            ? (/^https:\/\//.test(project.repoUrl) ? <a href={project.repoUrl} target="_blank" rel="noopener noreferrer">{project.repoUrl}</a> : <code>{project.repoUrl}</code>)
            : <span className="hint">local only, not on GitHub</span>}</dd>
          <dt>Origin</dt>
          <dd>{{ link: 'Local folder, used in place', clone: 'Cloned from GitHub', scratch: 'Created from scratch' }[project.source]}</dd>
          <dt>Path</dt>
          <dd><code>{project.path}</code></dd>
        </dl>
      </section>

      {auto.length > 0 && (
        <section className="card">
          <h3>Automatic fixes</h3>
          <p className="hint small">When a step fails in a way you already said yes to, these are applied without asking (once per failure).</p>
          <ul className="rows">
            {auto.map(k => (
              <li key={k}><div className="autofix"><span>{FIX_NAMES[k]}</span><button onClick={() => api.stopAutofix(k).then(setAuto).catch(e => setError((e as Error).message))}>Ask me again</button></div></li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h3>Features</h3>
        {features.length === 0 && <p className="hint">No feature yet. Describe a mockup change to start one.</p>}
        <ul className="rows">
          {features.map(f => (
            <li key={f.id}>
              <button onClick={() => onOpen(f.id)}>
                <b>{f.title}</b>
                <span className={`badge ${tone(f.state)}`}><i />{label(f.state)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card danger">
        <h3>Remove project</h3>
        <p className="hint">Only unregisters it here. The repository on disk is not touched.</p>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button disabled={features.length > 0} onClick={() => api.removeProject(project.id).then(onRemoved).catch(e => setError((e as Error).message))}>Remove</button>
          {features.length > 0 && <span className="hint small">A project with features cannot be removed.</span>}
        </div>
      </section>
    </div>
  );
}
