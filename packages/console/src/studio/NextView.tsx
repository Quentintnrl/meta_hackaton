import { useEffect, useState } from 'react';
import { contentApi, teamApi, type AccountPost, type AgentId, type ContentItem, type ContentView, type TeamView } from '../api';
import { KindChip, ago, fmt, useAction } from './shared';
import type { View } from './Studio';

type Props = { pid: string; team: TeamView; view: ContentView; reload: () => Promise<void>; go: (v: View) => void; open: (id: string) => void; askAgent: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void };

const fmtY = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const ORDER: Record<string, number> = { idea: 0, drafted: 1, approved: 2, briefed: 3 };
const STATE: Record<string, string> = { idea: 'Proposed, waiting for you', drafted: 'Written, waiting for your review', approved: 'Approved, ready to post', briefed: 'Accepted, not written yet' };

// The one page: what to post next and why, then the facts about the account it rests on.
export function NextView({ pid, team, view, reload, go, open, askAgent }: Props) {
  const pieces = view.items.filter(i => i.status in ORDER).sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.createdAt.localeCompare(b.createdAt));
  return (
    <div className="stack">
      <Brief pid={pid} team={team} reload={reload} />
      <section className="card">
        <div className="head"><h3>What to post next {pieces.length > 0 && <span className="count">{pieces.length}</span>}</h3><button className="linkish" onClick={() => askAgent('director')}>Talk to the Director →</button></div>
        {pieces.length === 0 && <p className="hint">Nothing proposed yet. Say what you want above, or leave it empty and press Propose: the team answers in a minute or two, and nothing is written before you say yes.</p>}
        <div className="next-list">{pieces.map(i => <Piece key={i.id} item={i} view={view} reload={reload} open={open} askAgent={askAgent} />)}</div>
      </section>
      <Facts pid={pid} team={team} go={go} />
      <p className="hint small foot-links">
        <button className="linkish" onClick={() => go('settings')}>Voice, orders and how you publish →</button>
        <button className="linkish" onClick={() => go('today')}>The old pages (today, calendar, insights, team) →</button>
      </p>
    </div>
  );
}

