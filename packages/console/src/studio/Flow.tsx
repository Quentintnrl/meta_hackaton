import { useState } from 'react';
import { contentApi, teamApi, type AgentId, type ContentItem, type ContentView, type ItemStatus, type TeamView } from '../api';
import { KIND_HUE, KindChip, ago, fmt, useAction } from './shared';
import { Brief } from './NextView';
import { Checkpoints } from './Chain';
import type { View } from './Studio';

type Props = { pid: string; team: TeamView; view: ContentView; reload: () => Promise<void>; go: (v: View) => void; open: (id: string) => void; askAgent: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void; since?: string };

// The thread a post follows, left to right. Each stage says who acts there and what it waits for.
const STAGES: Array<{ status: ItemStatus; title: string; who: string; empty: string }> = [
  { status: 'idea', title: 'Proposed', who: 'The Strategist proposes, you decide', empty: 'Nothing proposed. Brief the team above, or wait for its next pass.' },
  { status: 'briefed', title: 'Being written', who: 'The Writer drafts it', empty: 'Nothing in writing. Say yes to a proposal and it moves here.' },
  { status: 'drafted', title: 'To review', who: 'You read, change, approve', empty: 'No draft waits for you.' },
  { status: 'approved', title: 'Ready to post', who: 'You copy it and post it', empty: 'Nothing approved yet.' },
  { status: 'published', title: 'Posted', who: 'Done, counted on Platforms', empty: 'Nothing posted from here yet.' },
];

const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const byDate = (a: ContentItem, b: ContentItem) => (a.fixedDate ?? a.date ?? '9999').localeCompare(b.fixedDate ?? b.date ?? '9999');

