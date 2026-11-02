import { useState } from 'react';
import { contentApi, type ContentView } from '../api';
import { useAction } from './shared';

// What you tell the team once. Each field says which agent reads it and what changes.
export function SettingsView({ pid, view, reload }: { pid: string; view: ContentView; reload: () => Promise<void> }) {
  const [p, setP] = useState(view.profile);
  const { busy, error, run } = useAction(reload);
  const dirty = JSON.stringify(p) !== JSON.stringify(view.profile);
  const Field = ({ label, effect, children }: { label: string; effect: string; children: React.ReactNode }) => <label className="field"><span className="field-label">{label}</span><span className="hint small">{effect}</span>{children}</label>;
  return (
    <div className="stack">
      <p className="hint">Everything on this page changes how the five agents work. Nothing here posts anything: the team proposes, you decide.</p>
      <section className="card">
        <h3>Who you are talking to</h3>
        <Field label="What the project is about" effect="The Scout searches the web with these words to find the field, the players and the dates. The Strategist reads it before every proposal."><input value={p.niche} onChange={e => setP({ ...p, niche: e.target.value })} placeholder="a shared workspace for French town halls: projects, calendar, messaging" /></Field>
        <Field label="Audience" effect="The Scout looks for where these people gather and what they read. Every proposal names who, among them, a piece is for."><input value={p.audience} onChange={e => setP({ ...p, audience: e.target.value })} placeholder="secrétaires de mairie, DGS and elected officials of small communes, on LinkedIn" /></Field>
        <div className="two">
          <Field label="Language" effect="Every proposal, draft and reading is written in it."><input value={p.language} onChange={e => setP({ ...p, language: e.target.value })} /></Field>
          <Field label="Voice" effect="The Writer writes every draft in this voice; the Analyst checks your posts against it."><input value={p.voice} onChange={e => setP({ ...p, voice: e.target.value })} placeholder="Warm, direct, vouvoiement, no sales pitch." /></Field>
        </div>
      </section>
      <section className="card">
        <h3>Your orders</h3>
        <Field label="Standing orders" effect="Every agent reads these before working: a proposal that breaks one is not made, a draft that breaks one is not written. Add a line each time you refuse something for a reason that should hold."><textarea rows={3} value={p.directives} onChange={e => setP({ ...p, directives: e.target.value })} placeholder="Never publish a price. At most two posts a week. Say “mairie”, not “client”." /></Field>
      </section>
      <section className="card">
        <h3>How the team works</h3>
        <label className="inline"><span><b>Team on duty.</b> About once a day, on its own, the Scout watches the field and the Analyst reads your posts; the Strategist proposes only when nothing waits for your answer. It never writes a draft or posts without you.</span><input type="checkbox" style={{ width: 'auto' }} checked={Boolean(p.autopilot)} onChange={e => setP({ ...p, autopilot: e.target.checked })} /></label>
        <label className="inline"><span><b>Writer drafts ahead.</b> A piece you accepted is written on its own three days before its date, so you find a draft to review instead of an empty brief. It never approves or posts.</span><input type="checkbox" style={{ width: 'auto' }} checked={p.autoDraft} onChange={e => setP({ ...p, autoDraft: e.target.checked })} /></label>
      </section>
      <section className="card">
        <h3>How pieces leave the studio</h3>
        <Field label="Publishing" effect="By hand: an approved piece gives you the text and the pictures to copy, and you mark it posted. Via a scheduler: the same, through your own tool. Automatically: a Meta app posts it for you, and needs a connected app.">
          <select value={p.publishMode} onChange={e => setP({ ...p, publishMode: e.target.value as typeof p.publishMode })}>
            <option value="local">By hand, here</option>
            <option value="assisted">By hand, via a scheduler</option>
            <option value="connected">Automatically, through a Meta app</option>
          </select>
        </Field>
      </section>
      {error && <p className="error">{error}</p>}
      <div className="row"><button className="primary" disabled={!dirty || busy !== ''} onClick={() => run('save', () => contentApi.setProfile(pid, p))}>{dirty ? 'Save changes' : 'Saved'}</button></div>
    </div>
  );
}
