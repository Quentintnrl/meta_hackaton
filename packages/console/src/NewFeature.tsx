import { useState } from 'react';
import { api } from './api';
import { FigmaPreview } from './FigmaPreview';
import { AutonomyPicker, allAt, type AutonomyChoice } from './AutonomyPicker';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

export function NewFeature({ projectName, projectId, prefill, onCreated, existing }: { projectName: string; projectId: string; prefill?: { title: string; design: string }; onCreated: (id: string) => void; existing: string[] }) {
  const [title, setTitle] = useState(prefill?.title ?? '');
  const [figma, setFigma] = useState('');
  const [design, setDesign] = useState(prefill?.design ?? '');
  const [autonomy, setAutonomy] = useState<AutonomyChoice>(allAt('low'));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    let id = slug(title) || 'feature';
    for (let n = 2; existing.includes(id); n++) id = `${slug(title)}-${n}`;
    try {
      await api.createFeature(projectId, { id, title, design, autonomy, figma: figma.trim() || undefined });
      onCreated(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <span className="eyebrow">{projectName}</span>
      <h2>New feature</h2>
      <p className="hint">Point to the Figma frame that shows the change. The agents plan it, build it, and check the result against it.</p>

      <label>Title<input value={title} onChange={e => setTitle(e.target.value)} placeholder="Automatic shopping list" /></label>
      <label>Figma frame
        <input value={figma} onChange={e => setFigma(e.target.value)} placeholder="https://www.figma.com/design/…?node-id=3-102" inputMode="url" />
        <span className="field-hint">In Figma: right-click the frame, Copy/Paste as, Copy link to selection.</span>
      </label>
      <FigmaPreview url={figma} />
      <label><span>Notes <span className="opt">{figma.trim() ? 'optional: anything the frame does not show' : 'what changed, if there is no frame'}</span></span>
        <textarea rows={4} value={design} onChange={e => setDesign(e.target.value)} placeholder="Behaviour, edge cases, what must not change…" />
      </label>

      <AutonomyPicker value={autonomy} onChange={setAutonomy} />

      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy || !title.trim() || !(figma.trim() || design.trim())} onClick={submit}>
          {busy ? (figma.trim() ? 'Reading the frame…' : 'Planning…') : 'Plan this feature'}
        </button>
      </div>
    </section>
  );
}
