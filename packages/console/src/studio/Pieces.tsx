import { useState } from 'react';
import { contentApi, teamApi, type AgentId, type ContentItem, type ContentView } from '../api';
import { t } from '../i18n';
import { KindChip, SOURCE, ago, credit, fmt, logicFor, useAction } from './shared';
import { ProofCard } from './Numbers';
import type { View } from './Studio';

// What each kind of piece is, in words a non-specialist understands.
const WHAT: Record<string, string> = {
  'social-post': t('A post for your account'), teaser: t('A short teaser to build excitement'), devlog: t('A behind-the-scenes story of the build'),
  newsletter: t('An email to your list'), changelog: t('A short “what is new” note'), 'release-notes': t('Release notes for a version'), 'doc-update': t('An update to your docs'), 'demo-script': t('A script for a demo video'),
};

// Accepted pieces the Writer has not drafted yet: visible here, not lost in the calendar.
export function BriefedList({ briefed, autoDraft, reload, go, open, askAgent }: { pid: string; briefed: ContentItem[]; autoDraft: boolean; reload: () => Promise<void>; go: (v: View) => void; open: (id: string) => void; askAgent: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void }) {
  const { busy, error, run } = useAction(reload);
  return (
    <section className="card">
      <div className="head"><h3>{t('Accepted, not written yet')} <span className="count">{briefed.length}</span></h3><button className="linkish" onClick={() => go('calendar')}>{t('See in calendar →')}</button></div>
      <p className="hint small">{autoDraft ? t('The Writer drafts these on its own 3 days before they are due. You can also start one now.') : <>{t('The Writer waits for you to start one. Or')} <button className="linkish tight" onClick={() => go('team')}>{t('let it draft on its own')}</button> {t('3 days before the date.')}</>}</p>
      <ul className="rows">{briefed.map(i => (
        <li key={i.id}>
          <button onClick={() => open(i.id)}><span className="rowmain"><KindChip kind={i.kind} /> <b>{i.title}</b></span><span className="hint small">{credit(i)} · {fmt(i.fixedDate ?? i.date)} · {t('Open →')}</span></button>
          <span className="row"><button className="primary" disabled={busy !== ''} onClick={() => run(`draft-${i.id}`, () => contentApi.draft(i.id))}>{busy === `draft-${i.id}` ? t('Writing…') : t('Write it now')}</button><button className="linkish" onClick={() => askAgent('writer', 'item', i.id)}>{t('Ask the Writer →')}</button></span>
        </li>
      ))}</ul>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

// One idea at a time, large, with three clear answers.
export function IdeaDeck({ ideas, milestones, stats, simulated, reload, askAgent }: { ideas: ContentItem[]; milestones: ContentView['milestones']; stats?: Array<{ format: string; posts: number; avgEngagement: number }>; simulated?: boolean; reload: () => Promise<void>; askAgent: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void }) {
  const [skipped, setSkipped] = useState<string[]>([]);
  const queue = [...ideas.filter(i => !skipped.includes(i.id)), ...ideas.filter(i => skipped.includes(i.id))];
  const item = queue[0];
  const [refusing, setRefusing] = useState(false);
  const [more, setMore] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction(async () => { setRefusing(false); setMore(false); setReason(''); await reload(); });
  const src = item.source ? SOURCE[item.source] : undefined;
  const ms = milestones.find(m => m.id === item.milestoneId)?.title;
  return (
    <section className="card deck">
      <div className="head"><h3>{t('Idea for you to judge')}</h3><span className="hint small">{ideas.length > 1 ? t('Proposed {when} · {n} waiting, this is the first', { when: ago(item.createdAt), n: ideas.length }) : t('Proposed {when} · the only one waiting', { when: ago(item.createdAt) })}</span></div>
      <div className="idea">
        <div className="top"><KindChip kind={item.kind} /><span className="hint small">{WHAT[item.kind] ?? ''} · {credit(item)}</span><button className="linkish" onClick={() => askAgent('strategist', 'item', item.id)}>{t('Ask the Strategist →')}</button></div>
        <h2>{item.title}</h2>
        <p className="when-line">{t('Planned for')} <b>{fmt(item.fixedDate ?? item.date)}</b>{ms ? <> · {t('around')} <b>{ms}</b></> : null}</p>
        {item.rationale && <div className="why-big"><b>{credit(item)}{logicFor(item) ? ` · ${logicFor(item)}` : src ? ` · ${src.hint.toLowerCase()}` : ''}</b><p>{item.rationale.split('\nEvidence: ')[0]}</p>{!item.proof && item.rationale.includes('\nEvidence: ') && <span className="evidence">{t('Proven by: {evidence}', { evidence: item.rationale.split('\nEvidence: ')[1] })}</span>}</div>}
        {item.proof && <ProofCard proof={item.proof} stats={stats ?? []} simulated={simulated} />}
        {more && <div className="why-big"><b>{t('What it would say')}</b><p>{item.brief}</p></div>}
      </div>
      {refusing ? (
        <div className="refuse">
          <input autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder={t('Why not? (optional: the team remembers and stops suggesting it)')} onKeyDown={e => e.key === 'Enter' && run('no', () => teamApi.reject(item.id, reason))} />
          <button disabled={busy !== ''} onClick={() => run('no', () => teamApi.reject(item.id, reason))}>{t('Refuse')}</button>
          <button className="linkish" onClick={() => setRefusing(false)}>{t('Cancel')}</button>
        </div>
      ) : (
        <div className="answers">
          <button className="primary big" disabled={busy !== ''} onClick={() => run('yes', async () => { await teamApi.accept(item.id); await contentApi.draft(item.id); })}>{busy === 'yes' ? t('Writing…') : t('✓ Yes, write it')}</button>
          <button className="big" disabled={busy !== ''} onClick={() => setRefusing(true)}>{t('✕ No')}</button>
          {ideas.length > 1 && <button className="linkish" onClick={() => setSkipped(s => [...s, item.id])}>{t('Not now, next idea →')}</button>}
          <button className="linkish" onClick={() => setMore(!more)}>{more ? t('Hide details') : t('What would it say?')}</button>
          <button className="linkish" title={t('Keep it on the plan without writing it yet')} disabled={busy !== ''} onClick={() => run('keep', () => teamApi.accept(item.id))}>{t('Keep for later')}</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
