import { useState } from 'react';
import { contentApi, teamApi, type AgentId, type ContentItem, type ContentView, type TeamView } from '../api';
import { KindChip, SOURCE, credit, fmt, useAction } from './shared';
import type { View } from './Studio';

// What each kind of piece is, in words a non-specialist understands.
const WHAT: Record<string, string> = {
  'social-post': 'A post for your account', teaser: 'A short teaser to build excitement', devlog: 'A behind-the-scenes story of the build',
  newsletter: 'An email to your list', changelog: 'A short “what is new” note', 'release-notes': 'Release notes for a version', 'doc-update': 'An update to your docs', 'demo-script': 'A script for a demo video',
};

// Ask the team for ideas: one input, three examples, go. Ideas land in Today when ready.
export function AskPanel({ pid, team, view, go, reload }: { pid: string; team: TeamView; view: ContentView; go: (v: View) => void; reload: () => Promise<void> }) {
  const [brief, setBrief] = useState('');
  const { busy, error, run } = useAction(reload);
  const working = Boolean(team.working);
  const ask = () => run('run', () => teamApi.run(pid, ['scout', 'analyst', 'strategist'], brief.trim()));
  return (
    <section className="card brief-card">
      <label>What should the team think about? <span className="opt">optional</span>
        <div className="briefbar">
          <input value={brief} onChange={e => setBrief(e.target.value)} placeholder="e.g. Get people excited about the beta. Or leave empty." onKeyDown={e => e.key === 'Enter' && ask()} />
          <button className="primary" disabled={busy !== '' || working} onClick={ask}>{working ? 'Working…' : busy ? 'Asking…' : 'Go'}</button>
        </div>
      </label>
      <div className="chips">{['Prepare the next release', 'More like what works for us', 'Refresh the field research'].map(q => <button key={q} className="chip" onClick={() => setBrief(q)}>{q}</button>)}</div>
      {!(view.profile.voice || view.profile.audience || view.profile.niche || view.profile.directives) && <p className="hint small">The team writes better when it knows your voice. <button className="linkish" onClick={() => go('team')}>Tell it about your project →</button></p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

// Accepted pieces the Writer has not drafted yet: visible here, not lost in the calendar.
export function BriefedList({ briefed, autoDraft, reload, go, open, askAgent }: { pid: string; briefed: ContentItem[]; autoDraft: boolean; reload: () => Promise<void>; go: (v: View) => void; open: (id: string) => void; askAgent: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void }) {
  const { busy, error, run } = useAction(reload);
  return (
    <section className="card">
      <div className="head"><h3>Waiting to be written <span className="count">{briefed.length}</span></h3><button className="linkish" onClick={() => go('calendar')}>See in calendar →</button></div>
      <p className="hint small">{autoDraft ? 'The Writer drafts these on its own 3 days before they are due. You can also start one now.' : 'Auto-draft is off. Start one now, or let the Writer do it in Team → Voice & rules.'}</p>
      {!autoDraft && <p className="hint small"><button className="linkish" onClick={() => go('team')}>Turn on auto-draft →</button></p>}
      <ul className="rows">{briefed.map(i => (
        <li key={i.id}>
          <button onClick={() => open(i.id)}><span className="rowmain"><KindChip kind={i.kind} /> <b>{i.title}</b></span><span className="hint small">{credit(i)} · {fmt(i.fixedDate ?? i.date)} · Open →</span></button>
          <span className="row"><button className="primary" disabled={busy !== ''} onClick={() => run(`draft-${i.id}`, () => contentApi.draft(i.id))}>{busy === `draft-${i.id}` ? 'Writing…' : 'Write it now'}</button><button className="linkish" onClick={() => askAgent('writer', 'item', i.id)}>Ask the Writer →</button></span>
        </li>
      ))}</ul>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

// One idea at a time, large, with three clear answers.
export function IdeaDeck({ ideas, milestones, reload, askAgent }: { ideas: ContentItem[]; milestones: ContentView['milestones']; reload: () => Promise<void>; askAgent: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void }) {
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
      <div className="head"><h3>Idea from your team</h3><span className="hint small">{ideas.length > 1 ? `${ideas.length} waiting · this is the first` : 'the only one waiting'}</span></div>
      <div className="idea">
        <div className="top"><KindChip kind={item.kind} /><span className="hint small">{WHAT[item.kind] ?? ''} · {credit(item)}</span><button className="linkish" onClick={() => askAgent('strategist', 'item', item.id)}>Ask the Strategist →</button></div>
        <h2>{item.title}</h2>
        <p className="when-line">Planned for <b>{fmt(item.fixedDate ?? item.date)}</b>{ms ? <> · around <b>{ms}</b></> : null}</p>
        {item.rationale && <div className="why-big"><b>Why the team suggests it{src ? ` · ${src.hint.toLowerCase()}` : ''}</b><p>{item.rationale}</p></div>}
        {more && <div className="why-big"><b>What it would say</b><p>{item.brief}</p></div>}
      </div>
      {refusing ? (
        <div className="refuse">
          <input autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="Why not? (optional: the team remembers and stops suggesting it)" onKeyDown={e => e.key === 'Enter' && run('no', () => teamApi.reject(item.id, reason))} />
          <button disabled={busy !== ''} onClick={() => run('no', () => teamApi.reject(item.id, reason))}>Refuse</button>
          <button className="linkish" onClick={() => setRefusing(false)}>Cancel</button>
        </div>
      ) : (
        <div className="answers">
          <button className="primary big" disabled={busy !== ''} onClick={() => run('yes', async () => { await teamApi.accept(item.id); await contentApi.draft(item.id); })}>{busy === 'yes' ? 'Writing…' : '✓ Yes, write it'}</button>
          <button className="big" disabled={busy !== ''} onClick={() => setRefusing(true)}>✕ No</button>
          {ideas.length > 1 && <button className="linkish" onClick={() => setSkipped(s => [...s, item.id])}>Not now, next idea →</button>}
          <button className="linkish" onClick={() => setMore(!more)}>{more ? 'Hide details' : 'What would it say?'}</button>
          <button className="linkish" title="Keep it on the plan without writing it yet" disabled={busy !== ''} onClick={() => run('keep', () => teamApi.accept(item.id))}>Keep for later</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
