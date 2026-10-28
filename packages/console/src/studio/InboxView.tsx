import { useState } from 'react';
import { contentApi, teamApi, type ContentItem, type ContentView, type TeamView } from '../api';
import { KindChip, SOURCE, fmt, useAction } from './shared';
import type { View } from './Studio';

// What each kind of piece is, in words a non-specialist understands.
const WHAT: Record<string, string> = {
  'social-post': 'A post for your account', teaser: 'A short teaser to build excitement', devlog: 'A behind-the-scenes story of the build',
  newsletter: 'An email to your list', changelog: 'A short “what is new” note', 'release-notes': 'Release notes for a version', 'doc-update': 'An update to your docs', 'demo-script': 'A script for a demo video',
};

// The home of the studio: what needs you, one thing at a time.
export function InboxView({ pid, team, view, reload, go, open }: { pid: string; team: TeamView; view: ContentView; reload: () => Promise<void>; go: (v: View) => void; open: (id: string) => void }) {
  const [brief, setBrief] = useState('');
  const [asking, setAsking] = useState(false);
  const { busy, error, run } = useAction(reload);
  const ideas = view.items.filter(i => i.status === 'idea');
  const toReview = view.items.filter(i => i.status === 'drafted');
  const working = Boolean(team.working);
  const steps = [
    { done: Boolean(view.profile.audience || view.profile.directives || view.profile.niche), label: 'Tell the team about your project', page: 'orders' as View, cta: 'Add orders & voice' },
    { done: team.accountPosts > 0, label: 'Give it your account', page: 'account' as View, cta: 'Add your posts' },
    { done: Boolean(team.audit), label: 'Ask the team for ideas', page: 'inbox' as View, cta: '' },
  ];
  const starting = !team.audit && ideas.length === 0;
  const todo = ideas.length + toReview.length;
  const ask = () => run('run', async () => { await teamApi.run(pid, ['scout', 'analyst', 'strategist'], brief.trim()); setBrief(''); setAsking(false); });

  return (
    <div className="stack">
      <div className="today">
        <div><b>{todo === 0 ? 'You are all caught up' : `${todo} thing${todo > 1 ? 's' : ''} for you`}</b>
          <span className="hint small">{ideas.length > 0 && `${ideas.length} idea${ideas.length > 1 ? 's' : ''} to answer`}{ideas.length > 0 && toReview.length > 0 && ' · '}{toReview.length > 0 && `${toReview.length} draft${toReview.length > 1 ? 's' : ''} to read`}</span></div>
        <button disabled={working} onClick={() => setAsking(!asking)}>{working ? 'The team is working…' : asking ? 'Close' : '+ Ask for new ideas'}</button>
      </div>

      {asking && !working && (
        <section className="card brief-card">
          <label>What should the team think about? <span className="opt">optional</span>
            <div className="briefbar">
              <input autoFocus value={brief} onChange={e => setBrief(e.target.value)} placeholder="e.g. Get people excited about the beta. Or leave empty and let them decide." onKeyDown={e => e.key === 'Enter' && ask()} />
              <button className="primary" disabled={busy !== ''} onClick={ask}>Go</button>
            </div>
          </label>
          <div className="chips">{['Prepare the next release', 'More like what works for us', 'Refresh the field research'].map(q => <button key={q} className="chip" onClick={() => setBrief(q)}>{q}</button>)}</div>
          {error && <p className="error">{error}</p>}
        </section>
      )}

      {starting && (
        <section className="card guide">
          <h3>Welcome. Three steps, then the team works for you.</h3>
          <ol className="steps big">{steps.map((s, i) => (
            <li key={s.label} className={s.done ? 'done' : ''}><span className="tick">{s.done ? '✓' : i + 1}</span><span>{s.label}</span>
              {!s.done && (s.cta ? <button className="linkish" onClick={() => go(s.page)}>{s.cta} →</button> : <button className="primary" disabled={working} onClick={() => setAsking(true)}>Ask now</button>)}</li>
          ))}</ol>
        </section>
      )}

      {ideas.length > 0 && <IdeaDeck key={ideas[0].id} ideas={ideas} milestones={view.milestones} reload={reload} />}

      {toReview.length > 0 && (
        <section className="card">
          <div className="head"><h3>Drafts ready for you to read <span className="count">{toReview.length}</span></h3></div>
          <ul className="rows">{toReview.map(i => (
            <li key={i.id}><button onClick={() => open(i.id)}><span className="rowmain"><KindChip kind={i.kind} /> <b>{i.title}</b></span><span className="hint small">{fmt(i.date)} · Open →</span></button></li>
          ))}</ul>
        </section>
      )}

      {team.synthesis && (
        <button className="note-line" onClick={() => go('agent:director')}><b>Director:</b> {team.synthesis.data.headline} <span>Ask the Director →</span></button>
      )}

      {!starting && todo === 0 && (
        <section className="card empty"><h3>Nothing needs you</h3><p>Ask the team for new ideas, or look at the <button className="linkish" onClick={() => go('calendar')}>calendar</button>.</p></section>
      )}
    </div>
  );
}

// One idea at a time, large, with three clear answers.
function IdeaDeck({ ideas, milestones, reload }: { ideas: ContentItem[]; milestones: ContentView['milestones']; reload: () => Promise<void> }) {
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
        <div className="top"><KindChip kind={item.kind} /><span className="hint small">{WHAT[item.kind] ?? ''}</span></div>
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
