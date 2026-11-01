import { useState } from 'react';
import { api, contentApi, type Project } from './api';

// A studio is a project used for content only: a name, what it is about and
// who it speaks to. The voice and audience seed the team on first save.
export function NewStudio({ onCreated, first }: { onCreated: (p: Project) => void; first: boolean }) {
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [audience, setAudience] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      const p = await api.addProject({ source: 'scratch', name: name.trim() });
      await contentApi.setProfile(p.id, { voice: '', audience: audience.trim(), language: 'English', autoDraft: false, niche: about.trim(), directives: '' });
      onCreated(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>{first ? 'Start your first studio' : 'New studio'}</h2>
      <p className="hint">A studio is where your content gets planned, written and published.</p>
      <label>Name<input value={name} onChange={e => setName(e.target.value)} placeholder="Mealkinator" /></label>
      <label>What is it about?<input value={about} onChange={e => setAbout(e.target.value)} placeholder="Weekly meal planning" /></label>
      <label>Who is it for?<input value={audience} onChange={e => setAudience(e.target.value)} placeholder="Busy home cooks" /></label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy || !name.trim()} onClick={submit}>{busy ? 'Creating…' : 'Create studio'}</button>
      </div>
    </section>
  );
}
