import { useState } from 'react';
import { teamApi, type Audit, type TeamView } from '../api';
import { ago, useAction } from './shared';

// One colour per format name, stable, so a format has the same colour in every chart.
const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const firstSentence = (t: string) => (t.match(/^.*?[.!?](\s|$)/)?.[0] ?? t).trim();
const money = (n: number) => n.toLocaleString();

function Stat({ value, label, tone }: { value: string | number; label: string; tone?: 'good' | 'warn' }) {
  return <div className={`bigstat ${tone ?? ''}`}><b>{value}</b><span>{label}</span></div>;
}

function Meter({ value }: { value: number }) {
  return <span className="meter" role="img" aria-label={`${value} out of 5`}>{[1, 2, 3, 4, 5].map(n => <i key={n} className={n <= value ? 'on' : ''} />)}</span>;
}

export function AuditCard({ audit }: { audit?: { data: Audit; at: string } }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!audit) return <section className="card empty"><p>The Scout has not looked yet.</p><p className="hint small">Brief the team from the Inbox, or open the Scout and press “Run Scout now”.</p></section>;
  const a = audit.data;
  const best = [...a.whatWorks].sort((x, y) => (y.strength ?? 3) - (x.strength ?? 3));
  return (
    <div className="stack">
      <section className="card hero-card">
        <p className="headline">{firstSentence(a.summary)}</p>
        <div className="stats">
          <Stat value={a.whatWorks.length} label="formats that work" />
          <Stat value={a.hooks.length} label="hooks that land" />
          <Stat value={a.topics.length} label="topics" />
          <Stat value={a.sources.length} label="sources" />
        </div>
        <p className="hint small">Researched {ago(audit.at)}.{a.sources.slice(0, 4).map((u, i) => <a key={u} href={u} target="_blank" rel="noopener noreferrer"> [{i + 1}]</a>)}</p>
      </section>

      <section>
        <div className="head"><h3>Formats that work</h3><span className="hint small">Click one for an example</span></div>
        <div className="tiles">{best.map(w => (
          <button key={w.format} className={`tile ${open === w.format ? 'open' : ''}`} style={{ ['--h' as string]: hue(w.format) }} onClick={() => setOpen(open === w.format ? null : w.format)} aria-expanded={open === w.format}>
            <span className="badgecircle">{w.format[0]?.toUpperCase()}</span>
            <b>{w.format}</b>
            <Meter value={w.strength ?? 3} />
            <span className="tile-why">{w.why}</span>
            {open === w.format && <em className="tile-ex">{w.example}</em>}
          </button>
        ))}</div>
      </section>

      <div className="two">
        <section className="card"><h3>Hooks that land</h3><div className="quotes">{a.hooks.map(h => <span key={h} className="quote">“{h}”</span>)}</div></section>
        <section className="card"><h3>What falls flat</h3><div className="chips">{a.avoid.map(h => <span key={h} className="pill neg">✕ {h}</span>)}</div></section>
      </div>
      <section className="card"><h3>Topics people care about</h3>
        <div className="cloud">{a.topics.map((t, i) => <span key={t} className="topic" style={{ fontSize: `${Math.max(12, 20 - i * 1.6)}px`, ['--h' as string]: hue(t) }}>{t}</span>)}</div>
      </section>
    </div>
  );
}

