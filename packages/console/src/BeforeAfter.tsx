import { useState, type CSSProperties } from 'react';
import type { Feature } from './api';
import { ZoomImage } from './Lightbox';

// The app before the feature (the base branch) next to the app after, at the same size.
export function BeforeAfter({ feature: f }: { feature: Feature }) {
  const [compare, setCompare] = useState(false);
  const [pos, setPos] = useState(50);

  const base = `/api/features/${f.id}/visual`;
  const before = f.before ? `${base}/${f.before}` : undefined;
  const built = f.visual ? `${base}/${f.visual.appFile}?t=${encodeURIComponent(f.visual.at)}` : undefined;
  // Until the build exists, the "after" is the design it will be built from, so the result can be judged before anything is built.
  const target = f.hasMockup && f.mockupFile ? `${base}/${f.mockupFile}` : undefined;
  const after = built ?? target;
  const afterLabel = built ? 'After' : 'After (design preview)';
  // Why there is no "before", if the capture failed.
  const beforeError = !f.before ? [...(f.events ?? [])].reverse().find(e => e.type === 'ERROR' && e.payload.agent === 'before')?.payload.message : undefined;

  return (
    <section className="card">
      <div className="head">
        <h3>Before and after</h3>
        {before && after && <button type="button" className="hand" onClick={() => { setPos(50); setCompare(true); }}>Compare full screen</button>}
      </div>

      {!before && !after && (
        <p className={beforeError ? 'error' : 'hint'}>
          {beforeError ? `The app could not be captured: ${String(beforeError)}` : 'Capturing the app as it is today…'}
        </p>
      )}

      {(before || after) && (
        <div className="shots">
          {([
            ['Before', before, 'The base branch, as it is today.'],
            [afterLabel, after, built ? 'The build of this feature.' : 'Preview: the design this feature will be built from. The real build replaces it.'],
          ] as const).map(([label, src, hint]) => (
            <figure key={label}>
              <figcaption>{label}</figcaption>
              {src ? <ZoomImage className="frame-preview" src={src} alt={`The app, ${label.toLowerCase()}`} /> : <p className="hint small">No capture of the base branch.</p>}
              {src && <p className="hint small">{hint}</p>}
            </figure>
          ))}
        </div>
      )}

      {compare && before && after && (
        <div className="lightbox compare" role="dialog" aria-modal="true" tabIndex={-1} ref={el => el?.focus()} onKeyDown={e => e.key === 'Escape' && setCompare(false)}>
          <button type="button" className="compare-close hand" onClick={() => setCompare(false)}>Close</button>
          <div className="ba" style={{ '--pos': `${pos}%` } as CSSProperties}>
            <img className="ba-after" src={after} alt={`The app, ${afterLabel.toLowerCase()}`} />
            <img className="ba-before" src={before} alt="The app, before" />
            <span className="ba-line" aria-hidden />
            <span className="ba-tag left">Before</span>
            <span className="ba-tag right">{afterLabel}</span>
          </div>
          <input className="ba-range" type="range" min={0} max={100} value={pos} onChange={e => setPos(Number(e.target.value))} aria-label="Compare before and after" autoFocus />
        </div>
      )}
    </section>
  );
}
