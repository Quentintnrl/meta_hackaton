import { useState } from 'react';
import type { ContentItem, ContentView } from '../api';
import { KIND_HUE, credit, logicFor, today } from './shared';
import { locale, t, t2 } from '../i18n';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const STATUS_MARK: Record<string, string> = { briefed: '○', drafted: '◐', approved: '●', published: '✓' }; // ideas live in the inbox, never here
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => t(d));

export function CalendarView({ view, openId, open }: { view: ContentView; openId: string | null; open: (id: string) => void }) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const items = view.items.filter(i => i.status !== 'idea' && i.status !== 'rejected');

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
  const monthKey = `${cursor.y}-${pad(cursor.m + 1)}`;
  const inMonth = items.filter(i => i.date?.startsWith(monthKey));
  const ready = inMonth.filter(i => i.status === 'approved').length;
  const out = inMonth.filter(i => i.status === 'published').length;

  return (
    <div className="cal-wrap">
      <div className="today">
        <div><b>{t('The month')}</b><span className="hint small">{t("Every piece on the day it is planned. Accepted pieces follow their goal's expected date; a date you lock never moves.")}</span></div>
      </div>
      <section className="card">
        <div className="head">
          <h3>{first.toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h3>
          <div className="row nomargin"><button onClick={() => go(-1)} aria-label={t('Previous month')}>‹</button><button onClick={() => setCursor({ y: now.getFullYear(), m: now.getMonth() })}>{t('Today')}</button><button onClick={() => go(1)} aria-label={t('Next month')}>›</button></div>
        </div>
        <p className="hint small" role="status">{inMonth.length === 0 ? t('Nothing planned this month yet.') : t2(inMonth.length, '{n} piece this month · {ready} ready to post · {out} posted.', '{n} pieces this month · {ready} ready to post · {out} posted.', { ready, out })} {t('Click a piece to work on it.')}</p>
        <div className="grid">
          {DOW.map(d => <div key={d} className="dow">{d}</div>)}
          {cells.map((d, idx) => {
            if (d < 1 || d > days) return <div key={idx} className="day out" />;
            const key = iso(cursor.y, cursor.m, d);
            return (
              <div key={idx} className={`day ${key === today() ? 'today' : ''}`}>
                <span className="n">{d}</span>
                {landings.get(key)?.map(t_ => <span key={t_} className="landing" title={t('Projected landing')}>⚑ {t_}</span>)}
                {byDate.get(key)?.map(i => (
                  <button key={i.id} className={`pill-item ${i.id === openId ? 'sel' : ''}`} style={{ ['--h' as string]: KIND_HUE[i.kind] }} onClick={() => open(i.id)} title={`${i.title} (${i.status}) — ${credit(i)}${logicFor(i) ? ` · ${logicFor(i)}` : ''}`}>
                    <span>{STATUS_MARK[i.status]}</span> {i.title}{i.shiftDays ? <em className={i.shiftDays > 0 ? 'late' : 'early'}> {i.shiftDays > 0 ? '+' : ''}{i.shiftDays}{t('d')}</em> : null}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        <p className="legend small hint"><span>{t('○ briefed')}</span><span>{t('◐ drafted')}</span><span>{t('● approved')}</span><span>{t('✓ published')}</span><span>{t('⚑ milestone lands (projected)')}</span><span><em className="late">+3{t('d')}</em> {t('pushed back by the projection')}</span></p>
        {undated.length > 0 && <><h5>{t('No date yet')}</h5><div className="chips">{undated.map(i => <button key={i.id} className="pill-item" style={{ ['--h' as string]: KIND_HUE[i.kind] }} onClick={() => open(i.id)}>{i.title}</button>)}</div></>}
        {items.length === 0 && <p className="hint">{t("The calendar fills when you accept proposals from the team. Accepted pieces land on their goal's date; locked dates never move.")}</p>}
      </section>
    </div>
  );
}
