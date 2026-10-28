import { useCallback, useEffect, useState } from 'react';
import { contentApi, ITEM_KINDS, type ContentItem, type ContentView, type Feature, type Forecast, type ItemKind, type Milestone, type Project } from './api';

const today = () => new Date().toISOString().slice(0, 10);
const fmt = (iso?: string) => iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'unscheduled';
const STATUS_TONE: Record<ContentItem['status'], string> = { idea: 'wait', briefed: 'wait', drafted: 'work', approved: 'done', published: 'done' };

// Runs an action and shows its error; `busy` names what is running so the buttons can say so.
function useAction(reload: () => Promise<void>) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const run = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name); setError('');
    try { await fn(); await reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  return { busy, error, run };
}

export function ContentPanel({ project, features }: { project: Project; features: Feature[] }) {
  const [view, setView] = useState<ContentView | null>(null);
  const reload = useCallback(async () => { setView(await contentApi.view(project.id)); }, [project.id]);
  useEffect(() => { reload().catch(() => {}); }, [reload]);
  const { busy, error, run } = useAction(reload);
  const [since, setSince] = useState('');
  if (!view) return <section className="card"><p className="hint">Loading…</p></section>;
  const open = view.items.filter(i => i.status !== 'published');

  return (
    <div className="stack">
      <section className="card">
        <span className="eyebrow">{project.name}</span>
        <h2>Content</h2>
        <p className="hint">Plan the roadmap, say what you want to say, and the AI projects dates, proposes the pieces and drafts them. It revises its own projections as work lands, and the calendar moves with them.</p>
        {error && <p className="error">{error}</p>}
      </section>

      <ProfileCard view={view} projectId={project.id} reload={reload} />
      <Roadmap view={view} project={project} features={features} reload={reload} />

      <section className="card">
        <div className="head"><h3>Calendar</h3></div>
        {open.length === 0 && <p className="hint">Nothing planned. Ask the AI for a plan from a milestone, or add a piece below.</p>}
        <ul className="rows items">{open.map(i => <ItemRow key={i.id} item={i} milestones={view.milestones} reload={reload} />)}</ul>
        <NewItem projectId={project.id} milestones={view.milestones} reload={reload} />
      </section>

      <section className="card">
        <h3>From the dev workflow</h3>
        <p className="hint small">A merged feature starts its own changelog. For work done outside Ripple_handoff, write one from the repository history.</p>
        <div className="row">
          <input style={{ maxWidth: 240 }} value={since} onChange={e => setSince(e.target.value)} placeholder="since (optional): 2 weeks ago, 2026-10-01" />
          <button disabled={busy === 'git'} onClick={() => run('git', () => contentApi.fromGit(project.id, since.trim()))}>{busy === 'git' ? 'Reading the history…' : 'Changelog from git'}</button>
        </div>
      </section>

      {view.items.some(i => i.status === 'published') && (
        <section className="card">
          <h3>Published</h3>
          <ul className="rows">{view.items.filter(i => i.status === 'published').map(i => <li key={i.id}><div className="autofix"><span>{i.title}</span><span className="hint small">{i.kind}</span></div></li>)}</ul>
        </section>
      )}
    </div>
  );
}

function ProfileCard({ view, projectId, reload }: { view: ContentView; projectId: string; reload: () => Promise<void> }) {
  const [p, setP] = useState(view.profile);
  const { busy, error, run } = useAction(reload);
  const dirty = JSON.stringify(p) !== JSON.stringify(view.profile);
  return (
    <details className="card" open={!view.profile.voice && !view.profile.audience}>
      <summary><b>Voice and audience</b> <span className="hint small">what the AI writes with</span></summary>
      <label>Voice<textarea rows={2} value={p.voice} onChange={e => setP({ ...p, voice: e.target.value })} placeholder="Warm, direct, a bit of humour. No marketing jargon." /></label>
      <label>Audience<input value={p.audience} onChange={e => setP({ ...p, audience: e.target.value })} placeholder="Home cooks who hate planning meals" /></label>
      <label>Language<input value={p.language} onChange={e => setP({ ...p, language: e.target.value })} /></label>
      <label className="inline"><span>Draft on its own a few days before a piece is due (it never approves or publishes)</span>
        <input type="checkbox" style={{ width: 'auto' }} checked={p.autoDraft} onChange={e => setP({ ...p, autoDraft: e.target.checked })} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row"><button className="primary" disabled={!dirty || busy !== ''} onClick={() => run('profile', () => contentApi.setProfile(projectId, p))}>Save</button></div>
    </details>
  );
}

