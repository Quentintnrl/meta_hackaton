import { useState } from 'react';
import { teamApi, type AccountReport, type Audit, type TeamView } from '../api';
import { ago, useAction } from './shared';

export function AuditCard({ audit }: { audit?: { data: Audit; at: string } }) {
  if (!audit) return <section className="card empty"><p>The Scout has not looked yet.</p><p className="hint small">Go to the Inbox and brief the team: the Scout searches the web for what works in your field.</p></section>;
  return (
    <div className="stack">
      <section className="card">
        <p className="lead">{audit.data.summary}</p>
        <p className="hint small">Web research, {ago(audit.at)}.{audit.data.sources.slice(0, 4).map((u, i) => <a key={u} href={u} target="_blank" rel="noopener noreferrer"> [{i + 1}]</a>)}</p>
      </section>
      <section className="card"><h3>Formats that work</h3>
        <ul className="works">{audit.data.whatWorks.map(w => <li key={w.format}><b>{w.format}</b><span>{w.why}</span><em>{w.example}</em></li>)}</ul>
      </section>
      <div className="two">
        <section className="card"><h3>Hooks that land</h3><div className="chips">{audit.data.hooks.map(h => <span key={h} className="pill">{h}</span>)}</div>
          <h3 style={{ marginTop: 16 }}>Topics people care about</h3><div className="chips">{audit.data.topics.map(h => <span key={h} className="pill">{h}</span>)}</div></section>
        <section className="card"><h3>What falls flat</h3><div className="chips">{audit.data.avoid.map(h => <span key={h} className="pill neg">{h}</span>)}</div></section>
      </div>
    </div>
  );
}

export function AccountCard({ report }: { report?: { data: AccountReport; simulated: boolean; at: string } }) {
  const max = Math.max(1, ...(report?.data.stats.map(s => s.avgEngagement) ?? [1]));
  if (!report) return null;
  return (
    <div className="stack">
      <section className="card">
        {report.simulated && <span className="demo">Demo data, not real numbers</span>}
        <p className="lead">{report.data.summary}</p>
      </section>
      <section className="card"><h3>Average engagement per format</h3>
        <div className="bars" role="img" aria-label="Average engagement per format">{report.data.stats.map(s => (
          <div key={s.format} className="barrow"><span>{s.format}</span><div><i style={{ width: `${(s.avgEngagement / max) * 100}%` }} /></div><b>{s.avgEngagement}</b></div>
        ))}</div>
      </section>
      <div className="two">
        <section className="card"><h3>Strong</h3><ul className="plain">{report.data.strengths.map(x => <li key={x}>{x}</li>)}</ul></section>
        <section className="card"><h3>Missing vs the field</h3><ul className="plain">{report.data.gaps.map(x => <li key={x}>{x}</li>)}</ul></section>
      </div>
    </div>
  );
}

// Where the Analyst gets its numbers: pasted by the manager, or fictional demo posts.
export function AccountData({ pid, team, reload }: { pid: string; team: TeamView; reload: () => Promise<void> }) {
  const [paste, setPaste] = useState('');
  const { busy, error, run } = useAction(reload);
  return (
    <section className="card">
      <h3>Your posts</h3>
      <p className="hint">{team.accountPosts > 0 ? <b>{team.accountPosts} posts loaded{team.account?.simulated ? ' (demo data)' : ''}.</b> : 'None loaded yet.'} Paste more to replace them.</p>
      <label>Paste your recent posts with their numbers<textarea rows={5} value={paste} onChange={e => setPaste(e.target.value)} placeholder={'Any format, copied from your platform’s analytics:\n“How we built the first screen” — 410 likes, 38 comments, 52 shares — 2026-10-12'} /></label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy !== '' || !paste.trim()} onClick={() => run('paste', async () => { await teamApi.setAccount(pid, { paste }); setPaste(''); })}>{busy === 'paste' ? 'Reading your posts…' : 'Load these posts'}</button>
        <button disabled={busy !== ''} onClick={() => run('demo', () => teamApi.setAccount(pid, { demo: true }))}>Use a demo account instead</button>
      </div>
      <p className="hint small">Demo posts are fictional and always labelled. Missing figures stay at 0: nothing is invented.</p>
    </section>
  );
}
