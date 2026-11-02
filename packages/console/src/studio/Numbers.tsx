import { useState } from 'react';
import { hasFigure, teamApi, type Figure, type Plan, type PlanLever, type Proof, type YourScore } from '../api';

// The small pieces that put numbers next to words: a figure with its source, a thumbnail of an example,
// the proof behind an idea, the plan's format mix. All read-only; nothing here calls a model.

export type FormatStat = { format: string; posts: number; avgEngagement: number };
// spread with the golden angle so two formats rarely share a hue
export const hue = (s: string) => Math.round(([...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7) * 137.508) % 360);
export const num = (n: number) => (Number.isInteger(n) ? n : Math.round(n * 10) / 10).toLocaleString();
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

// "Behind-the-scenes" and "behind the scenes" are one format, as on the server.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function sameFormat(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const ys = y.split(' ');
  return x.split(' ').some(t => t.length > 3 && ys.includes(t));
}

// A measured figure, big, with what it measures and where it comes from. Or the honest "none found".
export function FigureTile({ figure, label }: { figure?: Figure; label?: string }) {
  if (!hasFigure(figure)) return <div className="figure none"><b>–</b><span>{label ?? 'no figure found'}</span></div>;
  const pct = figure.unit.trim().startsWith('%');
  return (
    <div className="figure">
      <b>{num(figure.value)}{pct ? '%' : ''}</b>
      <span>{pct || figure.what.toLowerCase().startsWith(figure.unit.toLowerCase()) ? '' : `${figure.unit} `}{figure.what}</span>
      {figure.source && <a className="src" href={figure.source} target="_blank" rel="noopener noreferrer" title={figure.source}>{host(figure.source) || 'source'}{figure.period ? ` · ${figure.period}` : ''}</a>}
    </div>
  );
}

// Where a format stands on this account: its average score and its rank among the formats.
export function YoursTile({ yours, label, simulated }: { yours?: YourScore; label?: string; simulated?: boolean }) {
  if (!yours) return <div className="figure none"><b>–</b><span>{label ?? 'not posted yet on your account'}</span></div>;
  return (
    <div className="figure yours">
      <b>{num(yours.value)}</b>
      <span>avg score · #{yours.rank} of {yours.of} formats · {yours.posts} post{yours.posts > 1 ? 's' : ''}{simulated ? ' · demo' : ''}</span>
    </div>
  );
}

// The picture of an example seen in the field, fetched by the server from its page. Falls back to the site name.
export function Thumb({ pid, url, alt }: { pid: string; url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!url) return null;
  if (failed) return <a className="thumb fallback" href={url} target="_blank" rel="noopener noreferrer">{host(url) || 'open'} ↗</a>;
  return <a className="thumb" href={url} target="_blank" rel="noopener noreferrer"><img src={teamApi.thumbUrl(pid, url)} alt={alt} loading="lazy" onError={() => setFailed(true)} /></a>;
}

// The numbers behind an idea: where its format sits among yours (bars), and the field figure it leans on.
export function ProofCard({ proof, stats, simulated }: { proof: Proof; stats: FormatStat[]; simulated?: boolean }) {
  const max = Math.max(1, ...stats.map(s => s.avgEngagement));
  const mine = stats.filter(s => sameFormat(s.format, proof.format));
  const shown = stats.length > 5 ? [...stats.slice(0, 4), ...(mine.some(m => stats.indexOf(m) >= 4) ? mine : [])] : stats;
  return (
    <div className="proof">
      <b className="proof-head">The numbers{simulated ? ' (demo data)' : ''}</b>
      <div className="proof-grid">
        {proof.yours && stats.length > 0 && (
          <div className="proof-bars" role="img" aria-label={`${proof.format} averages ${num(proof.yours.value)} on your account, rank ${proof.yours.rank} of ${proof.yours.of}`}>
            <span className="hint small">Your average score per format</span>
            {shown.map(s => { const hit = sameFormat(s.format, proof.format); return (
              <div key={s.format} className={`barrow ${hit ? 'hit' : ''}`}><span>{s.format}</span><div><i style={{ width: `${(s.avgEngagement / max) * 100}%` }} /></div><b>{num(s.avgEngagement)}</b></div>
            ); })}
          </div>
        )}
        <div className="proof-side">
          {proof.yours && <YoursTile yours={proof.yours} simulated={simulated} />}
          {proof.field ? <FigureTile figure={proof.field} /> : <div className="figure none"><b>–</b><span>no field figure for this format</span></div>}
        </div>
      </div>
      {proof.text && <p className="hint small">{proof.text}</p>}
    </div>
  );
}

export const LEVER: Record<PlanLever, { label: string; hint: string }> = {
  'double-down': { label: 'Double down', hint: 'It scores high on your account: do more of it' },
  'fill-gap': { label: 'Fill the gap', hint: 'The field shows it works and you have little or none' },
  test: { label: 'Test', hint: 'Try it with one or two pieces and measure' },
  keep: { label: 'Keep', hint: 'A steady baseline' },
};

