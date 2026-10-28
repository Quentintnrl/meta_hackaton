import { useEffect, useState } from 'react';
import { api, FLOW, label, tone, type Feature, type Gate, type Project } from './api';
import { VisualCard } from './VisualCard';
import { DesignCard } from './DesignCard';
import { BeforeAfter } from './BeforeAfter';
import { FailureCard } from './FailureCard';

// States where a gate waits for the user, and which gate it is.
const GATE_AT: Record<string, Gate> = { PLANNED: 'plan', PR_READY: 'merge', MERGE_FAILED: 'merge', ANNOUNCE_DRAFTED: 'publish' };

export function FeaturePanel({ id, rev, project }: { id: string; rev: number; project?: Project }) {
  const [f, setF] = useState<Feature>();
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [push, setPush] = useState(false);

  useEffect(() => { api.get(id).then(setF).catch(e => setError(String(e.message))); }, [id, rev]);
  if (!f) return <p className="hint">{error || 'Loading…'}</p>;

  const act = (p: Promise<unknown>) => { setError(''); p.catch(e => setError((e as Error).message)); };
  const gate = GATE_AT[f.state];
  const at = FLOW.indexOf(f.state === 'MERGE_FAILED' ? 'MERGING' : f.state);
  const lastError = f.state === 'MERGE_FAILED' ? [...(f.events ?? [])].reverse().find(e => e.type === 'ERROR')?.payload.message : undefined;

  return (
    <div className="stack">
      <section className="card">
        <div className="head">
          <h2>{f.title}</h2>
          <span className={`badge ${tone(f.state)}`}><i />{label(f.state)}</span>
        </div>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={FLOW.length} aria-valuenow={at + 1}>
          {FLOW.map((s, i) => <span key={s} className={i < at ? 'done' : i === at ? 'now' : ''} title={label(s)} />)}
        </div>
        <p className="hint small">Step {at + 1} of {FLOW.length}{f.figma && <> · <a href={f.figma} target="_blank" rel="noopener noreferrer">Open the Figma frame</a></>}</p>
        {error && <p className="error">{error}</p>}

        {gate && (
          <div className="gate">
            <div><span className="eyebrow">Your call</span><strong>Validate the {gate}</strong></div>
            {f.state === 'MERGE_FAILED' && <p className="error">The merge failed: {String(lastError ?? 'unknown error')}</p>}
            {gate === 'merge' && project?.repoUrl && (
              <label className="inline"><span>Also push <code>main</code> to origin <span className="hint small">(publishes to {project.repoUrl})</span></span>
                <input type="checkbox" checked={push} onChange={e => setPush(e.target.checked)} />
              </label>
            )}
            <button className="primary" onClick={() => act(api.approve(f.id, gate, gate === 'merge' ? push : undefined))}>
              {gate === 'plan' ? 'Approve plan and build' : f.state === 'MERGE_FAILED' ? 'Retry the merge' : gate === 'merge' ? 'Approve and merge into main' : 'Approve and publish'}
            </button>
          </div>
        )}
        {f.state === 'MERGING' && <p className="hint">Merging the branch into main…</p>}
        {f.merge && <p className="hint">Merged into main (<code>{f.merge.commit.slice(0, 7)}</code>). {f.merge.pushed ? 'Pushed to origin.' : f.merge.pushError ? `Not pushed: ${f.merge.pushError}` : 'Not pushed.'}</p>}
        {f.state === 'BUILDING' && !f.failure && <p className="hint">Muse Code is building on a branch. This takes a few minutes.</p>}
        {f.state === 'VISUAL_CHECK' && (
          <div className="gate">
            <div><span className="eyebrow">Your call · manual visual check</span><strong>Run the branch and compare it with the mockup</strong></div>
            <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="If it differs, say what is wrong. The builder gets this as feedback." />
            <div className="row">
              <button className="primary" onClick={() => act(api.event(f.id, 'VISUAL_OK'))}>Matches the mockup</button>
              <button disabled={!note.trim()} onClick={() => { act(api.event(f.id, 'VISUAL_DIFF', note)); setNote(''); }}>Differs: rebuild with this feedback</button>
            </div>
          </div>
        )}
      </section>

      {f.failure && <FailureCard featureId={f.id} failure={f.failure} onError={setError} />}

      <BeforeAfter feature={f} />

      <DesignCard feature={f} />

      {(f.visual || f.state === 'VISUAL_CHECK') && <VisualCard feature={f} onError={setError} />}

      {f.plan && (
        <section className="card">
          <h3>Plan</h3>
          <p>{f.plan.summary}</p>
          <ol>{f.plan.steps.map(s => <li key={s.title}><strong>{s.title}.</strong> {s.detail}</li>)}</ol>
          {f.plan.options.length > 0 && (
            <>
              <h4 className="eyebrow">Technical options · the recommended one is used</h4>
              <ul className="options">{f.plan.options.map(o => <li key={o.question}><span>{o.question}</span><span className="choices">{o.choices.map(c => <em key={c} className={c === o.recommended ? 'rec' : ''}>{c}</em>)}</span></li>)}</ul>
            </>
          )}
        </section>
      )}

      {f.build && (
        <section className="card">
          <h3>Build on <code>{f.build.branch}</code></h3>
          <pre className="stat">{f.build.stat}</pre>
          {f.build.diff && <details><summary>Diff</summary><pre className="diff">{f.build.diff}</pre></details>}
          <p className="hint">Test it: <code>cd out/worktrees/{f.projectId}/{f.id} && pnpm install && pnpm dev</code></p>
        </section>
      )}
    </div>
  );
}