function Roadmap({ view, project, features, reload }: { view: ContentView; project: Project; features: Feature[]; reload: () => Promise<void> }) {
  const [form, setForm] = useState({ title: '', intent: '', targetDate: '', scope: 3 });
  const { busy, error, run } = useAction(reload);
  return (
    <section className="card">
      <h3>Roadmap</h3>
      {view.milestones.length === 0 && <p className="hint">No milestone yet. Name what you want to ship and when; say in your own words what it is for.</p>}
      <div className="stack">{view.milestones.map(m => <MilestoneCard key={m.id} m={m} features={features} reload={reload} />)}</div>
      <details className="newbox">
        <summary>+ New milestone</summary>
        <label>Title<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Public beta" /></label>
        <label>What you want<textarea rows={3} value={form.intent} onChange={e => setForm({ ...form, intent: e.target.value })} placeholder="Let testers plan a week of meals. The story: no more 'what's for dinner'." /></label>
        <div className="two">
          <label>Target date<input type="date" min={today()} value={form.targetDate} onChange={e => setForm({ ...form, targetDate: e.target.value })} /></label>
          <label>Features it takes<input type="number" min={1} max={50} value={form.scope} onChange={e => setForm({ ...form, scope: Number(e.target.value) })} /></label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row"><button className="primary" disabled={busy !== '' || !form.title.trim() || !form.targetDate} onClick={() => run('add', async () => { await contentApi.addMilestone(project.id, form); setForm({ title: '', intent: '', targetDate: '', scope: 3 }); })}>Add milestone</button></div>
      </details>
    </section>
  );
}