export function Brief({ pid, team, reload }: { pid: string; team: TeamView; reload: () => Promise<void> }) {
  const [brief, setBrief] = useState('');
  const [research, setResearch] = useState(false);
  const { busy, error, run } = useAction(reload);
  const working = team.working;
  const send = () => run('send', () => teamApi.run(pid, research ? ['scout', 'analyst', 'strategist'] : ['analyst', 'strategist'], brief.trim()));
  return (
    <section className="card brief-one">
      <h3>What do you want to say, and to whom?</h3>
      <textarea rows={2} value={brief} onChange={e => setBrief(e.target.value)} placeholder="e.g. Get more beta testers before the end of the month. Or leave empty: the team starts from your account and your roadmap." onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') send(); }} />
      <div className="row brief-row">
        <button className="primary" disabled={busy !== '' || Boolean(working)} title={research ? 'Scout on the web, then Analyst and Strategist: a few minutes' : 'Analyst and Strategist: a minute or two'} onClick={send}>{working ? 'The team is working…' : busy === 'send' ? 'Sending…' : 'Propose'}</button>
        {!working && <span className="cost">{research ? 'a few minutes' : 'a minute or two'}</span>}
        <label className="hint small"><input type="checkbox" checked={research} onChange={e => setResearch(e.target.checked)} /> also refresh the field research (slower, searches the web)</label>
        {working && <span className="hint small">{team.agents.find(a => a.id === working.agent)?.name ?? working.agent} since {ago(working.since)}. Proposals appear here when it is done.</span>}
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

// One proposal, readable in ten seconds: the first line, why, where, what we will count, and what you can do.
export function Piece({ item, view, reload, open, askAgent }: { item: ContentItem; view: ContentView; reload: () => Promise<void>; open: (id: string) => void; askAgent: Props['askAgent'] }) {
  const { busy, error, run } = useAction(reload);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState('');
  const [copied, setCopied] = useState(false);
  const [why, evidence] = item.rationale.split('\nEvidence: ');
  const ms = view.milestones.find(m => m.id === item.milestoneId);
  const date = item.fixedDate ?? item.date;
  const hook = item.pitch?.hook || (item.draft ? item.draft.split('\n')[0] : '');
  const copy = () => run('copy', async () => { const pack = await contentApi.exportPack(item.id); await navigator.clipboard.writeText(pack.copyText); setCopied(true); setTimeout(() => setCopied(false), 2000); });
  return (
    <article className={`piece ${item.status}`}>
      <div className="piece-meta"><KindChip kind={item.kind} />{item.pitch?.channel && <span className="chip">{item.pitch.channel}</span>}<span className="hint small">{fmt(date)}{ms ? ` · for ${ms.title}` : ''} · {STATE[item.status]}</span></div>
      <h3 className="piece-title">{item.title}</h3>
      {hook && <p className="hook">“{hook}”</p>}
      {item.pitch?.context && <p className="piece-why"><b>The situation</b> {item.pitch.context}</p>}
      {item.pitch?.audience && <p className="piece-why"><b>For</b> {item.pitch.audience}</p>}
      {why && <p className="piece-why"><b>Why this piece</b> {why}</p>}
      {evidence && <p className="hint small">Behind it: {evidence}</p>}
      {item.pitch?.measure && <p className="piece-why"><b>We will know it worked by</b> {item.pitch.measure}</p>}
      {item.draft && item.status !== 'idea' && <blockquote className="piece-draft">{item.draft.length > 320 ? item.draft.slice(0, 320) + '…' : item.draft}{item.media?.slides.some(s => s.file) && <span className="hint small"> · {item.media.slides.filter(s => s.file).length} picture(s) ready</span>}</blockquote>}
      {refusing ? (
        <div className="refuse">
          <input autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="Why not? The team remembers it." onKeyDown={e => e.key === 'Enter' && run('no', () => teamApi.reject(item.id, reason))} />
          <button disabled={busy !== ''} onClick={() => run('no', () => teamApi.reject(item.id, reason))}>Refuse</button>
          <button className="linkish" onClick={() => setRefusing(false)}>Cancel</button>
        </div>
      ) : (
        <div className="row piece-actions">
          {item.status === 'idea' && <>
            <button className="primary" disabled={busy !== ''} onClick={() => run('yes', async () => { await teamApi.accept(item.id); await contentApi.draft(item.id); })}>{busy === 'yes' ? 'Writing…' : 'Yes, write it'}</button>
            <button disabled={busy !== ''} onClick={() => setRefusing(true)}>No</button>
            <button className="linkish" disabled={busy !== ''} onClick={() => run('keep', () => teamApi.accept(item.id))}>Keep for later</button>
            <button className="linkish" onClick={() => askAgent('strategist', 'item', item.id)}>Ask why →</button>
          </>}
          {item.status === 'briefed' && <>
            <button className="primary" disabled={busy !== ''} onClick={() => run('draft', () => contentApi.draft(item.id))}>{busy === 'draft' ? 'Writing…' : 'Write it now'}</button>
            <button className="linkish" onClick={() => open(item.id)}>Open →</button>
          </>}
          {item.status === 'drafted' && <>
            <button className="primary" onClick={() => open(item.id)}>Read and edit</button>
            <button disabled={busy !== ''} onClick={() => run('ok', () => contentApi.approve(item.id))}>{busy === 'ok' ? '…' : 'Approve as is'}</button>
            <button className="linkish" onClick={() => askAgent('writer', 'item', item.id)}>Ask the Writer →</button>
          </>}
          {item.status === 'approved' && <>
            <button className="primary" disabled={busy !== ''} onClick={copy}>{copied ? 'Copied' : 'Copy the post'}</button>
            <button disabled={busy !== ''} onClick={() => run('posted', () => contentApi.publish(item.id))}>Mark as posted</button>
            <button className="linkish" onClick={() => open(item.id)}>Open →</button>
          </>}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </article>
  );
}

// Facts computed here from the posts themselves: no model, no ranking, and a plain sentence when the numbers are too small to rank anything.
export function Facts({ pid, team, go }: { pid: string; team: TeamView; go: (v: View) => void }) {
  const [posts, setPosts] = useState<AccountPost[] | null>(null);
  useEffect(() => { contentApi.accountPosts(pid).then(setPosts).catch(() => setPosts([])); }, [pid, team.accountPosts]);
  if (!posts) return null;
  if (posts.length === 0) return (
    <section className="card"><div className="head"><h3>Your account</h3></div><p className="hint">No posts loaded yet, so the team only has your roadmap and your brief to go on. <button className="linkish tight" onClick={() => go('insights')}>Load your posts →</button></p></section>
  );
  const sorted = [...posts].sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  const first = sorted[0].postedAt, last = sorted[sorted.length - 1].postedAt;
  const months = Math.max(1, (Date.parse(last) - Date.parse(first)) / (30.4 * 86_400_000));
  const likes = posts.map(p => p.likes);
  const min = Math.min(...likes), max = Math.max(...likes);
  const comments = posts.reduce((a, p) => a + p.comments, 0);
  const known = posts.some(p => p.shares > 0 || p.saves > 0);
  const best = [...posts].sort((a, b) => b.likes - a.likes)[0];
  const recent = sorted.slice(-5);
  const avg = (xs: AccountPost[]) => Math.round(xs.reduce((a, p) => a + p.likes, 0) / xs.length);
  const sinceLast = Math.round((Date.now() - Date.parse(last)) / 86_400_000);
  const thin = max < 50 && comments < 5;
  const report = team.account;
  return (
    <section className="card facts">
      <div className="head"><h3>Your account, in facts</h3><span className="hint small">{posts.length} posts{report?.simulated ? ' · demo' : ''} · <button className="linkish tight" onClick={() => go('insights')}>update them →</button></span></div>
      <ul className="fact-list">
        <li><b>{posts.length} posts</b> between {fmtY(first)} and {fmtY(last)}: about {(posts.length / months).toFixed(1)} a month. The last one was {sinceLast} days ago.</li>
        <li><b>{min} to {max} likes</b> per post, {avg(posts)} on average; the last five average {avg(recent)}.</li>
        <li><b>{comments === 0 ? 'No comment on any post' : `${comments} comments in all`}</b>{known ? '' : '. Shares and saves are not in the data.'}</li>
        <li><b>Most liked:</b> “{best.text.length > 110 ? best.text.slice(0, 110) + '…' : best.text}” ({best.likes} likes, {fmtY(best.postedAt)}).</li>
      </ul>
      {thin && <p className="plain-truth">With these numbers, posts cannot be ranked by format: a few likes apart is noise. What can be read is the pace, the silence in the comments, and which posts drew the most people. The team is told to build on that, and on what you are shipping, not on format scores.</p>}
      {report && <p className="piece-why"><b>Analyst, {ago(report.at)}</b> {report.data.summary}</p>}
      <details className="more-posts"><summary className="hint small">All {posts.length} posts</summary>
        <ul className="post-lines">{[...sorted].reverse().map((p, n) => <li key={n}><span className="hint small">{fmt(p.postedAt)}</span><span>{p.text.length > 120 ? p.text.slice(0, 120) + '…' : p.text}</span><b>{p.likes}</b></li>)}</ul>
      </details>
    </section>
  );
}
