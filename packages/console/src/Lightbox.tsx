import { useState } from 'react';

// An image that opens full size on click; click or Escape closes it.
export function ZoomImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [zoom, setZoom] = useState(false);
  return (
    <>
      <button type="button" className="frame-button" onClick={() => setZoom(true)} aria-label={`Enlarge: ${alt}`}>
        <img className={className} src={src} alt={alt} />
      </button>
      {zoom && (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setZoom(false)} onKeyDown={e => e.key === 'Escape' && setZoom(false)} tabIndex={-1} ref={el => el?.focus()}>
          <img src={src} alt={`${alt} (enlarged)`} />
        </div>
      )}
    </>
  );
}
