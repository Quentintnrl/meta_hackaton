import { useState } from 'react';
import { contentApi, type ContentItem, type ContentView, type TeamView } from '../api';
import { KIND_HUE, useAction } from './shared';
import { dateIn } from './charts';
import type { View } from './Studio';

// The calendar: the dates your audience lives by (from the Scout) and your pieces (proposed, accepted, written,
// approved, posted) on the same days, three months at a time. A date without a piece near it is a post to plan.
type Props = { pid: string; team: TeamView; view: ContentView; reload: () => Promise<void>; open: (id: string) => void; go: (v: View) => void };

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(Date.parse(s) + n * DAY));
const STATUS: Record<string, string> = { idea: 'proposed', briefed: 'accepted', drafted: 'written', approved: 'ready', published: 'posted', rejected: 'refused' };

export function AgendaBoard({ pid, team, view, reload, open, go }: Props) {
  const today = iso(new Date());
  const [start, setStart] = useState(today.slice(0, 7));
  const { busy, error, run } = useAction(reload);
  const events = (team.watch?.data.events ?? []).map(e => ({ ...e, at: dateIn(e.when, today) ?? '' })).filter(e => e.at);
  const pieces = view.items.filter(i => i.status !== 'rejected' && (i.fixedDate ?? i.date));
  const milestones = view.milestones.map(m => ({ title: m.title, at: (m as { forecast?: { predictedDate: string } }).forecast?.predictedDate ?? m.targetDate })).filter(m => m.at);
  const months = [0, 1, 2].map(k => { const d = new Date(start + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + k); return iso(d).slice(0, 7); });
  const shift = (n: number) => { const d = new Date(start + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); setStart(iso(d).slice(0, 7)); };
  const plan = (e: { name: string; at: string; why: string; post?: string }) => run('plan:' + e.name, async () => {
    const at = addDays(e.at, -5) > today ? addDays(e.at, -5) : today;
    await contentApi.addItem(pid, { kind: 'social-post', title: `Before ${e.name.length > 50 ? e.name.slice(0, 49) + '…' : e.name}`, brief: e.post || `A post for ${e.name} (${e.at}): ${e.why}`, fixedDate: at, rationale: `${e.name}, ${e.at}: ${e.why}`, source: 'trend', pitch: { hook: '', channel: '', measure: '', context: `${e.name}, ${e.at}. ${e.why}` } });
  });
  const uncovered = events.filter(e => e.at >= today && !pieces.some(p => { const d = p.fixedDate ?? p.date!; return d >= addDays(e.at, -14) && d <= addDays(e.at, 3); }));
  return (
    <div className="stack">
      <section className="card">
        <div className="head">
          <h3>{uncovered.length ? `${uncovered.length} date${uncovered.length > 1 ? 's' : ''} ahead with nothing planned around ${uncovered.length > 1 ? 'them' : 'it'}` : 'Every date ahead has a piece near it'}</h3>
          <span className="row"><button className="linkish" onClick={() => shift(-1)}>‹ earlier</button><button className="linkish" onClick={() => setStart(today.slice(0, 7))}>this month</button><button className="linkish" onClick={() => shift(1)}>later ›</button></span>
        </div>
        {uncovered.length > 0 && <ul className="uncovered">{uncovered.map(e => <li key={e.name}><b>{fmtDay(e.at)}</b> {e.name} <span className="hint small">{e.post || e.why}</span> <button className="linkish tight" disabled={busy !== ''} onClick={() => plan(e)}>{busy === 'plan:' + e.name ? '…' : 'Plan a post five days before →'}</button></li>)}</ul>}
        {events.length === 0 && <p className="hint">No dates from the Scout yet: the calendar shows your pieces alone. <button className="linkish tight" onClick={() => go('watch')}>Watch the field →</button></p>}
        {error && <p className="error">{error}</p>}
        <div className="legend agenda-legend"><span><i className="ev" />audience date</span><span><i className="ms" />goal</span>{(['idea', 'briefed', 'drafted', 'approved', 'published'] as const).map(s => <span key={s}><i className={`pc ${s}`} />{STATUS[s]}</span>)}</div>
      </section>
      {months.map(m => <Month key={m} month={m} today={today} events={events} pieces={pieces} milestones={milestones} open={open} plan={plan} busy={busy} />)}
    </div>
  );
}

const fmtDay = (s: string) => new Date(s + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

function Month({ month, today, events, pieces, milestones, open, plan, busy }: { month: string; today: string; events: Array<{ name: string; at: string; why: string; post?: string }>; pieces: ContentItem[]; milestones: Array<{ title: string; at: string }>; open: (id: string) => void; plan: (e: { name: string; at: string; why: string; post?: string }) => void; busy: string }) {
  const first = new Date(month + '-01T00:00:00Z');
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => iso(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), i + 1))))];
  while (cells.length % 7) cells.push(null);
  return (
    <section className="card month">
      <h3>{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h3>
      <div className="month-grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <span key={d} className="dow">{d}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={i} className="day empty" />;
          const ev = events.filter(e => e.at === d), pc = pieces.filter(p => (p.fixedDate ?? p.date) === d), ms = milestones.filter(m => m.at.slice(0, 10) === d);
          return <div key={d} className={`day${d === today ? ' today' : ''}${d < today ? ' past' : ''}`}>
            <span className="num">{Number(d.slice(8))}</span>
            {ev.map(e => <button key={e.name} className="ev-chip" title={`${e.name}\n${e.why}${e.post ? `\nTo post: ${e.post}` : ''}\nClick to plan a post five days before.`} disabled={busy !== ''} onClick={() => plan(e)}>{e.name}</button>)}
            {ms.map(m => <span key={m.title} className="ms-chip" title={`Goal: ${m.title}`}>◆ {m.title}</span>)}
            {pc.map(p => <button key={p.id} className={`pc-chip ${p.status}`} style={{ ['--h' as string]: KIND_HUE[p.kind] }} title={`${p.title} — ${STATUS[p.status]}${p.pitch?.channel ? `, ${p.pitch.channel}` : ''}`} onClick={() => open(p.id)}>{p.title}</button>)}
          </div>;
        })}
      </div>
    </section>
  );
}
