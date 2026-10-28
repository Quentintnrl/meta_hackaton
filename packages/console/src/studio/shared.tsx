import { useState } from 'react';
import type { AgentId, ItemKind, ItemSource } from '../api';

export const today = () => new Date().toISOString().slice(0, 10);
export const fmt = (iso?: string) => iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'no date';
export const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

// One hue per kind of content, used everywhere the kind shows (calendar, cards, timeline).
export const KIND_HUE: Record<ItemKind, number> = { changelog: 210, 'release-notes': 250, devlog: 170, 'social-post': 330, teaser: 28, 'doc-update': 190, 'demo-script': 290, newsletter: 50 };
export const KindChip = ({ kind }: { kind: ItemKind }) => <span className="kind" style={{ ['--h' as string]: KIND_HUE[kind] }}>{kind.replace('-', ' ')}</span>;

export const SOURCE: Record<Exclude<ItemSource, ''>, { label: string; hint: string }> = {
  trend: { label: 'Trend', hint: 'Seen working in your field' },
  account: { label: 'Your account', hint: 'Based on your own numbers' },
  roadmap: { label: 'Roadmap', hint: 'Tied to what you are building' },
  manager: { label: 'Your brief', hint: 'You asked for it' },
};

export const AGENT_HUE: Record<AgentId, number> = { director: 340, scout: 200, analyst: 150, strategist: 270, writer: 20 };

export function useAction(after: () => Promise<void> | void) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const run = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name); setError('');
    try { await fn(); await after(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  return { busy, error, run };
}