export function FlowBoard({ pid, team, view, reload, open, askAgent, since = '' }: Props) {
  const note = team.synthesis;
  const { busy, run } = useAction(reload);
  const fresh = view.items.filter(i => i.status === 'idea' && i.createdAt > since).length;
  const lanes = STAGES.map(s => ({ ...s, items: view.items.filter(i => i.status === s.status).sort(s.status === 'published' ? (a, b) => byDate(b, a) : byDate) }));
  const refused = view.items.filter(i => i.status === 'rejected');
  const writing = team.working?.agent === 'writer';
  return (
    <div className="stack">
      <Brief pid={pid} team={team} reload={reload} />
      {note && <p className="note-line"><b>Director, {ago(note.at)}:</b> {note.data.headline}{fresh > 0 && <span className="since">{fresh} new proposal{fresh > 1 ? 's' : ''} since your last visit</span>} <button className="linkish tight" onClick={() => askAgent('director')}>Ask →</button></p>}

      <ol className="thread" aria-label="The thread of a post">
        {lanes.map((lane, n) => (
          <li key={lane.status} className={`stage ${lane.status}${lane.items.length ? '' : ' bare'}`}>
            <header className="stage-head">
              <div className="stage-title"><i>{n + 1}</i><h3>{lane.title}</h3>{lane.items.length > 0 && <span className="count">{lane.items.length}</span>}</div>
              <p className="hint small">{lane.who}{lane.status === 'briefed' && writing ? ' · writing now' : ''}</p>
            </header>
            <div className="stage-body">
              {lane.items.length === 0 && <p className="stage-empty">{lane.empty}</p>}
              {lane.items.map(i => <ThreadCard key={i.id} item={i} view={view} reload={reload} open={open} askAgent={askAgent} writing={writing} fresh={i.status === 'idea' && i.createdAt > since} />)}
              {lane.status === 'idea' && refused.length > 0 && (
                <details className="refused"><summary className="hint small">Refused ({refused.length})</summary>
                  <ul>{refused.map(i => <li key={i.id}><span>{cap(i.title, 60)}{i.rejectedReason && <span className="hint small"> — {i.rejectedReason}</span>}</span><button className="linkish tight" disabled={busy !== ''} title="Back to the proposals, the refusal kept in its chain" onClick={() => run('back:' + i.id, () => teamApi.restore(i.id))}>{busy === 'back:' + i.id ? '…' : 'Take it back ↶'}</button></li>)}</ul>
                </details>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// One piece on the thread: what it is, its first line, and the one thing it waits for here.
function ThreadCard({ item, view, reload, open, askAgent, writing, fresh }: { item: ContentItem; view: ContentView; reload: () => Promise<void>; open: (id: string) => void; askAgent: Props['askAgent']; writing: boolean; fresh: boolean }) {
  const { busy, error, run } = useAction(reload);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState('');
  const [copied, setCopied] = useState(false);
  const [why, evidence] = item.rationale.split('\nEvidence: ');
  const ms = view.milestones.find(m => m.id === item.milestoneId);
  const date = item.fixedDate ?? item.date;
  const hook = item.pitch?.hook || (item.draft ? item.draft.split('\n')[0] : '');
  const first = item.media?.slides.find(s => s.file);
  const pictures = item.media?.slides.filter(s => s.file).length ?? 0;
  const copy = () => run('copy', async () => { const pack = await contentApi.exportPack(item.id); await navigator.clipboard.writeText(pack.copyText); setCopied(true); setTimeout(() => setCopied(false), 2000); });
  const refuse = () => run('no', () => teamApi.reject(item.id, reason));
  return (
    <article className={`tcard ${item.status}`} style={{ ['--h' as string]: KIND_HUE[item.kind] }} role="button" tabIndex={0} aria-label={`Open ${item.title}`}
      onClick={() => open(item.id)} onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) open(item.id); }}>
      {first && <span className="tcard-pic"><img src={contentApi.mediaUrl(item.id, first.file!)} alt="" /></span>}
      <div className="tcard-meta"><KindChip kind={item.kind} />{item.pitch?.channel && <span className="chip">{item.pitch.channel}</span>}<span className="hint small">{fmt(date)}</span>{fresh && <span className="fresh" title="Arrived since your last visit">new</span>}</div>
      <b className="tcard-title">{item.title}</b>
      {hook && <p className="tcard-hook">“{cap(hook, 140)}”</p>}
      <Checkpoints item={item} />
      {item.status === 'drafted' && item.draft && <span className="hint small">{item.draft.split(/\s+/).length} words{pictures ? `, ${pictures} picture${pictures > 1 ? 's' : ''}` : ''} · open to read</span>}
      {item.status === 'approved' && pictures > 0 && !first && <span className="hint small">{pictures} picture(s) ready</span>}
      {item.status === 'published' && <AfterPosting item={item} reload={reload} />}

      {refusing ? (
        <div className="refuse" onClick={e => e.stopPropagation()}>
          <input autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="Why not? The team remembers it." onKeyDown={e => e.key === 'Enter' && refuse()} />
          <div className="row nomargin"><button disabled={busy !== ''} onClick={refuse}>Refuse</button><button className="linkish" onClick={() => setRefusing(false)}>Cancel</button></div>
        </div>
      ) : (
        <div className="tcard-actions" onClick={e => e.stopPropagation()}>
          {item.status === 'idea' && <>
            <button className="primary" disabled={busy !== ''} onClick={() => run('yes', async () => { await teamApi.accept(item.id); await contentApi.draft(item.id); })}>{busy === 'yes' ? 'Writing…' : 'Yes, write it'}</button>
            <button disabled={busy !== ''} onClick={() => setRefusing(true)}>No</button>
            <button className="linkish" disabled={busy !== ''} onClick={() => run('keep', () => teamApi.accept(item.id))}>Later</button>
            <button className="linkish" onClick={() => askAgent('strategist', 'item', item.id)}>Ask why</button>
          </>}
          {item.status === 'briefed' && <>
            <button className="primary" disabled={busy !== '' || writing} onClick={() => run('draft', () => contentApi.draft(item.id))}>{busy === 'draft' || writing ? 'Writing…' : 'Write it now'}</button>
          </>}
          {item.status === 'drafted' && <>
            <button className="primary" disabled={busy !== ''} onClick={() => run('ok', () => contentApi.approve(item.id))}>{busy === 'ok' ? '…' : 'Approve as is'}</button>
            <button className="linkish" onClick={() => askAgent('writer', 'item', item.id)}>Ask the Writer</button>
          </>}
          {item.status === 'approved' && <>
            <button className="primary" disabled={busy !== ''} onClick={copy}>{copied ? 'Copied' : 'Copy the post'}</button>
            <button disabled={busy !== ''} onClick={() => run('posted', () => contentApi.publish(item.id))}>Mark as posted</button>
          </>}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </article>
  );
}

// A week after: what the pitch said we would count, against what the real post got. When the real post is not
// tied yet, the one that looks like it is offered; the manager confirms, nothing is linked on a guess.
function AfterPosting({ item, reload }: { item: ContentItem; reload: () => Promise<void> }) {
  const { busy, error, run } = useAction(reload);
  const o = item.outcome, m = item.match;
  const date = item.fixedDate ?? item.date;
  if (o) {
    const li = o.platform.toLowerCase().includes('linkedin');
    const soon = o.daysSince < 7;
    return (
      <div className="after" onClick={e => e.stopPropagation()}>
        <b>{soon ? `${o.daysSince} day${o.daysSince === 1 ? '' : 's'} after` : 'A week after'}</b>
        <div className="after-nums"><span><b>{o.likes}</b>{li ? 'reactions' : 'likes'}</span><span><b>{o.comments}</b>comments</span><span><b>{o.shares}</b>{li ? 'reposts' : 'shares'}</span>{o.views != null && <span><b>{o.views.toLocaleString()}</b>views</span>}{!li && o.saves > 0 && <span><b>{o.saves}</b>saves</span>}</div>
        {item.pitch?.measure && <p className="hint small">We said we would count: {item.pitch.measure}{soon ? ' · too early to judge' : ''}</p>}
      </div>
    );
  }
  if (m) {
    return (
      <div className="after match" onClick={e => e.stopPropagation()}>
        <b>Is this it on {m.platform}?</b>
        <p className="hint small">“{cap(m.text, 90)}” · {fmt(m.postedAt)}, {m.why}</p>
        <button className="tight" disabled={busy !== ''} onClick={() => run('match', () => teamApi.confirmMatch(item.id, m.postId))}>{busy === 'match' ? '…' : 'Yes, tie them'}</button>
        {error && <span className="error">{error}</span>}
      </div>
    );
  }
  return <span className="hint small">Posted {fmt(date)} · not found in the account yet: read the platform again once it is up</span>;
}
