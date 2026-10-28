import type { Feature } from './api';
import { ZoomImage } from './Lightbox';

// The Figma frame this feature is built from, shown here so the design never has to be opened elsewhere.
export function DesignCard({ feature: f }: { feature: Feature }) {
  if (!f.hasMockup || !f.mockupFile) return null;
  const src = `/api/features/${f.id}/visual/${f.mockupFile}`;

  return (
    <section className="card">
      <div className="head">
        <h3>Design</h3>
        {f.figma && <a href={f.figma} target="_blank" rel="noopener noreferrer" className="small">Open in Figma</a>}
      </div>
      <ZoomImage className="frame-preview" src={src} alt="The Figma frame this feature is built from" />
    </section>
  );
}
