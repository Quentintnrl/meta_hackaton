import { useEffect, useState } from 'react';
import { contentApi, hasFigure, teamApi, type AccountPost, type Audit, type ContentItem, type TeamView } from '../api';
import { FigureTile, StrengthChart, Thumb, hue } from './Numbers';
import { ago, useAction } from './shared';

const firstSentence = (t: string) => (t.match(/^.*?[.!?](\s|$)/)?.[0] ?? t).trim();
const money = (n: number) => n.toLocaleString();

function Stat({ value, label, tone }: { value: string | number; label: string; tone?: 'good' | 'warn' }) {
  return <div className={`bigstat ${tone ?? ''}`}><b>{value}</b><span>{label}</span></div>;
}

function Meter({ value }: { value: number }) {
  return <span className="meter" role="img" aria-label={`${value} out of 5`}>{[1, 2, 3, 4, 5].map(n => <i key={n} className={n <= value ? 'on' : ''} />)}</span>;
}

export function AuditCard({ pid, audit, log, onBrief }: { pid: string; audit?: { data: Audit; at: string }; log?: Array<{ data: Audit; at: string }>; onBrief?: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!audit) return (
    <section className="card guide">
      <h3>No field research yet</h3>
      <ol className="steps">
        <li><span className="tick">1</span><span>The Scout searches the web for what performs in your field right now, and keeps the figures it finds with their source.</span></li>
        <li><span className="tick">2</span><span>You get formats that work with a measured figure and an example each, the field's benchmarks, hooks that land, and flops with proof.</span></li>
        <li><span className="tick">3</span><span>The Strategist and the Director ground every idea and the plan in it.</span></li>
      </ol>
      <div className="row">{onBrief ? <button className="primary" onClick={onBrief}>Research the field now</button> : <span className="hint small">The team is already working…</span>}</div>
    </section>
  );
  const a = audit.data;
  const misses = a.misses ?? [];
  const benches = a.benchmarks ?? [];
  const past = (log ?? []).filter(l => l.at !== audit.at);
  const best = [...a.whatWorks].sort((x, y) => (y.strength ?? 3) - (x.strength ?? 3));
  const measured = a.whatWorks.filter(w => hasFigure(w.figure)).length;
  return (
    <div className="stack">
      <section className="card hero-card">
        <p className="headline">{firstSentence(a.summary)}</p>
        {benches.length > 0 ? (
          <div className="bench">{benches.map(b => <FigureTile key={b.name} figure={{ what: b.name, value: b.value, unit: b.unit, source: b.source, period: b.note }} />)}</div>
        ) : <p className="hint small">No benchmark figure found in this research. Ask the Scout to look again, or with more researchers.</p>}
        <StrengthChart rows={a.whatWorks} />
        <p className="hint small">Researched {ago(audit.at)} · {measured} of {a.whatWorks.length} formats with a measured figure · {a.sources.length} source{a.sources.length === 1 ? '' : 's'}{a.sources.slice(0, 4).map((u, i) => <a key={u} href={u} target="_blank" rel="noopener noreferrer"> [{i + 1}]</a>)}</p>
      </section>

      <section>
        <div className="head"><h3>Formats that work</h3><span className="hint small">Click one for its example</span></div>
        <div className="tiles">{best.map(w => (
          <button key={w.format} className={`tile ${open === w.format ? 'open' : ''}`} style={{ ['--h' as string]: hue(w.format) }} onClick={() => setOpen(open === w.format ? null : w.format)} aria-expanded={open === w.format}>
            <span className="badgecircle">{w.format[0]?.toUpperCase()}</span>
            <b>{w.format}</b>
            <Meter value={w.strength ?? 3} />
            <FigureTile figure={w.figure} />
            <span className="tile-why">{w.why}</span>
          </button>
        ))}</div>
        {open && (() => { const w = a.whatWorks.find(x => x.format === open)!; return (
          <div className="example card" style={{ ['--h' as string]: hue(w.format) }}>
            <Thumb pid={pid} url={w.exampleUrl ?? ''} alt={`Example of ${w.format}`} />
            <div>
              <b>Seen in the field · {w.format}</b>
              <em>{w.example}</em>
              {w.exampleFigure && <span className="evidence">{w.exampleFigure}</span>}
              {w.exampleUrl ? <a className="small" href={w.exampleUrl} target="_blank" rel="noopener noreferrer">Open the example ↗</a> : <span className="hint small">No link in the research for this one.</span>}
            </div>
          </div>
        ); })()}
      </section>

      <div className="two">
        <section className="card"><h3>Hooks that land</h3><div className="quotes">{a.hooks.map(h => <span key={h} className="quote">“{h}”</span>)}</div></section>
        <section className="card"><h3>What falls flat</h3><div className="chips">{a.avoid.map(h => <span key={h} className="pill neg">✕ {h}</span>)}</div></section>
      </div>
      {misses.length > 0 && (
        <section>
          <div className="head"><h3>What flops, with proof</h3><span className="hint small">Seen in the field, not guessed</span></div>
          <div className="tiles">{misses.map(m => (
            <div key={m.format} className="tile miss" style={{ ['--h' as string]: hue(m.format) }}>
              <span className="badgecircle">✕</span>
              <b>{m.format}</b>
              <span className="tile-why">{m.why}</span>
              <em className="tile-ex">Seen: {m.example}</em>
            </div>
          ))}</div>
        </section>
      )}
      <section className="card"><h3>Topics people care about</h3>
        <div className="cloud">{a.topics.map((t, i) => <span key={t} className="topic" style={{ fontSize: `${Math.max(12, 20 - i * 1.6)}px`, ['--h' as string]: hue(t) }}>{t}</span>)}</div>
      </section>
      {past.length > 0 && (
        <section className="card"><h3>Watch log</h3>
          <p className="hint small">Earlier field research, newest first. Re-brief the team to refresh it.</p>
          <ul className="feed">{past.map(p => (
            <li key={p.at}><span className="dot" style={{ ['--h' as string]: 250 }} /><span>{firstSentence(p.data.summary)}</span><time>{ago(p.at)}</time></li>
          ))}</ul>
        </section>
      )}
    </div>
  );
}

