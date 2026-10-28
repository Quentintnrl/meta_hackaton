import { useState } from 'react';
import { contentApi, type ContentView, type Feature, type Forecast, type Milestone, type Project } from '../api';
import { fmt, today, useAction } from './shared';
import type { View } from './Studio';

const T = (iso: string) => Date.parse(iso + 'T00:00:00Z');
const DAY = 86_400_000;

// A feature, in the words of someone who is not looking at the pipeline.
const FEATURE: Record<string, [string, 'done' | 'doing' | 'todo']> = {
  APPLIED: ['Merged into the app', 'done'], FEEDBACK: ['Merged into the app', 'done'], ANNOUNCE_DRAFTED: ['Merged into the app', 'done'], PUBLISHING: ['Merged into the app', 'done'], PUBLISHED: ['Merged into the app', 'done'],
  PR_READY: ['Built: waiting for you to merge it', 'doing'], MERGING: ['Being merged', 'doing'], MERGE_FAILED: ['Merge failed: needs you', 'doing'], BUILDING: ['Being built', 'doing'], VISUAL_CHECK: ['Being checked against the design', 'doing'],
  PLANNED: ['Plan waiting for your approval', 'todo'], DESIGN_DEFINED: ['Not planned yet', 'todo'],
};
const ICON = { done: '✓', doing: '◐', todo: '○' };

function Ring({ done, total }: { done: number; total: number }) {
  const r = 22, c = 2 * Math.PI * r, pct = total ? Math.min(1, done / total) : 0;
  return (
    <svg className="ring" viewBox="0 0 56 56" role="img" aria-label={`${done} of ${total} features done`}>
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
    <div className="dateline" role="img" aria-label={`You want ${fmt(want)}${expect ? `, the team expects ${fmt(expect)}` : ''}`}>
      <div className="dl-track">
        <i className="dl-today" style={{ left: `${x(today())}%` }} />
        {late && <i className="dl-slip" style={{ left: `${x(want)}%`, width: `${x(expect!) - x(want)}%` }} />}
        <i className="dl-want" style={{ left: `${x(want)}%` }} />
        {expect && <i className={`dl-expect ${late ? 'late' : ''}`} style={{ left: `${x(expect)}%` }} />}
        {contentDates.filter(d => T(d) >= from && T(d) <= to).map((d, i) => <i key={i} className="dl-post" style={{ left: `${x(d)}%` }} title={`Content planned ${fmt(d)}`} />)}
      </div>
      <span className="dl-label up" style={{ left: pin(x(want)) }}><small>You want</small><b>{fmt(want)}</b></span>
      {expect && <span className={`dl-label down ${late ? 'late' : 'ok'}`} style={{ left: pin(x(expect)) }}><small>Team expects</small><b>{fmt(expect)}</b></span>}
      {!near(today(), want) && <span className="dl-label up muted" style={{ left: pin(x(today())) }}><small>Today</small></span>}
      {late && <span className="dl-late" style={{ left: `${(x(want) + x(expect!)) / 2}%` }}>{m.slipDays} days late</span>}
    </div>
  );
}

export function RoadmapView({ view, project, features, reload, go }: { view: ContentView; project: Project; features: Feature[]; reload: () => Promise<void>; go: (v: View) => void }) {
  const ms = view.milestones;
  const late = ms.filter(m => m.atRisk).length;
  const planned = view.items.filter(i => !['idea', 'rejected', 'published'].includes(i.status) && i.milestoneId).length;
  return (
    <div className="stack">
      {ms.length === 0 ? (
        <section className="card guide">
          <h3>How the roadmap works</h3>
          <ol className="steps big">
            <li><span className="tick">1</span><span><b>Name a goal</b> and the date you want it by. For example “Public beta, 15 November”.</span></li>
            <li><span className="tick">2</span><span><b>Attach the features</b> it needs. The team tracks which ones are done.</span></li>
            <li><span className="tick">3</span><span><b>Read the verdict.</b> You see your date next to the date the team really expects, and the content follows.</span></li>
          </ol>
        </section>
      ) : (
        <div className="stats">
          <div className="bigstat"><b>{ms.length}</b><span>goals</span></div>
          <div className={`bigstat ${late ? 'warn' : 'good'}`}><b>{late || '✓'}</b><span>{late ? 'running late' : 'all on track'}</span></div>
          <div className="bigstat"><b>{planned}</b><span>pieces of content planned</span></div>
        </div>
      )}
      {ms.map(m => <Goal key={m.id} m={m} features={features} view={view} reload={reload} go={go} />)}
      <NewGoal projectId={project.id} reload={reload} first={ms.length === 0} />
    </div>
  );
}

