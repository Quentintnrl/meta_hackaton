import type { AccountPost } from '../api';

// Small drawings, one series each, one hue, thin marks anchored to the baseline, a title on every mark for hover.
// They carry a finding, never a panel of numbers: the sentence next to them is the point, the drawing is the proof.

const DAY = 86_400_000;
export const fmtY = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtM = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });
const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// The story of the account: every post as a bar on a time axis, the silences shaded, the best post named.
export function Timeline({ posts, silences, hueOf, best }: { posts: AccountPost[]; silences: Array<{ from: string; to: string; days: number }>; hueOf: (p: AccountPost) => number; best?: { postedAt: string; likes: number; text: string } }) {
  const w = 900, h = 190, pad = 28, top = 34;
  const sorted = [...posts].sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  const t0 = Date.parse(sorted[0].postedAt) - 7 * DAY, t1 = Math.max(Date.parse(sorted.at(-1)!.postedAt), t0 + DAY) + 7 * DAY;
  const max = Math.max(1, ...posts.map(p => p.likes));
  const x = (iso: string) => pad + ((Date.parse(iso) - t0) / (t1 - t0)) * (w - 2 * pad);
  const y = (v: number) => h - 24 - (v / max) * (h - 24 - top);
  const months: string[] = [];
  for (const d = new Date(t0); d.getTime() <= t1; d.setUTCMonth(d.getUTCMonth() + 1, 1)) if (d.getTime() >= t0) months.push(d.toISOString().slice(0, 10));
  const bestX = best ? x(best.postedAt) : 0;
  return (
    <svg className="chart timeline" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Posts over time, likes as height, silences shaded">
      {silences.map(s => <g key={s.from}><rect x={x(s.from) + 3} y={top - 10} width={Math.max(2, x(s.to) - x(s.from) - 6)} height={h - 24 - top + 10} className="silence"><title>{`${s.days} days of silence, ${fmtY(s.from)} to ${fmtY(s.to)}`}</title></rect>{x(s.to) - x(s.from) > 115 && <text x={(x(s.from) + x(s.to)) / 2} y={top + 4} className="tick" textAnchor="middle">{s.days} days of silence</text>}</g>)}
      <line x1={pad} x2={w - pad} y1={h - 24} y2={h - 24} className="axis" />
      {months.filter((_, i) => i % 2 === 0).map(m => <text key={m} x={x(m)} y={h - 8} className="tick" textAnchor="middle">{fmtM(m)}</text>)}
      {sorted.map((p, i) => <rect key={i} x={x(p.postedAt) - 2.5} y={y(p.likes)} width={5} height={h - 24 - y(p.likes)} rx={2.5} style={{ fill: `hsl(${hueOf(p)} 65% 50%)` }}><title>{`${fmtY(p.postedAt)}: ${p.likes} likes${p.comments ? `, ${p.comments} comments` : ''} — ${cap(p.text, 90)}`}</title></rect>)}
      {best && <text x={bestX < w / 2 ? bestX + 8 : bestX - 8} y={y(best.likes) - 6} className="note" textAnchor={bestX < w / 2 ? 'start' : 'end'}>{best.likes} likes: “{cap(best.text, 48)}”</text>}
    </svg>
  );
}

