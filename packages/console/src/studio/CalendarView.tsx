import { useState } from 'react';
import type { ContentItem, ContentView } from '../api';
import { ItemEditor } from './ItemEditor';
import { KIND_HUE, today } from './shared';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const STATUS_MARK: Record<string, string> = { briefed: '○', drafted: '◐', approved: '●', published: '✓', idea: '·' };

export function CalendarView({ view, reload }: { view: ContentView; reload: () => Promise<void> }) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [openId, setOpenId] = useState<string | null>(null);
  const items = view.items.filter(i => i.status !== 'idea' && i.status !== 'rejected');
  const open = items.find(i => i.id === openId);

  const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
  const lead = (first.getUTCDay() + 6) % 7; // week starts on Monday
  const days = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
  const cells = Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => i - lead + 1);
  const byDate = new Map<string, ContentItem[]>();
  for (const i of items) if (i.date) byDate.set(i.date, [...(byDate.get(i.date) ?? []), i]);
  const landings = new Map<string, string[]>(); // the day the projection says each milestone lands
  for (const m of view.milestones) {
    const d = m.status === 'done' ? m.doneAt?.slice(0, 10) : m.forecast?.predictedDate ?? m.targetDate;
    if (d) landings.set(d, [...(landings.get(d) ?? []), m.title]);
  }
  const undated = items.filter(i => !i.date);
  const go = (n: number) => { const d = new Date(Date.UTC(cursor.y, cursor.m + n, 1)); setCursor({ y: d.getUTCFullYear(), m: d.getUTCMonth() }); };

  return (
    <div className={`cal-wrap ${open ? 'with-editor' : ''}`}>
      <section className="card">
        <div className="head">
          <h3>{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h3>
          <div className="row nomargin"><button onClick={() => go(-1)} aria-label="Previous month">‹</button><button onClick={() => setCursor({ y: now.getFullYear(), m: now.getMonth() })}>Today</button><button onClick={() => go(1)} aria-label="Next month">›</button></div>
        </div>
        <div className="grid">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="dow">{d}</div>)}
          {cells.map((d, idx) => {
            if (d < 1 || d > days) return <div key={idx} className="day out" />;
            const key = iso(cursor.y, cursor.m, d);
            return (
              <div key={idx} className={`day ${key === today() ? 'today' : ''}`}>
                <span className="n">{d}</span>
                {landings.get(key)?.map(t => <span key={t} className="landing" title="Projected landing">⚑ {t}</span>)}
                {byDate.get(key)?.map(i => (
                  <button key={i.id} className={`pill-item ${i.id === openId ? 'sel' : ''}`} style={{ ['--h' as string]: KIND_HUE[i.kind] }} onClick={() => setOpenId(i.id)} title={`${i.title} (${i.status})`}>
                    <span>{STATUS_MARK[i.status]}</span> {i.title}{i.shiftDays ? <em className={i.shiftDays > 0 ? 'late' : 'early'}> {i.shiftDays > 0 ? '+' : ''}{i.shiftDays}d</em> : null}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        <p className="legend small hint">○ briefed &nbsp; ◐ drafted &nbsp; ● approved &nbsp; ✓ published &nbsp; ⚑ milestone lands (projected) &nbsp; <em className="late">+3d</em> pushed back by the projection</p>
        {undated.length > 0 && <><h5>No date yet</h5><div className="chips">{undated.map(i => <button key={i.id} className="pill-item" style={{ ['--h' as string]: KIND_HUE[i.kind] }} onClick={() => setOpenId(i.id)}>{i.title}</button>)}</div></>}
        {items.length === 0 && <p className="hint">The calendar fills when you accept proposals from the team.</p>}
      </section>
      {open && <ItemEditor item={open} milestones={view.milestones} reload={reload} onClose={() => setOpenId(null)} />}
    </div>
  );
}