function MilestoneCard({ m, features, reload }: { m: Milestone; features: Feature[]; reload: () => Promise<void> }) {
  const { busy, error, run } = useAction(reload);
  const [guidance, setGuidance] = useState('');
  const [history, setHistory] = useState<Forecast[] | null>(null);
  const f = m.forecast;
  const free = features.filter(x => !m.featureIds.includes(x.id));
  return (
    <div className={`ms ${m.atRisk ? 'risk' : ''}`}>
      <div className="head">
        <div><b>{m.title}</b> <span className={`badge ${m.status === 'done' ? 'done' : 'work'}`}><i />{m.status}</span></div>
        <div className="hint small">wanted {fmt(m.targetDate)}</div>
      </div>
      {m.intent && <p className="hint small">{m.intent}</p>}
      <div className="bar" aria-label={`${m.delivered} of ${m.scope} delivered`}><i style={{ width: `${Math.min(100, (m.delivered / m.scope) * 100)}%` }} /></div>
      <p className="small">{m.delivered}/{m.scope} delivered
        {f && m.status === 'open' && <> · projected <b>{fmt(f.predictedDate)}</b> <span className="hint">({f.confidence} confidence{f.calibration !== 1 ? `, corrected x${f.calibration.toFixed(2)}` : ''})</span></>}
        {m.atRisk && <span className="late"> · {m.slipDays} days after your date</span>}
        {m.accuracy && <span className="hint"> · landed {Math.abs(m.accuracy.errorDays)} days {m.accuracy.errorDays > 0 ? 'later' : 'earlier'} than the last projection</span>}
      </p>
      {f?.note && <p className="note small">{f.note}</p>}

      <div className="chips">
        {m.featureIds.map(id => { const x = features.find(y => y.id === id); return <button key={id} className="chip" title="Remove from this milestone" disabled={busy !== ''} onClick={() => run('unlink', () => contentApi.unlink(m.id, id))}>{x?.title ?? id} ×</button>; })}
        {free.length > 0 && m.status === 'open' && (
          <select value="" aria-label="Add a feature" onChange={e => e.target.value && run('link', () => contentApi.link(m.id, e.target.value))}>
            <option value="">+ feature</option>
            {free.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}
          </select>
        )}
      </div>

      {m.status === 'open' && (
        <div className="row">
          <input value={guidance} onChange={e => setGuidance(e.target.value)} placeholder="Tell the AI what to keep in mind (optional)" />
          <button className="primary" disabled={busy !== ''} onClick={() => run('plan', () => contentApi.plan(m.id, guidance.trim() || undefined))}>{busy === 'plan' ? 'Planning…' : 'Plan content with AI'}</button>
        </div>
      )}
      <div className="row">
        <button onClick={async () => setHistory(history ? null : await contentApi.forecasts(m.id))}>{history ? 'Hide' : 'Show'} projection history</button>
        {m.status === 'open' && <button disabled={busy !== ''} onClick={() => run('done', () => contentApi.markDone(m.id))}>Mark done</button>}
        <button disabled={busy !== ''} onClick={() => run('rm', () => contentApi.removeMilestone(m.id))}>Remove</button>
      </div>
      {history && <ol className="history small">{history.map(h => <li key={h.id}><b>{fmt(h.predictedDate)}</b> <span className="hint">{h.done}/{h.scope}, made {new Date(h.madeAt).toLocaleDateString()}</span><br />{h.note}</li>)}</ol>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function ItemRow({ item, milestones, reload }: { item: ContentItem; milestones: Milestone[]; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction(reload);
  const [brief, setBrief] = useState(item.brief);
  const [draft, setDraft] = useState(item.draft);
  const [ask, setAsk] = useState('');
  useEffect(() => { setBrief(item.brief); setDraft(item.draft); }, [item.brief, item.draft]);
  const ms = milestones.find(m => m.id === item.milestoneId);
  const b = busy !== '';
  return (
    <li className="item-row">
      <button className="item-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="when">{fmt(item.date)}{item.shiftDays ? <em className={item.shiftDays > 0 ? 'late' : 'early'}> {item.shiftDays > 0 ? '+' : ''}{item.shiftDays}d</em> : null}</span>
        <span className="what"><b>{item.title}</b><span className="hint small"> {item.kind}{ms ? ` · ${ms.title}` : ''}{item.origin !== 'user' ? ` · ${item.origin === 'ai' ? 'AI idea' : 'from dev'}` : ''}</span></span>
        <span className={`badge ${STATUS_TONE[item.status]}`}><i />{item.status}</span>
      </button>
      {open && (
        <div className="item-body">
          <label>What you want it to say<textarea rows={2} value={brief} onChange={e => setBrief(e.target.value)} /></label>
          <div className="row">
            {brief !== item.brief && <button disabled={b} onClick={() => run('brief', () => contentApi.patchItem(item.id, { brief }))}>Save brief</button>}
            <button className="primary" disabled={b} onClick={() => run('draft', () => contentApi.draft(item.id, ask.trim() || undefined))}>{busy === 'draft' ? 'Writing…' : item.draft ? 'Draft again' : 'Draft with AI'}</button>
            <input value={ask} onChange={e => setAsk(e.target.value)} placeholder="Direction for the AI (optional)" />
          </div>
          {item.draft && <>
            <label>Draft<textarea rows={8} value={draft} onChange={e => setDraft(e.target.value)} /></label>
            <div className="row">
              {draft !== item.draft && <button disabled={b} onClick={() => run('save', () => contentApi.patchItem(item.id, { draft }))}>Save my edits</button>}
              <input value={ask} onChange={e => setAsk(e.target.value)} placeholder="Ask for a change: shorter, less formal…" />
              <button disabled={b || !ask.trim()} onClick={() => run('revise', async () => { await contentApi.revise(item.id, ask.trim()); setAsk(''); })}>{busy === 'revise' ? 'Revising…' : 'Revise'}</button>
            </div>
          </>}
          <div className="row">
            <button disabled={b || !item.draft || draft !== item.draft} onClick={() => run('approve', () => contentApi.approve(item.id))}>Approve</button>
            <button disabled={b || item.status !== 'approved'} onClick={() => run('publish', () => contentApi.publish(item.id))}>Mark published</button>
            <button disabled={b} onClick={() => run('rm', () => contentApi.removeItem(item.id))}>Delete</button>
            <label className="inline lock"><span>Lock date</span>
              <input type="date" value={item.fixedDate ?? ''} onChange={e => run('date', () => e.target.value ? contentApi.patchItem(item.id, { fixedDate: e.target.value }) : contentApi.patchItem(item.id, { clearFixedDate: true }))} />
            </label>
          </div>
          {item.exportedPath && <p className="hint small">Approved copy: <code>{item.exportedPath}</code></p>}
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </li>
  );
}

function NewItem({ projectId, milestones, reload }: { projectId: string; milestones: Milestone[]; reload: () => Promise<void> }) {
  const [f, setF] = useState<{ kind: ItemKind; title: string; brief: string; milestoneId: string; offsetDays: number }>({ kind: 'social-post', title: '', brief: '', milestoneId: '', offsetDays: 0 });
  const { busy, error, run } = useAction(reload);
  return (
    <details className="newbox">
      <summary>+ Add a piece yourself</summary>
      <div className="two">
        <label>Kind<select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as ItemKind })}>{ITEM_KINDS.map(k => <option key={k}>{k}</option>)}</select></label>
        <label>Title<input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></label>
      </div>
      <label>What you want it to say<textarea rows={2} value={f.brief} onChange={e => setF({ ...f, brief: e.target.value })} /></label>
      <div className="two">
        <label>Tied to<select value={f.milestoneId} onChange={e => setF({ ...f, milestoneId: e.target.value })}><option value="">no milestone (set a date later)</option>{milestones.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select></label>
        <label>Days from landing<input type="number" disabled={!f.milestoneId} value={f.offsetDays} onChange={e => setF({ ...f, offsetDays: Number(e.target.value) })} /></label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row"><button className="primary" disabled={busy !== '' || !f.title.trim()} onClick={() => run('add', async () => { await contentApi.addItem(projectId, { kind: f.kind, title: f.title, brief: f.brief, milestoneId: f.milestoneId || undefined, offsetDays: f.milestoneId ? f.offsetDays : undefined }); setF({ ...f, title: '', brief: '' }); })}>Add</button></div>
    </details>
  );
}
