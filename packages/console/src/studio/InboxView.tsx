import { useState } from 'react';
import { contentApi, teamApi, type ContentItem, type ContentView, type TeamView } from '../api';
import { KindChip, SOURCE, fmt, useAction } from './shared';
import type { View } from './Studio';

// The home of the studio: only what needs the manager. Everything else lives in its own page.
export function InboxView({ pid, team, view, reload, go, open }: { pid: string; team: TeamView; view: ContentView; reload: () => Promise<void>; go: (v: View) => void; open: (id: string) => void }) {
  const [brief, setBrief] = useState('');
  const { busy, error, run } = useAction(reload);
  const proposals = view.items.filter(i => i.status === 'idea');
  const toReview = view.items.filter(i => i.status === 'drafted');
  const working = Boolean(team.working);
  const steps = [
    { done: Boolean(view.profile.audience || view.profile.directives || view.profile.niche), label: 'Tell the team about your project', page: 'orders' as View, cta: 'Add orders & voice' },
    { done: team.accountPosts > 0, label: 'Give it your account', page: 'account' as View, cta: 'Add your posts' },
    { done: Boolean(team.audit), label: 'Brief the team', page: 'inbox' as View, cta: 'Use the box above' },
  ];
  const starting = !team.audit && proposals.length === 0;

  return (
    <div className="stack">
      <section className="card brief-card">
        <label>What should the team work on?
          <div className="briefbar">
            <input value={brief} onChange={e => setBrief(e.target.value)} placeholder="e.g. Get people excited about the beta. Or leave empty and let them decide." onKeyDown={e => e.key === 'Enter' && !working && run('run', () => teamApi.run(pid, ['scout', 'analyst', 'strategist'], brief.trim()))} />
            <button className="primary" disabled={working || busy !== ''} onClick={() => run('run', () => teamApi.run(pid, ['scout', 'analyst', 'strategist'], brief.trim()))}>{working ? 'Working…' : 'Brief the team'}</button>
          </div>
        </label>
        <div className="chips">{['Prepare the next release', 'More like what works for us', 'Refresh the field research'].map(q => <button key={q} className="chip" onClick={() => setBrief(q)}>{q}</button>)}</div>
        {error && <p className="error">{error}</p>}
      </section>

      {starting && (
        <section className="card">
          <h3>Getting started</h3>
          <ol className="steps">{steps.map((s, i) => (
            <li key={s.label} className={s.done ? 'done' : ''}><span className="tick">{s.done ? '✓' : i + 1}</span><span>{s.label}</span>{!s.done && s.page !== 'inbox' && <button className="linkish" onClick={() => go(s.page)}>{s.cta}</button>}</li>
          ))}</ol>
        </section>
      )}

      {proposals.length > 0 && (
        <section>
          <div className="head"><h3>Proposals <span className="count">{proposals.length}</span></h3><span className="hint small">Accept what you like. Refuse with a reason: the team remembers.</span></div>
          <div className="proposals">{proposals.map(p => <Proposal key={p.id} item={p} reload={reload} milestone={view.milestones.find(m => m.id === p.milestoneId)?.title} />)}</div>
        </section>
      )}

      {toReview.length > 0 && (
        <section className="card">
          <div className="head"><h3>Drafts to review <span className="count">{toReview.length}</span></h3></div>
          <ul className="rows">{toReview.map(i => (
            <li key={i.id}><button onClick={() => open(i.id)}><span className="rowmain"><KindChip kind={i.kind} /> <b>{i.title}</b></span><span className="hint small">{fmt(i.date)} · Review →</span></button></li>
          ))}</ul>
        </section>
      )}

      {!starting && proposals.length === 0 && toReview.length === 0 && (
        <section className="card empty"><h3>All caught up</h3><p>Nothing needs you right now. Brief the team for new ideas, or look at the <button className="linkish" onClick={() => go('calendar')}>calendar</button>.</p></section>
      )}
    </div>
  );
}

function Proposal({ item, reload, milestone }: { item: ContentItem; reload: () => Promise<void>; milestone?: string }) {
  const [refusing, setRefusing] = useState(false);
  const [more, setMore] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction(reload);
  const src = item.source ? SOURCE[item.source] : undefined;
  return (
    <article className="proposal">
      <div className="top"><KindChip kind={item.kind} />{src && <span className={`src ${item.source}`} title={src.hint}>{src.label}</span>}<span className="when">{fmt(item.fixedDate ?? item.date)}{milestone ? ` · ${milestone}` : ''}</span></div>
      <h4>{item.title}</h4>
      {item.rationale && <p className={`why ${more ? 'open' : ''}`}><b>Why</b> {item.rationale}</p>}
      {more && <p className="small">{item.brief}</p>}
      {refusing ? (
        <div className="refuse">
          <input autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="Why not? The team will remember." onKeyDown={e => e.key === 'Enter' && run('no', () => teamApi.reject(item.id, reason))} />
          <button disabled={busy !== ''} onClick={() => run('no', () => teamApi.reject(item.id, reason))}>Refuse</button>
          <button className="linkish" onClick={() => setRefusing(false)}>Cancel</button>
        </div>
      ) : (
        <div className="row">
          <button className="primary" disabled={busy !== ''} onClick={() => run('yes+', async () => { await teamApi.accept(item.id); await contentApi.draft(item.id); })}>{busy === 'yes+' ? 'Writing…' : 'Accept & write'}</button>
          <button disabled={busy !== ''} onClick={() => run('yes', () => teamApi.accept(item.id))}>Accept</button>
          <button className="linkish" onClick={() => setRefusing(true)}>Refuse</button>
          <button className="linkish" onClick={() => setMore(!more)}>{more ? 'Less' : 'More'}</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </article>
  );
}
