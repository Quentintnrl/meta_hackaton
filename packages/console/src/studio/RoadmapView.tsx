import { useState } from 'react';
import { contentApi, type ContentView, type Feature, type Forecast, type Milestone, type Project } from '../api';
import { KIND_HUE, fmt, today, useAction } from './shared';

const t = (iso: string) => Date.parse(iso + 'T00:00:00Z');

export function RoadmapView({ view, project, features, reload }: { view: ContentView; project: Project; features: Feature[]; reload: () => Promise<void> }) {
  const ms = view.milestones;
  const dates = [today(), ...ms.flatMap(m => [m.targetDate, m.forecast?.predictedDate ?? m.targetDate])];
  const from = t(today()) - 3 * 86_400_000;
  const to = Math.max(...dates.map(t)) + 10 * 86_400_000;
  const x = (iso: string) => `${Math.min(100, Math.max(0, ((t(iso) - from) / (to - from)) * 100))}%`;
  const inRange = (d: string) => t(d) >= from && t(d) <= to;
  const items = view.items.filter(i => i.milestoneId && i.date && inRange(i.date) && i.status !== 'rejected' && i.status !== 'idea');
  const todayX = x(today());

  return (
    <div className="stack">
      <section className="card">
        <div className="head"><h3>Timeline</h3><span className="hint small">Your date, and where the team projects it will really land</span></div>
        {ms.length === 0 ? <p className="hint">No milestone yet. Add the first one below: what you want to ship, and when.</p> : (
          <div className="timeline-chart">
            {ms.map(m => (
              <div key={m.id} className="trow">
                <div className="tlabel"><b>{m.title}</b><span className="hint small">{m.delivered}/{m.scope}</span></div>
                <div className="track">
                  <i className="today-tick" style={{ left: todayX }} />
                  <div className="plan" style={{ left: 0, width: x(m.targetDate) }} />
                  <div className="done" style={{ left: 0, width: `calc(${x(m.targetDate)} * ${m.delivered / m.scope})` }} />
                  <span className="flag want" style={{ left: x(m.targetDate) }} title={`You want ${fmt(m.targetDate)}`} />
                  {m.forecast && m.status === 'open' && <>
                    {m.atRisk && <div className="slip" style={{ left: x(m.targetDate), width: `calc(${x(m.forecast.predictedDate)} - ${x(m.targetDate)})` }} />}
                    <span className={`flag proj ${m.atRisk ? 'late' : ''}`} style={{ left: x(m.forecast.predictedDate) }} title={`Projected ${fmt(m.forecast.predictedDate)}`} />
                  </>}
                  {items.filter(i => i.milestoneId === m.id).map(i => <span key={i.id} className="dotc" style={{ left: x(i.date!), ['--h' as string]: KIND_HUE[i.kind] }} title={`${fmt(i.date)}: ${i.title}`} />)}
                </div>
              </div>
            ))}
            <p className="legend small hint"><i className="lg today" /> today &nbsp; <i className="lg want" /> you want &nbsp; <i className="lg proj" /> projected &nbsp; <i className="lg dotc" /> content</p>
          </div>
        )}
      </section>
      {ms.map(m => <MilestoneCard key={m.id} m={m} features={features} reload={reload} />)}
      <NewMilestone projectId={project.id} reload={reload} />
    </div>
  );
}

