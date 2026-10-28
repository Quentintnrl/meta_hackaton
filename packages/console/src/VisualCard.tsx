import { useState } from 'react';
import { api, type ElementResult, type Feature } from './api';

const CHIP: Record<ElementResult['status'], string> = { match: 'match', missing: 'missing', moved: 'moved', fewer: 'fewer', inconclusive: 'not seen' };

export function VisualCard({ feature: f, onError }: { feature: Feature; onError: (m: string) => void }) {
  const [open, setOpen] = useState<string | null>(null); // the element highlighted on the images
  const v = f.visual;
  const base = `/api/features/${f.id}/visual`;
  const waiting = f.state === 'VISUAL_CHECK' && !v;

  const shown = v?.elements.filter(e => (open ? e.phrase === open : e.status !== 'inconclusive')) ?? [];

  return (
    <section className="card">
      <div className="head">
        <h3>Visual check</h3>
        {v && <span className={`badge ${v.verdict === 'pass' ? 'done' : v.verdict === 'fail' ? 'wait' : 'work'}`}><i />{v.verdict}</span>}
      </div>

      {!f.hasMockup && <p className="hint">No Figma frame is linked to this feature, so there is nothing to compare with. Check it by hand below.</p>}
      {waiting && f.hasMockup && <p className="hint">Running the app and comparing it with the Figma frame…</p>}

      {v && (
        <>
          {v.feedback && <pre className="feedback">{v.feedback}</pre>}
          <div className="shots">
            {([['Figma', v.mockupFile, 'mockup'], ['Build', v.appFile, 'app']] as const).map(([title, file, side]) => (
              <figure key={side}>
                <figcaption>{title}</figcaption>
                <div className="shot">
                  <img src={`${base}/${file}?t=${encodeURIComponent(v.at)}`} alt={`${title} screenshot`} />
                  <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
                    {shown.flatMap(e => e[side].map((b, i) => (
                      <rect key={`${e.phrase}${i}`} x={b.x1} y={b.y1} width={b.x2 - b.x1} height={b.y2 - b.y1} className={`box ${e.status}`} vectorEffect="non-scaling-stroke" />
                    )))}
                  </svg>
                </div>
              </figure>
            ))}
          </div>
          <ul className="elements">
            {v.elements.map(e => (
              <li key={e.phrase}>
                <button className={open === e.phrase ? 'el on' : 'el'} onClick={() => setOpen(open === e.phrase ? null : e.phrase)}>
                  <span>{e.phrase}</span>
                  <span className={`chip ${e.status}`}>{CHIP[e.status]}</span>
                  <small>{e.mockup.length} in the mockup, {e.app.length} in the build</small>
                </button>
              </li>
            ))}
          </ul>
          <p className="hint small">Click an element to see where it was found. Elements the segmenter could not see in the mockup do not count either way.</p>
        </>
      )}

      {f.hasMockup && f.state === 'VISUAL_CHECK' && (
        <div className="row"><button onClick={() => api.rerunVisual(f.id).catch(e => onError((e as Error).message))}>Run the check again</button></div>
      )}
    </section>
  );
}