// A handful of groups compared on one measure: thin bars, the count under each, the biggest named.
export function Compare({ groups, unit = 'likes', hue }: { groups: Array<{ label: string; n: number; avg: number }>; unit?: string; hue?: number }) {
  const w = 300, h = 120, pad = 10, bw = 22;
  const max = Math.max(1, ...groups.map(g => g.avg));
  const step = (w - 2 * pad) / groups.length;
  const fill = hue != null ? `hsl(${hue} 65% 50%)` : 'var(--accent)';
  return (
    <svg className="chart compare" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Average ${unit} per group`}>
      <line x1={pad} x2={w - pad} y1={h - 30} y2={h - 30} className="axis" />
      {groups.map((g, i) => {
        const bh = g.n ? Math.max(2, (g.avg / max) * (h - 56)) : 0;
        const cx = pad + step * i + step / 2;
        return <g key={g.label}>
          {g.n > 0 && <rect x={cx - bw / 2} y={h - 30 - bh} width={bw} height={bh} rx={4} style={{ fill }} opacity={g.n ? 1 : .3}><title>{`${g.label}: ${g.avg} ${unit} on average, ${g.n} post${g.n > 1 ? 's' : ''}`}</title></rect>}
          <text x={cx} y={h - 30 - bh - 5} className="value" textAnchor="middle">{g.n ? g.avg : '–'}</text>
          <text x={cx} y={h - 16} className="tick" textAnchor="middle">{g.label}</text>
          <text x={cx} y={h - 4} className="tick faint" textAnchor="middle">{g.n ? `${g.n} post${g.n > 1 ? 's' : ''}` : 'none'}</text>
        </g>;
      })}
    </svg>
  );
}

// Reach against reactions, one dot per post: how many of the people who saw it reacted.
export function Dots({ points, hue }: { points: Array<{ text: string; views: number; likes: number; rate: number; postedAt: string }>; hue: number }) {
  const w = 300, h = 150, pad = 30;
  const mx = Math.max(1, ...points.map(p => p.views)), my = Math.max(1, ...points.map(p => p.likes));
  const x = (v: number) => pad + (v / mx) * (w - pad - 10), y = (v: number) => h - 24 - (v / my) * (h - 40);
  return (
    <svg className="chart dots" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Views against reactions, one dot per post">
      <line x1={pad} x2={w - 10} y1={h - 24} y2={h - 24} className="axis" /><line x1={pad} x2={pad} y1={10} y2={h - 24} className="axis" />
      <text x={w - 10} y={h - 8} className="tick" textAnchor="end">views</text><text x={pad + 4} y={14} className="tick">reactions</text>
      {points.map((p, i) => { const labelled = p === points[0] || p.rate === Math.max(...points.map(q => q.rate)); return <g key={i}><circle cx={x(p.views)} cy={y(p.likes)} r={6} style={{ fill: `hsl(${hue} 65% 50%)` }} stroke="var(--panel)" strokeWidth={2}><title>{`${fmtY(p.postedAt)}: ${p.views} views, ${p.likes} reactions (${p.rate}%) — ${cap(p.text, 80)}`}</title></circle>{labelled && <text x={x(p.views) + (p === points[0] ? -10 : 10)} y={y(p.likes) + 4} className="tick" textAnchor={p === points[0] ? 'end' : 'start'}>{p.rate}% of {p.views}</text>}</g>; })}
    </svg>
  );
}

// Where you stand among the players: followers on a log scale, you marked.
export function Strip({ players, you, hue }: { players: Array<{ name: string; followers: number }>; you?: { name: string; followers: number }; hue: number }) {
  const all = [...players, ...(you ? [you] : [])].filter(p => p.followers > 0);
  if (all.length < 2) return null;
  const w = 900, h = 70, pad = 20;
  const lo = Math.log10(Math.max(1, Math.min(...all.map(p => p.followers)))), hi = Math.log10(Math.max(...all.map(p => p.followers)) * 1.3);
  const x = (v: number) => pad + ((Math.log10(Math.max(1, v)) - lo) / Math.max(0.1, hi - lo)) * (w - 2 * pad);
  const ticks = [10, 100, 1_000, 10_000, 100_000].filter(t => Math.log10(t) >= lo - 0.2 && Math.log10(t) <= hi);
  const sorted = [...players].sort((a, b) => a.followers - b.followers);
  return (
    <svg className="chart strip" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Followers of each player on a log scale">
      <line x1={pad} x2={w - pad} y1={40} y2={40} className="axis" />
      {ticks.map(t => <g key={t}><line x1={x(t)} x2={x(t)} y1={36} y2={44} className="axis" /><text x={x(t)} y={60} className="tick" textAnchor="middle">{t.toLocaleString()}</text></g>)}
      {sorted.map((p, i) => <g key={p.name}><circle cx={x(p.followers)} cy={40} r={5} className="dot-muted"><title>{`${p.name}: ${p.followers.toLocaleString()} followers`}</title></circle><text x={x(p.followers)} y={i % 2 ? 26 : 14} className="tick" textAnchor="middle">{cap(p.name, 16)}</text></g>)}
      {you && you.followers > 0 && <g><circle cx={x(you.followers)} cy={40} r={7} style={{ fill: `hsl(${hue} 65% 50%)` }} stroke="var(--panel)" strokeWidth={2}><title>{`${you.name}: ${you.followers} followers`}</title></circle><text x={x(you.followers)} y={26} className="note" textAnchor="start">you, {you.followers}</text></g>}
    </svg>
  );
}

// The months ahead: the dates the audience lives by, and your planned pieces, on one line from today.
export function Ahead({ events, pieces, today, months = 7 }: { events: Array<{ name: string; at: string; post?: string }>; pieces: Array<{ title: string; at: string }>; today: string; months?: number }) {
  const w = 900, h = 150, pad = 24;
  const t0 = Date.parse(today) - 3 * DAY, t1 = Date.parse(today) + months * 30.4 * DAY;
  const x = (iso: string) => pad + ((Date.parse(iso) - t0) / (t1 - t0)) * (w - 2 * pad);
  const inRange = (iso: string) => Date.parse(iso) >= t0 && Date.parse(iso) <= t1;
  const ms: string[] = [];
  for (const d = new Date(t0); d.getTime() <= t1; d.setUTCMonth(d.getUTCMonth() + 1, 1)) if (d.getTime() >= t0) ms.push(d.toISOString().slice(0, 10));
  const ev = events.filter(e => inRange(e.at)).sort((a, b) => a.at.localeCompare(b.at));
  const pc = pieces.filter(p => inRange(p.at)).sort((a, b) => a.at.localeCompare(b.at));
  return (
    <svg className="chart ahead" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="The months ahead: audience dates above the line, your planned pieces below">
      <line x1={pad} x2={w - pad} y1={80} y2={80} className="axis" />
      {ms.map(m => <g key={m}><line x1={x(m)} x2={x(m)} y1={76} y2={84} className="axis" /><text x={x(m)} y={98} className="tick" textAnchor="middle">{fmtM(m)}</text></g>)}
      <g><line x1={x(today)} x2={x(today)} y1={8} y2={100} className="today" /><text x={x(today) + 4} y={12} className="tick">today</text></g>
      {ev.map((e, i) => <g key={e.name}><line x1={x(e.at)} x2={x(e.at)} y1={80} y2={62 - (i % 3) * 18} className="stem" /><circle cx={x(e.at)} cy={80} r={5} style={{ fill: 'var(--wait)' }}><title>{`${fmtY(e.at)}: ${e.name}${e.post ? ` — ${e.post}` : ''}`}</title></circle><text x={x(e.at)} y={58 - (i % 3) * 18} className="note" textAnchor={x(e.at) > w - 120 ? 'end' : x(e.at) < 120 ? 'start' : 'middle'}>{cap(e.name, 30)}</text></g>)}
      {pc.map((p, i) => { const room = i === 0 || x(p.at) - x(pc[i - 1].at) > 90; return <g key={p.title + p.at}><line x1={x(p.at)} x2={x(p.at)} y1={84} y2={110} className="stem" /><circle cx={x(p.at)} cy={112} r={4} style={{ fill: 'var(--accent)' }}><title>{`${fmtY(p.at)}: ${p.title}`}</title></circle>{room && <text x={x(p.at)} y={132} className="tick" textAnchor={x(p.at) < 120 ? 'start' : 'middle'}>{cap(p.title, 26)}</text>}</g>; })}
      {pc.length > 0 && <text x={w - pad} y={132} className="tick" textAnchor="end">{pc.length} piece{pc.length > 1 ? 's' : ''} planned, {fmtM(pc[0].at)} to {fmtM(pc.at(-1)!.at)}</text>}
    </svg>
  );
}

// A date written the way events are announced ("24-26 novembre 2026", "27 et 28 janvier 2027", "mercredi 18 novembre", "Feb-15 Apr 2027"): the first day found.
const MONTHS: Record<string, number> = { janvier: 1, january: 1, jan: 1, février: 2, fevrier: 2, february: 2, feb: 2, mars: 3, march: 3, mar: 3, avril: 4, april: 4, apr: 4, mai: 5, may: 5, juin: 6, june: 6, jun: 6, juillet: 7, july: 7, jul: 7, août: 8, aout: 8, august: 8, aug: 8, septembre: 9, september: 9, sep: 9, sept: 9, octobre: 10, october: 10, oct: 10, novembre: 11, november: 11, nov: 11, décembre: 12, decembre: 12, december: 12, dec: 12 };
export function dateIn(text: string, today: string): string | undefined {
  const t = text.toLowerCase();
  const m = t.match(/(\d{1,2})(?:\s*(?:-|–|et|au|to|&)\s*\d{1,2})?(?:er)?\s+([a-zéû]+)\.?\s*(\d{4})?/);
  const mo = m && MONTHS[m[2]];
  if (m && mo) {
    const year = m[3] ? Number(m[3]) : (() => { const y = Number(today.slice(0, 4)); const cand = `${y}-${String(mo).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`; return cand >= today ? y : y + 1; })();
    return `${year}-${String(mo).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
  }
  const m2 = t.match(/\b([a-zéû]+)\s+(\d{4})\b/); // "décembre 2026": the first of the month
  if (m2 && MONTHS[m2[1]]) return `${m2[2]}-${String(MONTHS[m2[1]]).padStart(2, '0')}-01`;
  return undefined;
}

// A follower count written in a find ("13,714 followers", "3 295 abonnés").
export const followersIn = (s: string) => { const m = s.match(/([\d][\d\s,.]*)\s*(followers|abonnés)/i); return m ? Number(m[1].replace(/[^\d]/g, '')) : 0; };
