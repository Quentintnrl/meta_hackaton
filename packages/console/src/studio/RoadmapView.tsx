import { useState } from 'react';
import { contentApi, type AgentId, type ContentView, type Feature, type Forecast, type Milestone, type Project } from '../api';
import { locale, t, t2 } from '../i18n';
import { fmt, today, useAction } from './shared';
import type { View } from './Studio';

const T = (iso: string) => Date.parse(iso + 'T00:00:00Z');
const DAY = 86_400_000;

// A feature, in the words of someone who is not looking at the pipeline.
const FEATURE: Record<string, [string, 'done' | 'doing' | 'todo']> = {
  APPLIED: [t('Merged into the app'), 'done'], FEEDBACK: [t('Merged into the app'), 'done'], ANNOUNCE_DRAFTED: [t('Merged into the app'), 'done'], PUBLISHING: [t('Merged into the app'), 'done'], PUBLISHED: [t('Merged into the app'), 'done'],
  PR_READY: [t('Built: waiting for you to merge it'), 'doing'], MERGING: [t('Being merged'), 'doing'], MERGE_FAILED: [t('Merge failed: needs you'), 'doing'], BUILDING: [t('Being built'), 'doing'], VISUAL_CHECK: [t('Being checked against the design'), 'doing'],
  PLANNED: [t('Plan waiting for your approval'), 'todo'], DESIGN_DEFINED: [t('Not planned yet'), 'todo'],
};
const ICON = { done: '✓', doing: '◐', todo: '○' };

function Ring({ done, total }: { done: number; total: number }) {
  const r = 22, c = 2 * Math.PI * r, pct = total ? Math.min(1, done / total) : 0;
  return (
    <svg className="ring" viewBox="0 0 56 56" role="img" aria-label={t('{done} of {total} features done', { done, total })}>
      <circle cx="28" cy="28" r={r} className="ring-bg" /><circle cx="28" cy="28" r={r} className="ring-fg" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 28 28)" />
      <text x="28" y="33" textAnchor="middle">{done}/{total}</text>
    </svg>
  );
}

// The two dates that matter, drawn on one line and named on the line: the one you want, the one the team expects.
function DateLine({ m, contentDates }: { m: Milestone & { forecast?: Forecast }; contentDates: string[] }) {
  const want = m.targetDate;
  const expect = m.status === 'open' ? m.forecast?.predictedDate : undefined;
  const dates = [today(), want, ...(expect ? [expect] : [])];
  const lo = Math.min(...dates.map(T)), hi = Math.max(...dates.map(T));
  const pad = Math.max(3 * DAY, (hi - lo) * 0.08);
  const from = lo - pad, to = hi + pad;
  const x = (d: string) => ((T(d) - from) / (to - from)) * 100;
  const late = expect && T(expect) > T(want);
  const near = (a: string, b: string) => Math.abs(x(a) - x(b)) < 16;
  const pin = (p: number) => `clamp(52px, ${p}%, calc(100% - 52px))`;
  return (
    <div className="dateline" role="img" aria-label={expect ? t('You want {want}, the team expects {expect}', { want: fmt(want), expect: fmt(expect) }) : t('You want {want}', { want: fmt(want) })}>
      <div className="dl-track">
        <i className="dl-today" style={{ left: `${x(today())}%` }} />
        {late && <i className="dl-slip" style={{ left: `${x(want)}%`, width: `${x(expect!) - x(want)}%` }} />}
        <i className="dl-want" style={{ left: `${x(want)}%` }} />
        {expect && <i className={`dl-expect ${late ? 'late' : ''}`} style={{ left: `${x(expect)}%` }} />}
        {contentDates.filter(d => T(d) >= from && T(d) <= to).map((d, i) => <i key={i} className="dl-post" style={{ left: `${x(d)}%` }} title={t('Content planned {date}', { date: fmt(d) })} />)}
      </div>
      <span className="dl-label up" style={{ left: pin(x(want)) }}><small>{t('You want')}</small><b>{fmt(want)}</b></span>
      {expect && <span className={`dl-label down ${late ? 'late' : 'ok'}`} style={{ left: pin(x(expect)) }}><small>{t('Team expects')}</small><b>{fmt(expect)}</b></span>}
      {!near(today(), want) && <span className="dl-label up muted" style={{ left: pin(x(today())) }}><small>{t('Today')}</small></span>}
      {late && <span className="dl-late" style={{ left: `${(x(want) + x(expect!)) / 2}%` }}>{t('{n} days late', { n: m.slipDays })}</span>}
    </div>
  );
}