export function AccountCard({ team }: { team: TeamView }) {
  const report = team.account;
  const [full, setFull] = useState(false);
  if (!report) return <section className="card empty"><p>No comparison yet.</p><p className="hint small">Load your posts below, then brief the team: the Analyst compares them with the field.</p></section>;
  const r = report.data;
  const stats = r.stats;
  const max = Math.max(1, ...stats.map(s => s.avgEngagement));
  const best = stats[0], worst = stats.at(-1);
  const total = team.posts.reduce((a, p) => a + p.engagement, 0);
  const avg = team.posts.length ? Math.round(total / team.posts.length) : 0;
  const posts = [...team.posts].sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  const top = Math.max(1, ...posts.map(p => p.engagement));
  const formats = [...new Set(posts.map(p => p.format))];

  return (
    <div className="stack">
      <section className="card hero-card">
        {report.simulated && <span className="demo">Demo data, not real numbers</span>}
        <p className="headline">{firstSentence(r.summary)}</p>
        <div className="stats">
          <Stat value={r.postCount} label="posts analysed" />
          <Stat value={best?.format ?? '–'} label="best format" tone="good" />
          <Stat value={worst && worst !== best ? worst.format : '–'} label="weakest format" tone="warn" />
          <Stat value={money(avg)} label="average score per post" />
        </div>
      </section>

      <section className="card"><h3>Score per format</h3>
        <div className="bars" role="img" aria-label="Average score per format">{stats.map((s, i) => (
          <div key={s.format} className="barrow"><span>{s.format}</span><div><i className={i === 0 ? 'best' : i === stats.length - 1 && stats.length > 1 ? 'worst' : ''} style={{ width: `${(s.avgEngagement / max) * 100}%` }} /></div><b>{money(s.avgEngagement)}</b></div>
        ))}</div>
        <p className="hint small">Score = likes + 2 × comments + 3 × shares + 3 × saves.</p>
      </section>

      {posts.length > 1 && (
        <section className="card"><h3>Your posts over time</h3>
          <svg className="spark" viewBox={`0 0 ${posts.length * 28} 90`} preserveAspectRatio="none" role="img" aria-label="Score of each post, oldest to newest">
            {posts.map((p, i) => { const h = Math.max(3, (p.engagement / top) * 80); return <rect key={i} x={i * 28 + 4} y={86 - h} width={20} height={h} rx={4} fill={`hsl(${hue(p.format)} 65% 55%)`}><title>{`${p.format}: ${p.text} (${p.engagement})`}</title></rect>; })}
          </svg>
          <div className="legend2">{formats.map(f => <span key={f}><i style={{ background: `hsl(${hue(f)} 65% 55%)` }} />{f}</span>)}</div>
        </section>
      )}

      <div className="two">
        <section className="card"><h3>Going well</h3><div className="chips">{r.strengths.map(x => <span key={x} className="pill good">＋ {x}</span>)}</div></section>
        <section className="card"><h3>Missing vs the field</h3><div className="chips">{r.gaps.map(x => <span key={x} className="pill neg">－ {x}</span>)}</div></section>
      </div>
      {r.opportunities.length > 0 && <section className="card"><h3>Opportunities</h3><div className="chips">{r.opportunities.map(x => <span key={x} className="pill">{x}</span>)}</div></section>}
      <button className="linkish left" onClick={() => setFull(!full)}>{full ? 'Hide' : 'Read'} the full analysis</button>
      {full && <section className="card"><p>{r.summary}</p></section>}
    </div>
  );
}

// Where the Analyst gets its numbers: pasted by the manager, or fictional demo posts.
export function AccountData({ pid, team, reload }: { pid: string; team: TeamView; reload: () => Promise<void> }) {
  const [paste, setPaste] = useState('');
  const { busy, error, run } = useAction(reload);
  return (
    <details className="card" open={team.accountPosts === 0}>
      <summary><b>{team.accountPosts > 0 ? 'Update your posts' : 'Add your posts'}</b> <span className="hint small">{team.accountPosts > 0 ? `${team.accountPosts} loaded${team.account?.simulated ? ' (demo)' : ''}` : 'needed for the comparison'}</span></summary>
      <label>Paste your recent posts with their numbers<textarea rows={5} value={paste} onChange={e => setPaste(e.target.value)} placeholder={'Any format, copied from your analytics:\n“How we built the first screen” — 410 likes, 38 comments, 52 shares — 2026-10-12'} /></label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy !== '' || !paste.trim()} onClick={() => run('paste', async () => { await teamApi.setAccount(pid, { paste }); setPaste(''); })}>{busy === 'paste' ? 'Reading your posts…' : 'Load these posts'}</button>
        <button disabled={busy !== ''} onClick={() => run('demo', () => teamApi.setAccount(pid, { demo: true }))}>Use a demo account</button>
      </div>
    </details>
  );
}