function Goal({ m, features, view, reload, go }: { m: Milestone & { forecast?: Forecast; atRisk: boolean; slipDays: number; accuracy?: { errorDays: number }; delivered: number }; features: Feature[]; view: ContentView; reload: () => Promise<void>; go: (v: View) => void }) {
  const { busy, error, run } = useAction(reload);
  const [why, setWhy] = useState<Forecast[] | null>(null);
  const f = m.forecast;
  const mine = view.items.filter(i => i.milestoneId === m.id && !['idea', 'rejected'].includes(i.status));
  const next = mine.filter(i => i.date && i.date >= today() && i.status !== 'published').sort((a, b) => a.date!.localeCompare(b.date!))[0];
  const free = features.filter(x => !m.featureIds.includes(x.id));
  const verdict = m.status === 'done'
    ? { tone: 'done', chip: 'Done', text: `Landed on ${fmt(m.doneAt?.slice(0, 10))}.${m.accuracy ? ` That was ${Math.abs(m.accuracy.errorDays)} day${Math.abs(m.accuracy.errorDays) === 1 ? '' : 's'} ${m.accuracy.errorDays > 0 ? 'after' : 'before'} what the team last expected.` : ''}` }
    : m.atRisk ? { tone: 'late', chip: `${m.slipDays} days late`, text: `The team expects this on ${fmt(f?.predictedDate)}, ${m.slipDays} days after the date you want.` }
      : { tone: 'ok', chip: 'On track', text: `The team expects this on ${fmt(f?.predictedDate ?? m.targetDate)}: in time.` };

  return (
    <section className={`card goal ${verdict.tone}`}>
      <div className="goal-top">
        <Ring done={m.delivered} total={m.scope} />
        <div className="goal-title"><h3>{m.title}</h3>{m.intent && <p className="hint small clamp">{m.intent}</p>}</div>
        <span className={`verdict ${verdict.tone}`}>{verdict.chip}</span>
      </div>
      <p className="verdict-text">{verdict.text}</p>
      {m.status === 'open' && <DateLine m={m} contentDates={mine.map(i => i.date).filter((d): d is string => Boolean(d))} />}

      <h4 className="mini">Features</h4>
      <ul className="flist">
        {m.featureIds.map(id => {
          const x = features.find(y => y.id === id);
          const [label, kind] = FEATURE[x?.state ?? ''] ?? ['In progress', 'doing'];
          return <li key={id} className={kind}><span className="fi">{ICON[kind]}</span><span className="ft">{x?.title ?? id}</span><span className="hint small">{label}</span>{m.status === 'open' && <button className="linkish tight" title="Take it out of this goal" disabled={busy !== ''} onClick={() => run('unlink', () => contentApi.unlink(m.id, id))}>✕</button>}</li>;
        })}
        {m.featureIds.length === 0 && <li className="todo"><span className="hint small">No feature attached yet: the team cannot tell how far along you are.</span></li>}
      </ul>
      {m.status === 'open' && free.length > 0 && (
        <select className="addfeat" value="" aria-label="Add a feature" onChange={e => e.target.value && run('link', () => contentApi.link(m.id, e.target.value))}><option value="">+ Add a feature to this goal</option>{free.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
      )}

      <div className="goal-foot">
        <button className="linkish left" onClick={() => go('calendar')}>{mine.length ? `${mine.length} piece${mine.length > 1 ? 's' : ''} of content planned${next ? ` · next: ${next.title}, ${fmt(next.date)}` : ''} →` : 'No content planned yet: ask the Strategist →'}</button>
        <div className="row nomargin">
          {f && <button onClick={async () => setWhy(why ? null : await contentApi.forecasts(m.id))}>{why ? 'Hide' : 'Why this date?'}</button>}
          {m.status === 'open' && <button disabled={busy !== ''} onClick={() => run('done', () => contentApi.markDone(m.id))}>Mark as done</button>}
          <button className="linkish" disabled={busy !== ''} onClick={() => run('rm', () => contentApi.removeMilestone(m.id))}>Remove</button>
        </div>
      </div>

      {why && f && (
        <div className="why-panel">
          <p className="small"><b>How the team gets this date.</b> {f.done === 0 ? 'Nothing is delivered yet, so it starts from your own plan.' : `${f.done} of ${f.scope} features took the time since the start, and the rest is projected at the same pace.`}
            {f.calibration !== 1 && ` It then adds ${Math.round((f.calibration - 1) * 100)}% because earlier goals took longer than planned.`} How sure: <b>{f.confidence}</b>.</p>
          <ol className="history small">{[...why].reverse().map(h => <li key={h.id}><b>{fmt(h.predictedDate)}</b> <span className="hint">expected on {new Date(h.madeAt).toLocaleDateString()}</span><br />{h.note}</li>)}</ol>
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
  if (!open && !first) return <button className="add-goal" onClick={() => setOpen(true)}>+ Add a goal</button>;
  return (
    <section className="card">
      <h3>New goal</h3>
      <label>What do you want to reach?<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Public beta" /></label>
      <div className="two">
        <label>By when?<input type="date" min={today()} value={form.targetDate} onChange={e => setForm({ ...form, targetDate: e.target.value })} /></label>
        <label>How many features does it take?<input type="number" min={1} max={50} value={form.scope} onChange={e => setForm({ ...form, scope: Number(e.target.value) })} /><span className="field-hint">A rough guess is fine, you can change it later.</span></label>
      </div>
      <label>Why does it matter? <span className="opt">optional: the team writes better content with it</span><textarea rows={2} value={form.intent} onChange={e => setForm({ ...form, intent: e.target.value })} placeholder="Ten testers plan a week of meals. The story: no more “what’s for dinner”." /></label>
      {error && <p className="error">{error}</p>}
      <div className="row"><button className="primary" disabled={busy !== '' || !form.title.trim() || !form.targetDate} onClick={() => run('add', async () => { await contentApi.addMilestone(projectId, form); setForm(empty); setOpen(false); })}>Add this goal</button>{!first && <button className="linkish" onClick={() => setOpen(false)}>Cancel</button>}</div>
    </section>
  );
}
