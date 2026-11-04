import type { ContentItem, Step, StepKind } from '../api';
import { AGENT_HUE, ago } from './shared';
import { t, t2 } from '../i18n';

// The gates a post goes through, in order. A gate is passed when a step of its kind exists, or when the piece is already past it.
const GATES: Array<{ title: string; kinds: StepKind[]; past: ContentItem['status'][] }> = [
  { title: t('Idea'), kinds: ['proposed', 'added', 'reused', 'restored'], past: ['briefed', 'drafted', 'approved', 'published', 'rejected'] },
  { title: t('Decision'), kinds: ['accepted', 'refused'], past: ['briefed', 'drafted', 'approved', 'published', 'rejected'] },
  { title: t('Draft'), kinds: ['drafted'], past: ['approved', 'published'] },
  { title: t('Review'), kinds: ['revised', 'edited', 'asked', 'picture'], past: ['approved', 'published'] },
  { title: t('Sign-off'), kinds: ['approved'], past: ['published'] },
  { title: t('Posted'), kinds: ['posted', 'matched'], past: [] },
];

const WHO: Record<Step['who'], string> = { you: t('You'), director: 'Director', scout: 'Scout', analyst: 'Analyst', strategist: 'Strategist', writer: 'Writer' };
const ICON: Record<StepKind, string> = { proposed: '💡', added: '✎', accepted: '✓', refused: '✕', restored: '↶', drafted: '¶', revised: '↻', edited: '✎', picture: '▣', approved: '✓', posted: '➚', matched: '⇄', reused: '↩', asked: '?', answered: '…' };

export const chainOf = (item: ContentItem): Step[] => item.chain ?? [];

// The gates as a strip: passed, current, or still ahead. Reads in one glance where the piece stands and who has already acted.
export function Checkpoints({ item }: { item: ContentItem }) {
  const steps = chainOf(item);
  const refused = item.status === 'rejected';
  const passed = GATES.map(g => steps.some(s => g.kinds.includes(s.kind)) || g.past.includes(item.status));
  const current = refused ? 1 : passed.lastIndexOf(true) + 1;
  return (
    <ol className={`gates${refused ? ' refused' : ''}`} aria-label={t('Where it stands')}>
      {GATES.map((g, n) => {
        const last = [...steps].reverse().find(s => g.kinds.includes(s.kind));
        const state = passed[n] ? 'done' : n === current ? 'now' : 'todo';
        // In a narrow card only the gate that matters is named: the next one, or the last one passed.
        const named = state === 'now' || (current >= GATES.length && n === passed.lastIndexOf(true)) || (refused && n === 1);
        return <li key={g.title} className={`${state}${named ? ' named' : ''}`} title={last ? t('{who}, {when}: {text}', { who: WHO[last.who], when: ago(last.at), text: last.text }) : g.title}><i /><span>{refused && n === 1 ? t('Refused') : g.title}</span></li>;
      })}
    </ol>
  );
}

// The chain itself: every step, who did it, when, in a few words. Newest last, like a thread.
export function ChainLog({ item, limit }: { item: ContentItem; limit?: number }) {
  const all = chainOf(item);
  const steps = limit ? all.slice(-limit) : all;
  if (all.length === 0) return <p className="hint small">{t('No step recorded yet.')}</p>;
  return (
    <ol className="chain">
      {limit && all.length > limit && <li className="more hint small">{t2(all.length - limit, '{n} earlier step', '{n} earlier steps')}</li>}
      {steps.map((s, n) => (
        <li key={n} className={`step ${s.kind} ${s.who === 'you' ? 'you' : 'agent'}`} style={s.who !== 'you' ? { ['--h' as string]: AGENT_HUE[s.who] } : undefined}>
          <i aria-hidden>{ICON[s.kind]}</i>
          <div><b>{WHO[s.who]}</b> <span>{s.text}</span><small>{ago(s.at)}</small></div>
        </li>
      ))}
    </ol>
  );
}
