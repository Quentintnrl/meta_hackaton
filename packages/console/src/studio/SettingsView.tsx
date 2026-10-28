import { useState } from 'react';
import { contentApi, type ContentView } from '../api';
import { useAction } from './shared';

// Orders and voice: what you tell the team once.
export function SettingsView({ pid, view, reload }: { pid: string; view: ContentView; reload: () => Promise<void> }) {
  const [p, setP] = useState(view.profile);
  const { busy, error, run } = useAction(reload);
  const dirty = JSON.stringify(p) !== JSON.stringify(view.profile);
  return (
    <div className="stack">
      <section className="card">
        <h3>Standing orders</h3>
        <p className="hint">Every agent follows these.</p>
        <label>Your orders<textarea rows={3} value={p.directives} onChange={e => setP({ ...p, directives: e.target.value })} placeholder="Never mention pricing. Prefer short videos over long posts. At most two posts a week." /></label>
        <label>What the project is about<input value={p.niche} onChange={e => setP({ ...p, niche: e.target.value })} placeholder="meal planning app for people who hate planning" /></label>
      </section>
      <section className="card">
        <h3>Voice and audience</h3>
        <label>Voice<textarea rows={2} value={p.voice} onChange={e => setP({ ...p, voice: e.target.value })} placeholder="Warm, direct, a bit of humour." /></label>
        <div className="two">
          <label>Audience<input value={p.audience} onChange={e => setP({ ...p, audience: e.target.value })} placeholder="Busy home cooks" /></label>
          <label>Language<input value={p.language} onChange={e => setP({ ...p, language: e.target.value })} /></label>
        </div>
        <label className="inline"><span>Let the Writer draft accepted pieces a few days before they are due (never approves or publishes)</span><input type="checkbox" style={{ width: 'auto' }} checked={p.autoDraft} onChange={e => setP({ ...p, autoDraft: e.target.checked })} /></label>
      </section>
      {error && <p className="error">{error}</p>}
      <div className="row"><button className="primary" disabled={!dirty || busy !== ''} onClick={() => run('save', () => contentApi.setProfile(pid, p))}>{dirty ? 'Save changes' : 'Saved'}</button></div>
    </div>
  );
}