export function RoadmapView({ view, project, features, reload, go, askAgent }: { view: ContentView; project: Project; features: Feature[]; reload: () => Promise<void>; go: (v: View) => void; askAgent: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void }) {
  const ms = view.milestones;
  const late = ms.filter(m => m.atRisk).length;
  const planned = view.items.filter(i => !['idea', 'rejected', 'published'].includes(i.status) && i.milestoneId).length;
  return (
    <div className="stack">
      <div className="today">
        <div><b>{t('Your goals')}</b><span className="hint small">{t('A goal is something you are building towards, like a beta or a launch. The team checks which features are done, projects the real date, and hangs the content on it.')}</span></div>
      </div>
      {ms.length === 0 ? (
        <section className="card guide">
          <h3>{t('How the roadmap works')}</h3>
          <ol className="steps big">
            <li><span className="tick">1</span><span><b>{t('Name a goal')}</b> {t('and the date you want it by. For example “Public beta, 15 November”.')}</span></li>
            <li><span className="tick">2</span><span><b>{t('Attach the features')}</b> {t('it needs. The team tracks which ones are done.')}</span></li>
            <li><span className="tick">3</span><span><b>{t('Read the verdict.')}</b> {t('You see your date next to the date the team really expects, and the content follows.')}</span></li>
          </ol>
        </section>
      ) : (
        <div className="stats">
          <div className="bigstat"><b>{ms.length}</b><span>{ms.length > 1 ? t('goals') : t('goal')}</span></div>
          <div className={`bigstat ${late ? 'warn' : 'good'}`}><b>{late || '✓'}</b><span>{late ? t('running late') : t('all on track')}</span></div>
          <div className="bigstat"><b>{planned}</b><span>{planned === 1 ? t('piece of content tied to a goal') : t('pieces of content tied to a goal')}</span></div>
        </div>
      )}
      {ms.map(m => <Goal key={m.id} m={m} features={features} view={view} reload={reload} go={go} askAgent={askAgent} />)}
      <NewGoal projectId={project.id} reload={reload} first={ms.length === 0} />
    </div>
  );
}

