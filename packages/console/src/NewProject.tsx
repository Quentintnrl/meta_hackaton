import { useState } from 'react';
import { api, type NewProjectInput, type Project } from './api';

type Mode = 'clone' | 'scratch' | 'link';

const MODES: Array<{ id: Mode; title: string; hint: string }> = [
  { id: 'clone', title: 'From GitHub', hint: 'An existing repository, by URL. It is cloned into the Ripple_handoff workspace.' },
  { id: 'scratch', title: 'From scratch', hint: 'A new repository. Ripple_handoff creates it, then builds the first version as your first feature.' },
  { id: 'link', title: 'Local folder', hint: 'A repository already on this machine, used in place.' },
];

export function NewProject({ onCreated, first }: { onCreated: (p: Project, description?: string) => void; first: boolean }) {
  const [mode, setMode] = useState<Mode>('clone');
  const [name, setName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [path, setPath] = useState('');
  const [description, setDescription] = useState('');
  const [github, setGithub] = useState(false);
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const input: NewProjectInput | null =
    mode === 'clone' ? (repoUrl.trim() ? { source: 'clone', repoUrl, name: name || undefined } : null)
    : mode === 'link' ? (name.trim() && path.trim() ? { source: 'link', name, path } : null)
    : name.trim() ? { source: 'scratch', name, description: description || undefined, github: github ? { visibility } : undefined } : null;

  async function submit() {
    if (!input) return;
    setBusy(true);
    setError('');
    try {
      onCreated(await api.addProject(input), input.source === 'scratch' ? input.description : undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>{first ? 'Add your first project' : 'Add a project'}</h2>
      <p className="hint">A project is the app Ripple_handoff evolves. Its features live inside it.</p>

      <div className="tabs" role="tablist">
        {MODES.map(m => (
          <button key={m.id} role="tab" aria-selected={mode === m.id} className={mode === m.id ? 'tab on' : 'tab'} onClick={() => { setMode(m.id); setError(''); }}>{m.title}</button>
        ))}
      </div>
      <p className="hint small">{MODES.find(m => m.id === mode)!.hint}</p>

      {mode === 'clone' && (
        <>
          <label>Repo URL<input value={repoUrl} onChange={e => setRepoUrl(e.target.value)} placeholder="https://github.com/you/your-app" /></label>
          <label><span>Name <span className="opt">optional, defaults to the repo name</span></span><input value={name} onChange={e => setName(e.target.value)} /></label>
        </>
      )}

      {mode === 'scratch' && (
        <>
          <label>Name<input value={name} onChange={e => setName(e.target.value)} placeholder="Mealkinator" /></label>
          <label><span>What should it be? <span className="opt">becomes your first feature</span></span>
            <textarea rows={4} value={description} onChange={e => setDescription(e.target.value)} placeholder="A weekly meal planner: seven dinner cards, no account, French brasserie look." />
          </label>
          <fieldset>
            <legend>GitHub</legend>
            <label className="inline"><span>Also create a GitHub repository and push the first commit</span><input type="checkbox" checked={github} onChange={e => setGithub(e.target.checked)} /></label>
            {github && (
              <label className="inline">Visibility
                <select value={visibility} onChange={e => setVisibility(e.target.value as 'private' | 'public')}>
                  <option value="private">private</option>
                  <option value="public">public</option>
                </select>
              </label>
            )}
            <p className="hint small">{github ? 'This publishes to the GitHub account of the `gh` login on this machine.' : 'Stays on this machine until you decide otherwise.'}</p>
          </fieldset>
        </>
      )}

      {mode === 'link' && (
        <>
          <label>Name<input value={name} onChange={e => setName(e.target.value)} placeholder="Mealkinator" /></label>
          <label>Path to the repo<input value={path} onChange={e => setPath(e.target.value)} placeholder="/home/you/projects/mealkinator" /></label>
        </>
      )}

      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy || !input} onClick={submit}>
          {busy ? (mode === 'clone' ? 'Cloning…' : mode === 'scratch' ? 'Creating…' : 'Adding…') : mode === 'clone' ? 'Clone and add' : mode === 'scratch' ? 'Create project' : 'Add project'}
        </button>
      </div>
    </section>
  );
}
