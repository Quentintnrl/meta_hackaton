import { useEffect, useState } from 'react';
import { contentApi, teamApi, type AccountPost, type AgentId, type ContentItem, type ContentView, type Find, type TeamView } from '../api';
import { KIND_HUE, KindChip, ago, fmt, useAction } from './shared';
import { hue } from './Numbers';
import { Brief, Piece } from './NextView';
import type { View } from './Studio';

type Common = { pid: string; team: TeamView; view: ContentView; reload: () => Promise<void>; go: (v: View) => void; open: (id: string) => void; askAgent: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void };

const fmtY = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const PLATFORM_HUE: Record<string, number> = { instagram: 330, linkedin: 210, facebook: 225, tiktok: 180, x: 0, youtube: 0, newsletter: 45, email: 45, blog: 150, website: 150, press: 270 };
const platformKey = (s: string) => Object.keys(PLATFORM_HUE).find(k => s.toLowerCase().includes(k)) ?? s.toLowerCase().trim();
const pHue = (s: string) => PLATFORM_HUE[platformKey(s)] ?? hue(s);
const Pill = ({ name }: { name: string }) => <span className="pill" style={{ ['--h' as string]: pHue(name) }}>{name}</span>;

// The team on duty, in one line: what it did last, and when it comes back.
export function DutyLine({ team, go }: { team: TeamView; go: (v: View) => void }) {
  const w = team.working;
  const last = team.duty.lastPass;
  const next = last ? Math.max(0, 24 - (Date.now() - Date.parse(last)) / 3_600_000) : 0;
  return (
    <p className="duty">
      <span className={`dot ${w ? 'on' : team.duty.autopilot ? 'idle' : 'off'}`} />
      {w ? <>{team.agents.find(a => a.id === w.agent)?.name ?? w.agent} is working, since {ago(w.since)}.</>
        : team.duty.autopilot ? <>Team on duty. Last pass {last ? ago(last) : 'never'}, next in about {next < 1 ? 'an hour' : `${Math.round(next)} h`}.</>
        : <>Team off duty: it only works when you ask. <button className="linkish tight" onClick={() => go('settings')}>Put it on duty →</button></>}
    </p>
  );
}