function Goal({ m, features, view, reload, go, askAgent }: { m: Milestone & { forecast?: Forecast; atRisk: boolean; slipDays: number; accuracy?: { errorDays: number }; delivered: number }; features: Feature[]; view: ContentView; reload: () => Promise<void>; go: (v: View) => void; askAgent: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void }) {
  const { busy, error, run } = useAction(reload);
  const [why, setWhy] = useState<Forecast[] | null>(null);
  const f = m.forecast;
  const mine = view.items.filter(i => i.milestoneId === m.id && !['idea', 'rejected'].includes(i.status));
  const next = mine.filter(i => i.date && i.date >= today() && i.status !== 'published').sort((a, b) => a.date!.localeCompare(b.date!))[0];
  const free = features.filter(x => !m.featureIds.includes(x.id));
  const open = m.status === 'open';
  const expect = open ? f?.predictedDate ?? m.targetDate : m.doneAt?.slice(0, 10);
  const accuracy = m.accuracy
    ? ' ' + (m.accuracy.errorDays > 0
      ? t2(Math.abs(m.accuracy.errorDays), 'That was {n} day after what the team last expected.', 'That was {n} days after what the team last expected.')
      : t2(Math.abs(m.accuracy.errorDays), 'That was {n} day before what the team last expected.', 'That was {n} days before what the team last expected.'))
    : '';
  const verdict = !open
    ? { tone: 'done', chip: t('Done'), text: t('Landed on {date}.', { date: fmt(expect) }) + accuracy }
    : m.atRisk ? { tone: 'late', chip: t('{n} days late', { n: m.slipDays }), text: t('At the pace so far, the team expects it {n} days after the date you want. Content tied to it follows the expected date.', { n: m.slipDays }) }
      : { tone: 'ok', chip: t('On track'), text: t('At the pace so far, the team expects it in time.') };
  const pct = m.scope ? Math.min(100, Math.round((m.delivered / m.scope) * 100)) : 0;
  const basis = m.delivered === 0 ? t('nothing delivered yet, so it starts from your own plan') : t2(m.scope, '{done} of {n} feature done, at your pace so far', '{done} of {n} features done, at your pace so far', { done: m.delivered });

  return (
    <section className={`card goal ${verdict.tone}`}>
      <div className="goal-top">
        <div className="goal-title"><h3>{m.title}</h3>{m.intent && <p className="hint small clamp">{m.intent}</p>}</div>
        <span className={`verdict ${verdict.tone}`}>{verdict.chip}</span>
      </div>

      <div className="dates2">
        <div className="datecol"><small>{t('You want it on')}</small><b>{fmt(m.targetDate)}</b><span>{t('the date you set')}</span></div>
        <div className={`datecol ${verdict.tone}`}><small>{open ? t('The team expects') : t('It landed on')}</small><b>{fmt(expect)}</b><span>{open ? t('projected from {basis}', { basis }) : t('marked done by you')}</span></div>
      </div>
      <p className="verdict-text">{verdict.text}</p>
      {open && <DateLine m={m} contentDates={mine.map(i => i.date).filter((d): d is string => Boolean(d))} />}

      <div className="progress-line" role="img" aria-label={t('{done} of {total} features done', { done: m.delivered, total: m.scope })}><div className="pbar"><i style={{ width: `${pct}%` }} /></div><span>{t2(m.scope, '{done} of {n} feature done', '{done} of {n} features done', { done: m.delivered })}</span></div>
      <div className="chips">
        {m.featureIds.map(id => {
          const x = features.find(y => y.id === id);
          const [label, kind] = FEATURE[x?.state ?? ''] ?? [t('In progress'), 'doing'];
          return <span key={id} className={`fchip ${kind}`} title={label}><i>{ICON[kind]}</i>{x?.title ?? id}{open && <button className="linkish tight" aria-label={t('Take {title} out of this goal', { title: x?.title ?? id })} disabled={busy !== ''} onClick={() => run('unlink', () => contentApi.unlink(m.id, id))}>✕</button>}</span>;
        })}
        {open && free.length > 0 && <select className="addfeat" value="" aria-label={t('Add a feature')} onChange={e => e.target.value && run('link', () => contentApi.link(m.id, e.target.value))}><option value="">{t('+ Add a feature')}</option>{free.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select>}
        {m.featureIds.length === 0 && <span className="hint small">{t('No feature attached yet: the team cannot tell how far along you are.')}</span>}
      </div>

      <div className="goal-foot">
        <button className="linkish left" onClick={() => go('calendar')}>{mine.length ? t2(mine.length, '{n} piece of content around this goal', '{n} pieces of content around this goal') + (next ? t(', next: {title} on {date}', { title: next.title, date: fmt(next.date) }) : '') : t('No content around this goal yet')}</button>
        <div className="row nomargin">
          {f && <button onClick={async () => setWhy(why ? null : await contentApi.forecasts(m.id))}>{why ? t('Hide') : t('Why this date?')}</button>}
          <button onClick={() => askAgent('strategist', 'milestone', m.id)}>{t('Ask the Strategist')}</button>
          <details className="more"><summary>{t('More')}</summary><div>
            {open && <button disabled={busy !== ''} onClick={() => run('done', () => contentApi.markDone(m.id))}>{t('Mark as done')}</button>}
            <button className="linkish" disabled={busy !== ''} onClick={() => run('rm', () => contentApi.removeMilestone(m.id))}>{t('Remove this goal')}</button>
          </div></details>
        </div>
      </div>

      {why && f && (
        <div className="why-panel">
          <p className="small"><b>{t('How the team gets this date.')}</b> {f.done === 0 ? t('Nothing is delivered yet, so it starts from your own plan.') : t('{done} of {total} features took the time since the start, and the rest is projected at the same pace.', { done: f.done, total: f.scope })}
            {f.calibration !== 1 && ' ' + t('It then adds {pct}% because earlier goals took longer than planned.', { pct: Math.round((f.calibration - 1) * 100) })} {t('How sure:')} <b>{f.confidence}</b>.</p>
          <ol className="history small">{[...why].reverse().map(h => <li key={h.id}><b>{fmt(h.predictedDate)}</b> <span className="hint">{t('expected on {date}', { date: new Date(h.madeAt).toLocaleDateString(locale) })}</span><br />{h.note}</li>)}</ol>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function NewGoal({ projectId, reload, first }: { projectId: string; reload: () => Promise<void>; first: boolean }) {
  const empty = { title: '', intent: '', targetDate: '', scope: 3 };
  const [form, setForm] = useState(empty);
  const [open, setOpen] = useState(first);
  const { busy, error, run } = useAction(reload);
  if (!open && !first) return <button className="add-goal" onClick={() => setOpen(true)}>{t('+ Add a goal')}</button>;
  return (
    <section className="card">
      <h3>{t('New goal')}</h3>
      <label>{t('What do you want to reach?')}<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={t('Public beta')} /></label>
      <div className="two">
        <label>{t('By when?')}<input type="date" min={today()} value={form.targetDate} onChange={e => setForm({ ...form, targetDate: e.target.value })} /></label>
        <label>{t('How many features does it take?')}<input type="number" min={1} max={50} value={form.scope} onChange={e => setForm({ ...form, scope: Number(e.target.value) })} /><span className="field-hint">{t('A rough guess is fine, you can change it later.')}</span></label>
      </div>
      <label>{t('Why does it matter?')} <span className="opt">{t('optional: the team writes better content with it')}</span><textarea rows={2} value={form.intent} onChange={e => setForm({ ...form, intent: e.target.value })} placeholder={t('Ten testers plan a week of meals. The story: no more “what’s for dinner”.')} /></label>
      {error && <p className="error">{error}</p>}
      <div className="row"><button className="primary" disabled={busy !== '' || !form.title.trim() || !form.targetDate} onClick={() => run('add', async () => { await contentApi.addMilestone(projectId, form); setForm(empty); setOpen(false); })}>{t('Add this goal')}</button>{!first && <button className="linkish" onClick={() => setOpen(false)}>{t('Cancel')}</button>}</div>
    </section>
  );
}