// The plan as a table: how many of each format, why, and the two numbers behind each line.
export function PlanMix({ plan, simulated }: { plan: Plan; simulated?: boolean }) {
  const total = plan.mix.reduce((a, l) => a + l.count, 0);
  return (
    <div className="mix">
      {plan.mix.map(l => (
        <div key={l.format} className="mixrow" style={{ ['--h' as string]: hue(l.format) }}>
          <div className="mixcount"><b>{l.count}</b><span>of {total}</span></div>
          <div className="mixwhat">
            <div className="mixname"><b>{l.format}</b><span className={`lever ${l.lever}`} title={LEVER[l.lever].hint}>{LEVER[l.lever].label}</span></div>
            <p>{l.why}</p>
          </div>
          <div className="mixnums">
            <YoursTile yours={l.yours} label="not on your account yet" simulated={simulated} />
            <FigureTile figure={l.field} label="no field figure" />
          </div>
        </div>
      ))}
    </div>
  );
}

// The plan's mix as one segmented bar: eight posts, coloured by format, with the count on each segment.
export function MixBar({ plan }: { plan: Plan }) {
  const total = plan.mix.reduce((a, l) => a + l.count, 0) || 1;
  return (
    <div className="mixbar-wrap">
      <div className="mixbar" role="img" aria-label={plan.mix.map(l => `${l.count} ${l.format}`).join(', ')}>
        {plan.mix.map(l => <span key={l.format} className={`seg ${l.lever}`} style={{ flex: l.count, ['--h' as string]: hue(l.format) }}><b>{l.count}</b></span>)}
      </div>
      <div className="legend2">{plan.mix.map(l => <span key={l.format}><i style={{ background: `hsl(${hue(l.format)} 65% 50%)` }} />{l.format} · {Math.round((l.count / total) * 100)}%</span>)}</div>
    </div>
  );
}

// The same mix spread over the period, one dot per post: a picture of the rhythm, not a schedule.
export function CadenceDots({ plan }: { plan: Plan }) {
  const weeks = Math.max(1, Math.min(12, Number(plan.period.match(/(\d+)\s*week/i)?.[1] ?? 4)));
  const posts = plan.mix.flatMap(l => Array.from({ length: l.count }, () => l.format));
  // round-robin across formats so every week gets a mix
  const byWeek: string[][] = Array.from({ length: weeks }, () => []);
  const queues = plan.mix.map(l => Array.from({ length: l.count }, () => l.format));
  let w = 0;
  while (queues.some(q => q.length)) for (const q of queues) { const f = q.shift(); if (f) byWeek[w++ % weeks].push(f); }
  if (posts.length === 0) return null;
  return (
    <div className="cadence" role="img" aria-label={`${posts.length} posts over ${weeks} weeks`}>
      {byWeek.map((fs, i) => (
        <div key={i} className="week"><small>Week {i + 1}</small><span className="dots-row">{fs.map((f, k) => <i key={k} style={{ ['--h' as string]: hue(f) }} title={f} />)}{fs.length === 0 && <em>–</em>}</span></div>
      ))}
      <p className="hint small">{posts.length} posts over {weeks} weeks, about {Math.round((posts.length / weeks) * 10) / 10} a week. One way to spread them; the dates are set when you accept each idea.</p>
    </div>
  );
}

// Formats ranked by how strongly the Scout saw them work, with the measured figure next to each bar.
export function StrengthChart({ rows }: { rows: Array<{ format: string; strength?: number; figure?: Figure }> }) {
  const sorted = [...rows].sort((a, b) => (b.strength ?? 3) - (a.strength ?? 3));
  return (
    <div className="bars strength" role="img" aria-label="Formats ranked by strength in the field">
      {sorted.map(r => (
        <div key={r.format} className="barrow" style={{ ['--h' as string]: hue(r.format) }}>
          <span>{r.format}</span>
          <div><i style={{ width: `${((r.strength ?? 3) / 5) * 100}%`, background: `hsl(${hue(r.format)} 65% 50%)` }} /></div>
          <b>{hasFigure(r.figure) ? `${num(r.figure.value)}${r.figure.unit.trim().startsWith('%') ? '%' : ''}` : `${r.strength ?? 3}/5`}</b>
        </div>
      ))}
      <span className="hint small">Bar: strength out of 5 as the Scout rated it. Number: the measured figure when one was found, else the rating.</span>
    </div>
  );
}

// Two bars in the same unit, yours and the field's, each with its label.
export function PairBars({ a, b }: { a: { label: string; value?: number; note?: string }; b: { label: string; value?: number; note?: string } }) {
  const max = Math.max(1, a.value ?? 0, b.value ?? 0);
  return (
    <div className="pair">
      {[a, b].map((x, i) => (
        <div key={i} className={`barrow ${i === 0 ? 'yours' : 'field'}`}><span>{x.label}</span><div>{x.value !== undefined && <i style={{ width: `${(x.value / max) * 100}%` }} />}</div><b>{x.value === undefined ? '–' : num(x.value)}</b>{x.note && <small>{x.note}</small>}</div>
      ))}
    </div>
  );
}
