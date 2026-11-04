import { useState } from 'react';
import { api, contentApi, type Project } from './api';
import { lang, t } from './i18n';

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
      await contentApi.setProfile(p.id, { voice: '', audience: audience.trim(), language: lang === 'fr' ? 'French' : 'English', autoDraft: false, niche: about.trim(), directives: '', publishMode: 'local' });
      onCreated(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>{first ? t('Start your first studio') : t('New studio')}</h2>
      <p className="hint">{t('A studio is where your content gets planned, written and published.')}</p>
      <label>{t('Name')}<input value={name} onChange={e => setName(e.target.value)} placeholder="Mealkinator" /></label>
      <label>{t('What is it about?')}<input value={about} onChange={e => setAbout(e.target.value)} placeholder={t('Weekly meal planning')} /></label>
      <label>{t('Who is it for?')}<input value={audience} onChange={e => setAudience(e.target.value)} placeholder={t('Busy home cooks')} /></label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy || !name.trim()} onClick={submit}>{busy ? t('Creating…') : t('Create studio')}</button>
      </div>
    </section>
  );
}