export function AccountCard({ team }: { team: TeamView }) {
  const report = team.account;
  const [full, setFull] = useState(false);
  if (!report) return (
    <section className="card guide">
      <h3>No comparison yet</h3>
      <ol className="steps">
        <li><span className="tick">1</span><span>Load your posts below (paste or CSV): the Analyst scores each one.</span></li>
        <li><span className="tick">2</span><span>You get scores per format, your 3 best and 3 weakest posts with why, and gaps vs the field.</span></li>
        <li><span className="tick">3</span><span>The Strategist stops proposing what flops for you and doubles down on what wins.</span></li>
      </ol>
    </section>
  );
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

      {(r.winners?.length || r.losers?.length) ? (
        <div className="two">
          {(r.winners?.length ?? 0) > 0 && (
            <section className="card"><h3>Your best posts</h3>
              <ul className="verdicts">{r.winners!.map((w, i) => (
                <li key={i}><b>#{i + 1} · {w.format} · {money(w.engagement)}</b><span>{w.text}</span><em>{w.note}</em></li>
              ))}</ul>
            </section>
          )}
          {(r.losers?.length ?? 0) > 0 && (
            <section className="card"><h3>Your flops</h3>
              <ul className="verdicts flop">{r.losers!.map((w, i) => (
                <li key={i}><b>{w.format} · {money(w.engagement)}</b><span>{w.text}</span><em>{w.note}</em></li>
              ))}</ul>
            </section>
          )}
        </div>
      ) : null}

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
export function AccountData({ pid, team, items, reload }: { pid: string; team: TeamView; items: ContentItem[]; reload: () => Promise<void> }) {
  const [paste, setPaste] = useState('');
  const { busy, error, run } = useAction(reload);
  return (
    <>
    <details className="card" open={team.accountPosts === 0}>
      <summary><b>{team.accountPosts > 0 ? 'Update your posts' : 'Add your posts'}</b> <span className="hint small">{team.accountPosts > 0 ? `${team.accountPosts} loaded${team.account?.simulated ? ' (demo)' : ''}` : 'needed for the comparison'}</span></summary>
      <label>Paste your recent posts with their numbers<textarea rows={5} value={paste} onChange={e => setPaste(e.target.value)} placeholder={'Any format, copied from your analytics:\n“How we built the first screen” — 410 likes, 38 comments, 52 shares — 2026-10-12\n\nOr a table with a text,likes header (exact numbers, no model involved):\ntext,format,likes,comments,shares,saves,posted_at'} /></label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy !== '' || !paste.trim()} onClick={() => run('paste', async () => { await teamApi.setAccount(pid, { paste }); setPaste(''); })}>{busy === 'paste' ? 'Reading your posts…' : 'Load these posts'}</button>
        <button disabled={busy !== ''} onClick={() => run('demo', () => teamApi.setAccount(pid, { demo: true }))}>Use a demo account</button>
      </div>
    </details>
    {team.accountPosts > 0 && <PostLinks pid={pid} items={items} />}
    </>
  );
}

// Which studio piece each posted piece came from: the team learns from what worked.
function PostLinks({ pid, items }: { pid: string; items: ContentItem[] }) {
  const [posts, setPosts] = useState<AccountPost[] | null>(null);
  const [failed, setFailed] = useState('');
  const [saving, setSaving] = useState<number | null>(null);
  useEffect(() => { contentApi.accountPosts(pid).then(setPosts).catch(e => setFailed((e as Error).message)); }, [pid]);
  if (failed) return <p className="error">{failed}</p>;
  if (!posts?.length) return null;
  const pieces = items.filter(i => i.status === 'approved' || i.status === 'published');
  const link = async (postId: number, itemId: string | null) => {
    setSaving(postId); setFailed('');
    try { await contentApi.linkPost(pid, postId, itemId); setPosts(await contentApi.accountPosts(pid)); }
    catch (e) { setFailed((e as Error).message); }
    setSaving(null);
  };
  return (
    <section className="card">
      <div className="head"><h3>What each post came from</h3></div>
      <p className="hint small">Link a posted piece to the studio item it came from. The team reads the winners first next time.</p>
      <ul className="rows">{posts.map(p => (
        <li key={p.id}>
          <span className="rowmain"><b>{p.text.slice(0, 80)}{p.text.length > 80 ? '…' : ''}</b></span>
          <span className="hint small">{p.likes + p.comments * 2 + p.shares * 3 + p.saves * 3} engagement{p.simulated ? ' · demo' : ''}</span>
          <select aria-label={`Studio piece for "${p.text.slice(0, 40)}"`} disabled={saving === p.id} value={p.itemId ?? ''} onChange={e => void link(p.id!, e.target.value || null)}>
            <option value="">Not linked</option>
            {pieces.map(i => <option key={i.id} value={i.id}>{i.title} ({i.status})</option>)}
          </select>
        </li>
      ))}</ul>
    </section>
  );
}
