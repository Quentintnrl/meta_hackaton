import { useEffect, useState } from 'react';

// What the pasted link points at, so nobody has to open Figma to check it.
export function FigmaPreview({ url }: { url: string }) {
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'loading' } | { kind: 'ok'; src: string } | { kind: 'error'; message: string }>({ kind: 'idle' });

  useEffect(() => {
    if (!/^https:\/\/(www\.)?figma\.com\/(design|file)\//.test(url.trim())) return setState({ kind: 'idle' });
    const controller = new AbortController();
    let blobUrl: string | undefined;
    setState({ kind: 'loading' });
    // Debounced: a link being typed or pasted triggers one request, not one per character.
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/figma/preview?url=${encodeURIComponent(url.trim())}`, { signal: controller.signal });
        if (!res.ok) return setState({ kind: 'error', message: ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}` });
        blobUrl = URL.createObjectURL(await res.blob());
        setState({ kind: 'ok', src: blobUrl });
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setState({ kind: 'error', message: (e as Error).message });
      }
    }, 600);
    return () => { clearTimeout(timer); controller.abort(); if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [url]);

  if (state.kind === 'idle') return null;
  if (state.kind === 'loading') return <p className="hint small">Fetching the frame from Figma…</p>;
  if (state.kind === 'error') return <p className="error">{state.message}</p>;
  return <img className="frame-preview" src={state.src} alt="Preview of the linked Figma frame" />;
}