function MilestoneCard({ m, features, reload }: { m: Milestone; features: Feature[]; reload: () => Promise<void> }) {
  const { busy, error, run } = useAction(reload);
  const [history, setHistory] = useState<Forecast[] | null>(null);
  const [openCard, setOpenCard] = useState(m.atRisk);
  const f = m.forecast;
  const free = features.filter(x => !m.featureIds.includes(x.id));
  return (
    <section className={`card ms ${m.atRisk ? 'risk' : ''}`}>
      <button className="ms-head" aria-expanded={openCard} onClick={() => setOpenCard(!openCard)}>
        <span><b>{m.title}</b> <span className={`badge ${m.status === 'done' ? 'done' : m.atRisk ? 'wait' : 'work'}`}><i />{m.status === 'done' ? 'done' : m.atRisk ? `${m.slipDays} d late` : 'on track'}</span></span>
        <span className="hint small">{m.delivered}/{m.scope} · {f && m.status === 'open' ? `projected ${fmt(f.predictedDate)}` : `wanted ${fmt(m.targetDate)}`} {openCard ? '▴' : '▾'}</span>
      </button>
      {openCard && <>
      {m.intent && <p className="hint">{m.intent}</p>}
      <p className="small">{m.delivered}/{m.scope} delivered
        {f && m.status === 'open' && <> · projected <b>{fmt(f.predictedDate)}</b> <span className="hint">({f.confidence} confidence{f.calibration !== 1 ? `, corrected x${f.calibration.toFixed(2)} from past milestones` : ''})</span></>}
        {m.atRisk && <span className="late"> · {m.slipDays} days after your date</span>}
        {m.accuracy && <span className="hint"> · landed {Math.abs(m.accuracy.errorDays)} d {m.accuracy.errorDays > 0 ? 'later' : 'earlier'} than the last projection</span>}
      </p>
      {f?.note && <p className="note small">{f.note}</p>}
      <div className="chips">
        {m.featureIds.map(id => <button key={id} className="chip" title="Remove from this milestone" disabled={busy !== ''} onClick={() => run('unlink', () => contentApi.unlink(m.id, id))}>{features.find(y => y.id === id)?.title ?? id} ×</button>)}
        {free.length > 0 && m.status === 'open' && <select value="" aria-label="Add a feature" onChange={e => e.target.value && run('link', () => contentApi.link(m.id, e.target.value))}><option value="">+ feature</option>{free.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select>}
      </div>
      <div className="row">
        <button onClick={async () => setHistory(history ? null : await contentApi.forecasts(m.id))}>{history ? 'Hide' : 'Show'} how the projection changed</button>
        {m.status === 'open' && <button disabled={busy !== ''} onClick={() => run('done', () => contentApi.markDone(m.id))}>Mark done</button>}
        <button className="linkish" disabled={busy !== ''} onClick={() => run('rm', () => contentApi.removeMilestone(m.id))}>Remove</button>
      </div>
      {history && <ol className="history small">{history.map(h => <li key={h.id}><b>{fmt(h.predictedDate)}</b> <span className="hint">{h.done}/{h.scope} · {new Date(h.madeAt).toLocaleDateString()}</span><br />{h.note}</li>)}</ol>}
      {error && <p className="error">{error}</p>}
      </>}
    </section>
  );
}

function NewMilestone({ projectId, reload }: { projectId: string; reload: () => Promise<void> }) {
  const empty = { title: '', intent: '', targetDate: '', scope: 3 };
  const [form, setForm] = useState(empty);
  const { busy, error, run } = useAction(reload);
  return (
    <details className="card">
      <summary><b>+ New milestone</b></summary>
      <label>Title<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Public beta" /></label>
      <label>What you want, in your words<textarea rows={3} value={form.intent} onChange={e => setForm({ ...form, intent: e.target.value })} placeholder="Let testers plan a week of meals. The story: no more “what’s for dinner”." /></label>
      <div className="two">
        <label>Target date<input type="date" min={today()} value={form.targetDate} onChange={e => setForm({ ...form, targetDate: e.target.value })} /></label>
        <label>Features it takes<input type="number" min={1} max={50} value={form.scope} onChange={e => setForm({ ...form, scope: Number(e.target.value) })} /></label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row"><button className="primary" disabled={busy !== '' || !form.title.trim() || !form.targetDate} onClick={() => run('add', async () => { await contentApi.addMilestone(projectId, form); setForm(empty); })}>Add milestone</button></div>
    </details>
  );
}