// --- Create: proposals to judge, then the pipeline as pictures
export function CreateBoard(p: Common) {
  const { view, team, reload, open, askAgent } = p;
  const ideas = view.items.filter(i => i.status === 'idea');
  const col = (s: string[]) => view.items.filter(i => s.includes(i.status)).sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
  const note = team.synthesis;
  return (
    <div className="stack">
      <Brief pid={p.pid} team={team} reload={reload} />
      {note && <p className="note-line"><b>Director, {ago(note.at)}:</b> {note.data.headline} <button className="linkish tight" onClick={() => askAgent('director')}>Ask →</button></p>}
      <section className="card">
        <div className="head"><h3>Proposed for you {ideas.length > 0 && <span className="count">{ideas.length}</span>}</h3><span className="hint small">Yes sends it to the Writer. No teaches the team.</span></div>
        {ideas.length === 0 ? <p className="hint">Nothing waits for you. Say what you want above, or wait for the next pass.</p>
          : <div className="idea-grid">{ideas.map(i => <Piece key={i.id} item={i} view={view} reload={reload} open={open} askAgent={askAgent} />)}</div>}
      </section>
      <section className="card">
        <div className="head"><h3>In the making</h3><span className="hint small">Click a piece to read, edit, add pictures or a video.</span></div>
        <div className="pipeline">
          {([['Being written', col(['briefed', 'drafted'])], ['Ready to post', col(['approved'])], ['Posted', col(['published']).slice(-6).reverse()]] as Array<[string, ContentItem[]]>).map(([title, items]) => (
            <div key={title} className="lane">
              <h4>{title} <span className="hint small">{items.length}</span></h4>
              {items.length === 0 && <p className="hint small">Nothing here.</p>}
              {items.map(i => <Tile key={i.id} item={i} onOpen={() => open(i.id)} />)}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Tile({ item, onOpen }: { item: ContentItem; onOpen: () => void }) {
  const first = item.media?.slides.find(s => s.file);
  const line = item.pitch?.hook || item.draft.split('\n')[0] || item.title;
  return (
    <button className="tile" onClick={onOpen} style={{ ['--h' as string]: KIND_HUE[item.kind] }}>
      {first ? <img src={contentApi.mediaUrl(item.id, first.file!)} alt="" /> : <span className="tile-text">{cap(line, 90)}</span>}
      <span className="tile-foot"><KindChip kind={item.kind} />{item.pitch?.channel && <Pill name={platformKey(item.pitch.channel)} />}<span className="hint small">{item.status === 'drafted' ? 'to review' : item.status === 'briefed' ? 'waiting for the Writer' : fmt(item.fixedDate ?? item.date)}</span></span>
      <b>{cap(item.title, 70)}</b>
    </button>
  );
}

// --- Platforms: one card per place you publish, with its real rhythm, and where to feed it
export function PlatformsBoard({ pid, team, view, reload }: Common) {
  const [posts, setPosts] = useState<AccountPost[]>([]);
  useEffect(() => { contentApi.accountPosts(pid).then(setPosts).catch(() => setPosts([])); }, [pid, team.accountPosts]);
  const names = [...new Set(['instagram', 'linkedin', ...posts.map(p => platformKey(p.platform ?? 'instagram')), ...team.snapshots.map(s => platformKey(s.platform))])];
  return (
    <div className="stack">
      <p className="hint">What each platform gets, when, and how it is going. Pieces leave the studio {view.profile.publishMode === 'connected' ? 'through your Meta app' : view.profile.publishMode === 'assisted' ? 'by hand, via your scheduler' : 'by hand: copy, post, mark posted'}.</p>
      <div className="platforms">{names.map(n => <PlatformCard key={n} pid={pid} name={n} posts={posts.filter(p => platformKey(p.platform ?? 'instagram') === n)} snaps={team.snapshots.filter(s => platformKey(s.platform) === n)} planned={view.items.filter(i => i.status !== 'published' && i.status !== 'rejected' && i.pitch?.channel && platformKey(i.pitch.channel) === n || (i.pitch?.channel ?? '').toLowerCase().includes(n))} reload={reload} />)}</div>
    </div>
  );
}

function PlatformCard({ pid, name, posts, snaps, planned, reload }: { pid: string; name: string; posts: AccountPost[]; snaps: TeamView['snapshots']; planned: ContentItem[]; reload: () => Promise<void> }) {
  const { busy, error, run } = useAction(reload);
  const [paste, setPaste] = useState('');
  const [followers, setFollowers] = useState('');
  const last = snaps.at(-1), prev = snaps.at(-2);
  const sorted = [...posts].sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  const newest = sorted.at(-1);
  const weeks = 16;
  const now = Date.now();
  const perWeek = Array.from({ length: weeks }, (_, k) => posts.filter(p => { const d = (now - Date.parse(p.postedAt)) / (7 * 86_400_000); return d >= weeks - 1 - k && d < weeks - k; }).length);
  const months = sorted.length > 1 ? Math.max(1, (Date.parse(sorted.at(-1)!.postedAt) - Date.parse(sorted[0].postedAt)) / (30.4 * 86_400_000)) : 1;
  return (
    <section className="card platform" style={{ ['--h' as string]: pHue(name) }}>
      <div className="phead"><span className="plogo">{name[0].toUpperCase()}</span><div><h3>{name[0].toUpperCase() + name.slice(1)}</h3><span className="hint small">{posts.length ? `${posts.length} posts loaded · last one ${newest ? ago(newest.postedAt + 'T12:00:00Z') : ''}` : 'no posts loaded yet'}</span></div></div>
      <div className="pstats">
        <div><b>{last ? last.followers.toLocaleString() : '–'}</b><span className="hint small">followers{last ? ` on ${fmt(last.at.slice(0, 10))}` : ''}{prev && last ? ` · ${last.followers - prev.followers >= 0 ? '+' : ''}${last.followers - prev.followers} since ${fmt(prev.at.slice(0, 10))}` : ''}</span></div>
        <div><b>{posts.length ? (posts.length / months).toFixed(1) : '–'}</b><span className="hint small">posts a month</span></div>
        <div><b>{posts.length ? Math.round(posts.reduce((a, p) => a + p.likes, 0) / posts.length) : '–'}</b><span className="hint small">likes per post</span></div>
      </div>
      <div className="weeks" title="One box per week, the last 16 weeks: filled when something was posted">{perWeek.map((n, k) => <span key={k} className={n ? 'wk on' : 'wk'} title={n ? `${n} post${n > 1 ? 's' : ''}` : 'nothing'} />)}<span className="hint small">last 16 weeks</span></div>
      <div className="pnext"><b>Planned here</b>{planned.length === 0 ? <span className="hint small"> nothing yet</span> : <ul>{planned.slice(0, 4).map(i => <li key={i.id}>{fmt(i.fixedDate ?? i.date)} · {cap(i.title, 48)} <span className="hint small">{i.status}</span></li>)}</ul>}</div>
      <details className="feed"><summary className="hint small">Update {name}: paste posts, or just the follower count</summary>
        <textarea rows={3} value={paste} onChange={e => setPaste(e.target.value)} placeholder={`Paste the posts from ${name} with their numbers (free text, or a CSV with a text,likes header). Leave empty to only record followers.`} />
        <div className="row"><input type="number" min={0} value={followers} onChange={e => setFollowers(e.target.value)} placeholder="followers today" style={{ width: 150 }} />
          <button className="primary" disabled={busy !== '' || (!paste.trim() && !followers)} onClick={() => run('save', async () => { await teamApi.setAccount(pid, { platform: name, paste: paste.trim() || undefined, followers: followers ? Number(followers) : undefined }); setPaste(''); setFollowers(''); })}>{busy ? 'Saving…' : 'Save'}</button></div>
        {error && <p className="error">{error}</p>}
      </details>
    </section>
  );
}

// --- Community: who follows, what they did, and the silence, drawn rather than listed
export function CommunityBoard({ pid, team, reload, askAgent }: Common) {
  const [posts, setPosts] = useState<AccountPost[] | null>(null);
  useEffect(() => { contentApi.accountPosts(pid).then(setPosts).catch(() => setPosts([])); }, [pid, team.accountPosts]);
  const { busy, error, run } = useAction(reload);
  if (!posts) return null;
  const snaps = team.snapshots;
  const last = snaps.at(-1);
  const sorted = [...posts].sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  const comments = posts.reduce((a, p) => a + p.comments, 0);
  const top = [...posts].sort((a, b) => b.likes - a.likes).slice(0, 3);
  const asked = [...sorted].reverse().find(p => p.text.includes('?'));
  const report = team.account;
  return (
    <div className="stack">
      <div className="two uneven">
        <section className="card">
          <div className="head"><h3>Reactions, post by post</h3><span className="hint small">likes per post, oldest to newest</span></div>
          {posts.length ? <Bars posts={sorted} /> : <p className="hint">No posts loaded. Feed a platform first.</p>}
        </section>
        <section className="card hero-stat">
          <span className="hint small">Followers</span>
          <b className="big">{last ? last.followers.toLocaleString() : '–'}</b>
          <span className="hint small">{last ? `${last.platform}, ${fmtY(last.at)}` : 'not recorded yet: add a count on the Platforms page'}</span>
          {snaps.length > 1 && <Spark points={snaps.map(s => s.followers)} />}
          {snaps.length === 1 && <span className="hint small">One reading. The team records a new one each time you update a platform: two make a trend.</span>}
        </section>
      </div>
      <div className="two">
        <section className="card">
          <div className="head"><h3>Conversations</h3></div>
          {comments === 0 ? <>
            <p className="plain-truth">No one has commented on any of your {posts.length} posts. {asked ? <>The last time you asked a question, {fmt(asked.postedAt)}: “{cap(asked.text, 90)}”. Nobody answered.</> : 'None of your posts asks a question.'}</p>
            <p className="hint small">The job now is to get the first reply, not more likes.</p>
            <button className="primary" disabled={busy !== '' || Boolean(team.working)} onClick={() => run('q', () => teamApi.run(pid, ['strategist'], 'One post that asks the audience a single real question they will answer in the comments, about their own daily work; the measure is the number of replies.'))}>{busy ? 'Asking…' : 'Propose a post that gets replies'}</button>
            {error && <p className="error">{error}</p>}
          </> : <p>{comments} comments across {posts.length} posts.</p>}
        </section>
        <section className="card">
          <div className="head"><h3>What drew people</h3></div>
          <ol className="top-posts">{top.map((p, n) => <li key={n}><b>{p.likes}</b><span>{cap(p.text, 120)}<span className="hint small"> · {fmtY(p.postedAt)}</span></span></li>)}</ol>
        </section>
      </div>
      {report && <section className="card"><div className="head"><h3>The Analyst's reading</h3><span className="hint small">{ago(report.at)} · <button className="linkish tight" onClick={() => askAgent('analyst')}>ask →</button></span></div><p>{report.data.summary}</p><ul className="gaps">{report.data.gaps.slice(0, 3).map((g, n) => <li key={n}>{g}</li>)}</ul></section>}
    </div>
  );
}

// Likes per post over time: one series, one hue, thin bars anchored to the baseline, a title on each for hover.
function Bars({ posts }: { posts: AccountPost[] }) {
  const w = 600, h = 150, pad = 24;
  const t0 = Date.parse(posts[0].postedAt), t1 = Math.max(Date.parse(posts.at(-1)!.postedAt), t0 + 1);
  const max = Math.max(1, ...posts.map(p => p.likes));
  const x = (iso: string) => pad + ((Date.parse(iso) - t0) / (t1 - t0)) * (w - 2 * pad);
  const months: string[] = [];
  for (let d = new Date(t0); d.getTime() <= t1; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 10));
  return (
    <svg className="bars-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Likes per post over time">
      <line x1={pad} x2={w - pad} y1={h - 20} y2={h - 20} className="axis" />
      {[max, Math.round(max / 2)].map(v => <g key={v}><line x1={pad} x2={w - pad} y1={h - 20 - (v / max) * (h - 40)} y2={h - 20 - (v / max) * (h - 40)} className="grid" /><text x={pad - 4} y={h - 20 - (v / max) * (h - 40) + 4} className="tick" textAnchor="end">{v}</text></g>)}
      {months.filter((_, i) => i % 2 === 0).map(m => <text key={m} x={x(m)} y={h - 6} className="tick" textAnchor="middle">{new Date(m + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' })}</text>)}
      {posts.map((p, i) => { const bh = (p.likes / max) * (h - 40); return <rect key={i} x={x(p.postedAt) - 3} y={h - 20 - bh} width={6} height={bh} rx={3} className="bar"><title>{`${fmtY(p.postedAt)}: ${p.likes} likes${p.comments ? `, ${p.comments} comments` : ''} — ${cap(p.text, 80)}`}</title></rect>; })}
    </svg>
  );
}

function Spark({ points }: { points: number[] }) {
  const w = 160, h = 36, min = Math.min(...points), max = Math.max(...points);
  const d = points.map((v, i) => `${(i / (points.length - 1)) * w},${h - 4 - ((v - min) / Math.max(1, max - min)) * (h - 8)}`).join(' ');
  return <svg className="spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Followers over time"><polyline points={d} /></svg>;
}

// --- Competitors: what comparable players actually post, with the picture and the link, and the dates ahead
export function WatchBoard({ pid, team, reload, go }: Common) {
  const { busy, error, run } = useAction(reload);
  const w = team.watch;
  const again = <button className="primary" disabled={busy !== '' || Boolean(team.working)} onClick={() => run('watch', () => teamApi.run(pid, ['scout'], ''))}>{busy ? 'Sending…' : team.working ? 'Team busy…' : w ? 'Watch again' : 'Watch the field'}</button>;
  if (!w) return <section className="card"><h3>Nobody watched yet</h3><p className="hint">The Scout searches the web for what comparable players post, with the links, and the dates your audience gathers around. A few minutes.</p>{again}{error && <p className="error">{error}</p>}</section>;
  const d = w.data;
  return (
    <div className="stack">
      <section className="card">
        <div className="head"><h3>The market, as the Scout sees it</h3><span className="hint small">watched {ago(w.at)}</span></div>
        <p className="market">{d.market}</p>
        <div className="players">{d.players.map(p => <a key={p.name} className="player" href={p.url} target="_blank" rel="noreferrer" title={p.what}><span className="plogo small" style={{ ['--h' as string]: hue(p.name) }}>{p.name[0]}</span><span><b>{p.name}</b><span className="hint small">{cap(p.what, 70)}</span></span></a>)}</div>
        <div className="row" style={{ marginTop: 12 }}>{again}{error && <p className="error">{error}</p>}</div>
      </section>
      {d.events.length > 0 && <section className="card"><div className="head"><h3>Dates ahead</h3><span className="hint small">where your audience gathers</span></div><div className="events">{d.events.map(e => <div key={e.name} className="event"><b>{e.when}</b><span>{e.name}</span><span className="hint small">{e.why}</span></div>)}</div></section>}
      <section className="card">
        <div className="head"><h3>Seen at the neighbours</h3><span className="hint small">{d.finds.length} finds · the picture is the page's own</span></div>
        <div className="finds">{d.finds.map((f, n) => <FindCard key={n} pid={pid} f={f} reload={reload} go={go} />)}</div>
      </section>
    </div>
  );
}

function FindCard({ pid, f, reload, go }: { pid: string; f: Find; reload: () => Promise<void>; go: (v: View) => void }) {
  const [noPic, setNoPic] = useState(false);
  const [added, setAdded] = useState(false);
  const { busy, error, run } = useAction(reload);
  const take = () => run('take', async () => {
    await contentApi.addItem(pid, { kind: 'social-post', title: `Our take: ${cap(f.title, 60)}`, brief: `${f.whatItIs} Seen at ${f.account} (${f.platform}): ${f.url}. ${f.whyForYou}`, rationale: `Seen at ${f.account} on ${f.platform}: ${f.whatItIs}${f.number ? ` (${f.number})` : ''}. ${f.whyForYou}`, source: 'trend', pitch: { hook: '', channel: f.platform, measure: '' } });
    setAdded(true);
  });
  return (
    <article className="find" style={{ ['--h' as string]: pHue(f.platform) }}>
      <a className="find-pic" href={f.url} target="_blank" rel="noreferrer">{noPic ? <span className="plogo">{f.platform[0]?.toUpperCase()}</span> : <img src={teamApi.thumbUrl(pid, f.url)} alt="" loading="lazy" onError={() => setNoPic(true)} />}</a>
      <div className="find-body">
        <span className="find-meta"><Pill name={f.platform} /><span className="hint small">{cap(f.account, 36)}</span></span>
        <b>{cap(f.title, 80)}</b>
        <span className="hint small">{cap(f.whatItIs, 110)}{f.number ? <> · <b>{cap(f.number, 40)}</b></> : null}</span>
        <p className="why-you">{f.whyForYou}</p>
        <span className="row"><a className="linkish" href={f.url} target="_blank" rel="noreferrer">See it ↗</a>{added ? <button className="linkish" onClick={() => go('studio')}>Added to the pipeline →</button> : <button disabled={busy !== ''} onClick={take}>{busy ? '…' : 'Do our version'}</button>}</span>
        {error && <span className="error">{error}</span>}
      </div>
    </article>
  );
}
