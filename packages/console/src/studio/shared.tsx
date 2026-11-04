import { useState } from 'react';
import type { AgentId, ContentItem, ItemKind, ItemSource } from '../api';
import { locale, t } from '../i18n';

// Who made a piece, in words: the AI team shows its hand, hand edits show as yours.
export const credit = (i: Pick<ContentItem, 'origin' | 'status' | 'revisions'>): string => {
  if (i.origin === 'dev') return t('From the dev workflow');
  if (i.status === 'idea') return i.origin === 'ai' ? t('Suggested by the Strategist') : t('Added by you');
  if (i.status === 'briefed') return t('Accepted — waiting for the Writer');
  return i.revisions > 0 ? t('Drafted by the Writer') : t('Edited by hand');
};

export const today = () => new Date().toISOString().slice(0, 10);
export const fmt = (iso?: string) => iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : t('no date');
export const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? t('just now') : m < 60 ? t('{n} min ago', { n: m }) : m < 1440 ? t('{n} h ago', { n: Math.round(m / 60) }) : t('{n} d ago', { n: Math.round(m / 1440) });
};

// One hue per kind of content, used everywhere the kind shows (calendar, cards, timeline).
export const KIND_HUE: Record<ItemKind, number> = { changelog: 210, 'release-notes': 250, devlog: 170, 'social-post': 330, teaser: 28, 'doc-update': 190, 'demo-script': 290, newsletter: 50 };
export const KindChip = ({ kind }: { kind: ItemKind }) => <span className="kind" style={{ ['--h' as string]: KIND_HUE[kind] }}>{kind.replace('-', ' ')}</span>;

export const SOURCE: Record<Exclude<ItemSource, ''>, { label: string; hint: string }> = {
  trend: { label: t('Trend'), hint: t('Seen working in your field') },
  account: { label: t('Your account'), hint: t('Based on your own numbers') },
  roadmap: { label: t('Roadmap'), hint: t('Tied to what you are building') },
  manager: { label: t('Your brief'), hint: t('You asked for it') },
};

// The communication logic behind a piece, in one clause: which agent saw what.
export const logicFor = (i: Pick<ContentItem, 'origin' | 'source'>): string => {
  if (i.origin !== 'ai') return '';
  return i.source === 'trend' ? t('the Scout saw it work in the field')
    : i.source === 'account' ? t('the Analyst spotted it in your numbers')
    : i.source === 'roadmap' ? t('the Strategist tied it to what you are building')
    : i.source === 'manager' ? t('you asked for it') : '';
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

// How an agent worked: what it read and counted before the model was asked, step by step. Facts from the server, never from the model.
export function Trail({ who, lines, summary }: { who: string; lines?: string[]; summary?: string }) {
  if (!lines || lines.length === 0) return null;
  return (
    <details className="trail"><summary className="hint small">{t('How the {who} worked: {summary}', { who, summary: summary ?? t('{n} steps, each one a fact the server counted, nothing invented', { n: lines.length }) })}</summary>
      <ol>{lines.map((t, n) => <li key={n} className={/ → /.test(t) ? 'refused' : ''}>{t}</li>)}</ol>
    </details>
  );
}
