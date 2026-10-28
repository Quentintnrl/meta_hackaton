import { useState } from 'react';
import { api, type Failure } from './api';

const WHERE: Record<string, string> = { planner: 'Planner', builder: 'Builder', before: 'Capture before', visual: 'Visual check', integrator: 'Merge' };

// A step failed. Says where, why, what is proposed, and waits: nothing is changed until the user says yes.
export function FailureCard({ featureId, failure: x, onError }: { featureId: string; failure: Failure; onError: (m: string) => void }) {
  const [always, setAlways] = useState(false);
  const [busy, setBusy] = useState(false);
  const answer = (action: 'apply' | 'dismiss') => {
    setBusy(true);
    api.recover(featureId, action, action === 'apply' && always).catch(e => onError((e as Error).message)).finally(() => setBusy(false));
  };

  return (
    <section className="card failure" role="alert">
      <div className="head">
        <h3>Something went wrong</h3>
        <span className="badge fail"><i />{WHERE[x.agent] ?? x.agent}</span>
      </div>
      <p>{x.cause}</p>
      <div className="gate">
        <div><span className="eyebrow">Proposed fix</span><strong>{x.fix.label}</strong></div>
        <p className={x.fix.destructive ? 'warn' : 'hint'}>{x.fix.detail}</p>
        <label className="inline"><span>Do this automatically next time <span className="hint small">(you can switch it off in the project page)</span></span>
          <input type="checkbox" checked={always} onChange={e => setAlways(e.target.checked)} />
        </label>
        <div className="row">
          <button className="primary" disabled={busy} onClick={() => answer('apply')}>{always ? `${x.fix.label}, and always` : x.fix.label}</button>
          <button disabled={busy} onClick={() => answer('dismiss')}>Not now</button>
        </div>
      </div>
      <details><summary>Technical detail</summary><pre className="stat">{x.message}</pre></details>
    </section>
  );
}
