import { useState } from 'react';
import { contentApi, teamApi, type ContentView, type TeamView } from '../api';
import { useAction } from './shared';

export function SettingsView({ pid, view, team, reload }: { pid: string; view: ContentView; team: TeamView; reload: () => Promise<void> }) {
  const [p, setP] = useState(view.profile);
  const [paste, setPaste] = useState('');
  const profile = useAction(reload);
  const account = useAction(reload);
  const dirty = JSON.stringify(p) !== JSON.stringify(view.profile);
  return (
    <div className="stack">
      <section className="card">
        <h3>Standing orders</h3>
        <p className="hint">What you tell the team once and want every agent to respect.</p>
        <label>Your orders<textarea rows={3} value={p.directives} onChange={e => setP({ ...p, directives: e.target.value })} placeholder="Never mention pricing. Prefer short videos over long posts. Post at most twice a week." /></label>
        <label>What the project is about, for the Scout<input value={p.niche} onChange={e => setP({ ...p, niche: e.target.value })} placeholder="meal planning app for people who hate planning" /></label>
        <div className="two">
          <label>Audience<input value={p.audience} onChange={e => setP({ ...p, audience: e.target.value })} placeholder="Busy home cooks" /></label>
          <label>Language<input value={p.language} onChange={e => setP({ ...p, language: e.target.value })} /></label>
        </div>
        <label>Voice<textarea rows={2} value={p.voice} onChange={e => setP({ ...p, voice: e.target.value })} placeholder="Warm, direct, a bit of humour." /></label>
        <label className="inline"><span>Let the Writer draft accepted pieces a few days before they are due (never approves or publishes)</span><input type="checkbox" style={{ width: 'auto' }} checked={p.autoDraft} onChange={e => setP({ ...p, autoDraft: e.target.checked })} /></label>
        {profile.error && <p className="error">{profile.error}</p>}
        <div className="row"><button className="primary" disabled={!dirty || profile.busy !== ''} onClick={() => profile.run('save', () => contentApi.setProfile(pid, p))}>Save</button></div>
      </section>

      <section className="card">
        <h3>Your account</h3>
        <p className="hint">The Analyst compares your posts with what works in your field. {team.accountPosts > 0 ? <b>{team.accountPosts} posts loaded{team.account?.simulated ? ' (demo data)' : ''}.</b> : 'None loaded yet.'}</p>
        <label>Paste your recent posts with their numbers<textarea rows={6} value={paste} onChange={e => setPaste(e.target.value)} placeholder={'Copy them from your platform’s analytics or export, any format:\n“How we built the first screen” — 410 likes, 38 comments, 52 shares, 71 saves — 2026-10-12\n…'} /></label>
        {account.error && <p className="error">{account.error}</p>}
        <div className="row">
          <button className="primary" disabled={account.busy !== '' || !paste.trim()} onClick={() => account.run('paste', async () => { await teamApi.setAccount(pid, { paste }); setPaste(''); })}>{account.busy === 'paste' ? 'Reading your posts…' : 'Load these posts'}</button>
          <button disabled={account.busy !== ''} onClick={() => account.run('demo', () => teamApi.setAccount(pid, { demo: true }))}>Use a demo account instead</button>
        </div>
        <p className="hint small">Demo posts are fictional and always labelled as such. Real figures are never invented: whatever is missing in your paste stays at 0.</p>
      </section>
    </div>
  );
}
