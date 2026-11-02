import { useEffect, useState } from 'react';
import { contentApi, teamApi, type AccountPost, type AgentId, type ContentItem, type ContentView, type Event, type Find, type Fix, type Player, type TeamView } from '../api';
import { KIND_HUE, KindChip, ago, fmt, useAction } from './shared';
import { hue } from './Numbers';
import { Brief, Piece } from './NextView';
import type { View } from './Studio';

type Common = { pid: string; team: TeamView; view: ContentView; reload: () => Promise<void>; go: (v: View) => void; open: (id: string) => void; askAgent: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void };

const fmtY = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const PLATFORM_HUE: Record<string, number> = { instagram: 330, linkedin: 210, facebook: 225, tiktok: 180, x: 0, youtube: 0, newsletter: 45, email: 45, blog: 150, website: 150, press: 270 };
export const platformKey = (s: string) => Object.keys(PLATFORM_HUE).find(k => s.toLowerCase().includes(k)) ?? s.toLowerCase().trim();
const pHue = (s: string) => PLATFORM_HUE[platformKey(s)] ?? hue(s);
const Pill = ({ name }: { name: string }) => <span className="pill" style={{ ['--h' as string]: pHue(name) }}>{name}</span>;
const title = (s: string) => s[0].toUpperCase() + s.slice(1);
// LinkedIn counts reactions and reposts; Instagram counts likes. The word on the card follows the platform.
const words = (platform: string) => platformKey(platform) === 'linkedin' ? { like: 'reactions', share: 'reposts' } : { like: 'likes', share: 'shares' };

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

// --- Create: proposals to judge, then every accepted piece with the step it is at and the one thing it needs
export function CreateBoard(p: Common) {
  const { view, team, reload, open, askAgent } = p;
  const ideas = view.items.filter(i => i.status === 'idea');
  const making = view.items.filter(i => ['briefed', 'drafted', 'approved'].includes(i.status)).sort((a, b) => (a.fixedDate ?? a.date ?? '9999').localeCompare(b.fixedDate ?? b.date ?? '9999'));
  const posted = view.items.filter(i => i.status === 'published').sort((a, b) => (b.fixedDate ?? b.date ?? '').localeCompare(a.fixedDate ?? a.date ?? '')).slice(0, 5);
  const note = team.synthesis;
  return (
    <div className="stack">
      <Brief pid={p.pid} team={team} reload={reload} />
      {note && <p className="note-line"><b>Director, {ago(note.at)}:</b> {note.data.headline} <button className="linkish tight" onClick={() => askAgent('director')}>Ask →</button></p>}
      <section className="card">
        <div className="head"><h3>Proposed for you {ideas.length > 0 && <span className="count">{ideas.length}</span>}</h3><span className="hint small">Each card says the situation it answers, who it is for, the first line, and what we will count. Yes sends it to the Writer. No teaches the team.</span></div>
        {ideas.length === 0 ? <p className="hint">Nothing waits for you. Say what you want above, or wait for the next pass.</p>
          : <div className="idea-grid">{ideas.map(i => <Piece key={i.id} item={i} view={view} reload={reload} open={open} askAgent={askAgent} />)}</div>}
      </section>
      <section className="card">
        <div className="head"><h3>In the making {making.length > 0 && <span className="count">{making.length}</span>}</h3><span className="hint small">Every piece you said yes to. Four steps from yes to posted; the lit one is where it stands, the button is what it needs now.</span></div>
        {making.length === 0 ? <p className="hint">Nothing in progress. Say yes to a proposal above and it appears here.</p>
          : <div className="making-list">{making.map(i => <Track key={i.id} item={i} reload={reload} open={open} />)}</div>}
        {posted.length > 0 && <details className="posted"><summary className="hint small">Posted lately ({posted.length})</summary>
          <ul className="post-lines">{posted.map(i => <li key={i.id}><span className="hint small">{fmt(i.fixedDate ?? i.date)}</span><button className="linkish" onClick={() => open(i.id)}>{cap(i.title, 80)}</button>{i.pitch?.channel && <Pill name={platformKey(i.pitch.channel)} />}</li>)}</ul></details>}
      </section>
    </div>
  );
}

const STEPS: Array<[string, string]> = [['briefed', 'Accepted'], ['drafted', 'Written'], ['approved', 'Approved'], ['published', 'Posted']];
const NEEDS: Record<string, string> = { briefed: 'The Writer has not written it yet.', drafted: 'A draft is ready: read it, change it, then approve.', approved: 'Ready to post: copy the text and the pictures, post it, come back and mark it posted.' };

// One accepted piece: its picture or hook, the four steps with the current one lit, and the one action it needs.
function Track({ item, reload, open }: { item: ContentItem; reload: () => Promise<void>; open: (id: string) => void }) {
  const { busy, error, run } = useAction(reload);
  const [copied, setCopied] = useState(false);
  const first = item.media?.slides.find(s => s.file);
  const at = STEPS.findIndex(([s]) => s === item.status);
  const copy = () => run('copy', async () => { const pack = await contentApi.exportPack(item.id); await navigator.clipboard.writeText(pack.copyText); setCopied(true); setTimeout(() => setCopied(false), 2000); });
  return (
    <article className="making" style={{ ['--h' as string]: KIND_HUE[item.kind] }}>
      <button className="making-pic" onClick={() => open(item.id)} title="Open the piece">{first ? <img src={contentApi.mediaUrl(item.id, first.file!)} alt="" /> : <span className="tile-text">{cap(item.pitch?.hook || item.draft.split('\n')[0] || item.title, 80)}</span>}</button>
      <div className="making-body">
        <div className="piece-meta"><KindChip kind={item.kind} />{item.pitch?.channel && <Pill name={platformKey(item.pitch.channel)} />}<span className="hint small">{fmt(item.fixedDate ?? item.date)}{item.media?.slides.some(s => s.file) ? ` · ${item.media.slides.filter(s => s.file).length} picture(s)` : ''}</span></div>
        <b className="making-title">{item.title}</b>
        <ol className="stages">{STEPS.map(([s, label], n) => <li key={s} className={n < at ? 'done' : n === at ? 'now' : ''}><i>{n < at ? '✓' : n + 1}</i>{label}</li>)}</ol>
        <p className="hint small">{NEEDS[item.status]}</p>
        <div className="row piece-actions">
          {item.status === 'briefed' && <button className="primary" disabled={busy !== ''} onClick={() => run('draft', () => contentApi.draft(item.id))}>{busy === 'draft' ? 'Writing…' : 'Write it now'}</button>}
          {item.status === 'drafted' && <><button className="primary" onClick={() => open(item.id)}>Read and edit</button><button disabled={busy !== ''} onClick={() => run('ok', () => contentApi.approve(item.id))}>{busy === 'ok' ? '…' : 'Approve as is'}</button></>}
          {item.status === 'approved' && <><button className="primary" disabled={busy !== ''} onClick={copy}>{copied ? 'Copied' : 'Copy the post'}</button><button disabled={busy !== ''} onClick={() => run('posted', () => contentApi.publish(item.id))}>Mark as posted</button></>}
          <button className="linkish" onClick={() => open(item.id)}>Open →</button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </article>
  );
}

// --- Platforms: one card per place you publish, with its real rhythm, and where to feed it
export function PlatformsBoard({ pid, team, view, reload }: Common) {
  const [posts, setPosts] = useState<AccountPost[]>([]);
  useEffect(() => { contentApi.accountPosts(pid).then(setPosts).catch(() => setPosts([])); }, [pid, team.accountPosts]);
  const names = [...new Set(['instagram', 'linkedin', ...posts.map(p => platformKey(p.platform ?? 'instagram')), ...team.snapshots.map(s => platformKey(s.platform))])];
  return (
    <div className="stack">
      <div className="platforms">{names.map(n => <PlatformCard key={n} pid={pid} name={n} connected={n === 'instagram' && team.connected?.instagram} lastRead={team.snapshots.filter(s => platformKey(s.platform) === n).at(-1)?.at} posts={posts.filter(p => platformKey(p.platform ?? 'instagram') === n)} snaps={team.snapshots.filter(s => platformKey(s.platform) === n)} planned={view.items.filter(i => i.status !== 'published' && i.status !== 'rejected' && i.pitch?.channel && platformKey(i.pitch.channel) === n || (i.pitch?.channel ?? '').toLowerCase().includes(n))} reload={reload} />)}</div>
      <p className="hint small">Pieces leave the studio {view.profile.publishMode === 'connected' ? 'through your Meta app' : view.profile.publishMode === 'assisted' ? 'by hand, via your scheduler' : 'by hand: copy the approved post, publish it, mark it posted'}.</p>
    </div>
  );
}

function PlatformCard({ pid, name, posts, snaps, planned, reload, connected, lastRead }: { pid: string; name: string; posts: AccountPost[]; snaps: TeamView['snapshots']; planned: ContentItem[]; reload: () => Promise<void>; connected?: boolean; lastRead?: string }) {
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
  const w = words(name);
  const avg = (f: (p: AccountPost) => number) => (posts.length ? Math.round(posts.reduce((a, p) => a + f(p), 0) / posts.length) : null);
  const viewsKnown = posts.some(p => p.views != null);
  const sharesKnown = posts.some(p => p.shares > 0);
  return (
    <section className="card platform" style={{ ['--h' as string]: pHue(name) }}>
      <div className="phead"><span className="plogo">{name[0].toUpperCase()}</span><div><h3>{title(name)}</h3><span className="hint small">{posts.length ? `${posts.length} posts loaded · last one ${newest ? ago(newest.postedAt + 'T12:00:00Z') : ''}` : 'no posts loaded yet'}</span></div></div>
      <div className={`pstats${viewsKnown || sharesKnown ? ' four' : ''}`}>
        <div><b>{last ? last.followers.toLocaleString() : '–'}</b><span className="hint small">followers{last ? ` on ${fmt(last.at.slice(0, 10))}` : ''}{prev && last ? ` · ${last.followers - prev.followers >= 0 ? '+' : ''}${last.followers - prev.followers} since ${fmt(prev.at.slice(0, 10))}` : ''}</span></div>
        <div><b>{posts.length ? (posts.length / months).toFixed(1) : '–'}</b><span className="hint small">posts a month</span></div>
        <div><b>{avg(p => p.likes) ?? '–'}</b><span className="hint small">{w.like} per post</span></div>
        {viewsKnown ? <div><b>{avg(p => p.views ?? 0)}</b><span className="hint small">views per post</span></div> : sharesKnown ? <div><b>{avg(p => p.shares)}</b><span className="hint small">{w.share} per post</span></div> : null}
      </div>
      <div className="weeks" title="One box per week, the last 16 weeks: filled when something was posted">{perWeek.map((n, k) => <span key={k} className={n ? 'wk on' : 'wk'} title={n ? `${n} post${n > 1 ? 's' : ''}` : 'nothing'} />)}<span className="hint small">last 16 weeks</span></div>
      {viewsKnown && newest && <p className="hint small">Best seen: {(() => { const b = [...posts].sort((a, c) => (c.views ?? 0) - (a.views ?? 0))[0]; return <>“{cap(b.text, 70)}” ({(b.views ?? 0).toLocaleString()} views, {b.likes} {w.like}, {b.shares} {w.share}, {fmt(b.postedAt)})</>; })()}</p>}
      <div className="pnext"><b>Planned here</b>{planned.length === 0 ? <span className="hint small"> nothing yet</span> : <ul>{planned.slice(0, 4).map(i => <li key={i.id}>{fmt(i.fixedDate ?? i.date)} · {cap(i.title, 48)} <span className="hint small">{i.status}</span></li>)}</ul>}</div>
      {connected ? <div className="feed connected">
        <span className="hint small">Read by the app through the Instagram API{lastRead ? `, last ${ago(lastRead)}` : ''}, and again at every pass of the team.</span>
        <button disabled={busy !== ''} onClick={() => run('sync', () => teamApi.sync(pid))}>{busy === 'sync' ? 'Reading…' : 'Read it now'}</button>
        {error && <p className="error">{error}</p>}
      </div> : <details className="feed"><summary className="hint small">Update {title(name)}: paste posts, or just the follower count</summary>
        <p className="hint small">{name === 'linkedin' ? 'From the page admin: Analytics, Content, Export. Open the file, copy the “Updates” sheet (any columns, French or English) and paste it here: read exactly, no model.'
          : name === 'instagram' ? 'Paste the posts with their numbers (free text, or a CSV with a text,likes header). To let the app read the account itself, put INSTAGRAM_USER_ID and INSTAGRAM_ACCESS_TOKEN in .env (see the README).'
          : `Paste the posts from ${title(name)} with their numbers: free text (the model structures it), or a table with a text and a likes column (read exactly).`}</p>
        <textarea rows={3} value={paste} onChange={e => setPaste(e.target.value)} placeholder="Posts, or the export sheet. Leave empty to only record followers." />
        <div className="row"><input type="number" min={0} value={followers} onChange={e => setFollowers(e.target.value)} placeholder="followers today" style={{ width: 150 }} />
          <button className="primary" disabled={busy !== '' || (!paste.trim() && !followers)} onClick={() => run('save', async () => { await teamApi.setAccount(pid, { platform: name, paste: paste.trim() || undefined, followers: followers ? Number(followers) : undefined }); setPaste(''); setFollowers(''); })}>{busy ? 'Saving…' : 'Save'}</button></div>
        {error && <p className="error">{error}</p>}
      </details>}
    </section>
  );
}

// --- Community: who follows, what they did, the silence, and what the Analyst says to do about it
export function CommunityBoard({ pid, team, reload, go, askAgent }: Common) {
  const [posts, setPosts] = useState<AccountPost[] | null>(null);
  useEffect(() => { contentApi.accountPosts(pid).then(setPosts).catch(() => setPosts([])); }, [pid, team.accountPosts]);
  const { busy, error, run } = useAction(reload);
  if (!posts) return null;
  const snaps = team.snapshots;
  const latest = [...new Set(snaps.map(s => platformKey(s.platform)))].map(p => snaps.filter(s => platformKey(s.platform) === p).at(-1)!);
  const sorted = [...posts].sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  const comments = posts.reduce((a, p) => a + p.comments, 0);
  const shares = posts.reduce((a, p) => a + p.shares, 0);
  const top = [...posts].sort((a, b) => b.likes - a.likes).slice(0, 3);
  const asked = [...sorted].reverse().find(p => p.text.includes('?'));
  const report = team.account;
  const fixes = report?.data.fixes ?? [];
  const noteFor = (p: AccountPost) => report?.data.winners?.find(w => p.text.startsWith(w.text.slice(0, 40)) || w.text.startsWith(p.text.slice(0, 40)))?.note;
  return (
    <div className="stack">
      <div className="two uneven">
        <section className="card">
          <div className="head"><h3>Reactions, post by post</h3><span className="hint small">one bar per post, oldest to newest, hover for the text</span></div>
          {posts.length ? <Bars posts={sorted} /> : <p className="hint">No posts loaded. Feed a platform first.</p>}
        </section>
        <section className="card hero-stat">
          <span className="hint small">Followers</span>
          {latest.length === 0 ? <><b className="big">–</b><span className="hint small">not recorded yet: add a count on the Platforms page</span></>
            : latest.map(s => <div key={s.platform} className="hero-row"><b className="big">{s.followers.toLocaleString()}</b><Pill name={platformKey(s.platform)} /><span className="hint small">{fmtY(s.at)}</span></div>)}
          {snaps.length > latest.length && <Spark points={snaps.filter(s => platformKey(s.platform) === platformKey(latest[0].platform)).map(s => s.followers)} />}
          {snaps.length === latest.length && latest.length > 0 && <span className="hint small">One reading per platform. Each time you update a count on Platforms, a point is added: two make a trend.</span>}
        </section>
      </div>
      <section className="card">
        <div className="head"><h3>What the numbers say, and what to do</h3><span className="hint small">{report ? <>Analyst, {ago(report.at)} · <button className="linkish tight" onClick={() => askAgent('analyst')}>ask →</button></> : 'no reading yet'}</span></div>
        <p className="plain-truth">
          {comments === 0 ? <>No one has commented on any of your {posts.length} posts{shares ? `, though ${shares} were shared on` : ''}. {asked ? <>The last question you asked, {fmt(asked.postedAt)}: “{cap(asked.text, 90)}”. Nobody answered.</> : 'None of your posts asks a question.'}</> : <>{comments} comments across {posts.length} posts.</>}
        </p>
        {report && <p className="piece-why">{report.data.summary}</p>}
        {fixes.length > 0 ? <div className="fixes">{fixes.map((f, n) => <FixCard key={n} pid={pid} f={f} reload={reload} go={go} />)}</div>
          : <p className="hint small">{report ? 'This reading has no fixes yet: ask the Analyst for a fresh one.' : 'The Analyst has not read the account yet.'} <button className="linkish tight" disabled={busy !== '' || Boolean(team.working)} onClick={() => run('a', () => teamApi.run(pid, ['analyst'], ''))}>{busy ? 'Asking…' : 'Read the account and propose fixes →'}</button></p>}
        {error && <p className="error">{error}</p>}
      </section>
      <section className="card">
        <div className="head"><h3>Your most liked posts, and why</h3><span className="hint small">the three posts that drew the most people, with the Analyst's reading of each</span></div>
        <ol className="top-posts">{top.map((p, n) => <li key={n}><b>{p.likes}</b><span>{cap(p.text, 120)}<span className="hint small"> · {platformKey(p.platform ?? 'instagram')}, {fmtY(p.postedAt)}</span>{noteFor(p) && <span className="why-note">{noteFor(p)}</span>}</span></li>)}</ol>
      </section>
    </div>
  );
}

// One problem, its fix and the first step: the manager can hand the first step to the Writer in one click.
function FixCard({ pid, f, reload, go }: { pid: string; f: Fix; reload: () => Promise<void>; go: (v: View) => void }) {
  const [added, setAdded] = useState(false);
  const { busy, error, run } = useAction(reload);
  const take = () => run('take', async () => {
    await contentApi.addItem(pid, { kind: 'social-post', title: cap(f.fix, 70), brief: f.firstStep, rationale: `${f.problem} Fix: ${f.fix}`, source: 'account', pitch: { hook: '', channel: '', measure: '', context: f.problem } });
    setAdded(true);
  });
  return (
    <article className="fix">
      <p className="fix-problem"><b>Problem</b> {f.problem}</p>
      <p><b>Fix</b> {f.fix}</p>
      <p className="hint"><b>First step</b> {f.firstStep}</p>
      <span className="row">{added ? <button className="linkish" onClick={() => go('studio')}>Handed to the Writer →</button> : <button disabled={busy !== ''} onClick={take}>{busy ? '…' : 'Have the Writer do the first step'}</button>}</span>
      {error && <span className="error">{error}</span>}
    </article>
  );
}

// Likes per post over time: thin bars anchored to the baseline, one hue per platform, a legend when there are two.
function Bars({ posts }: { posts: AccountPost[] }) {
  const w = 600, h = 150, pad = 24;
  const t0 = Date.parse(posts[0].postedAt), t1 = Math.max(Date.parse(posts.at(-1)!.postedAt), t0 + 1);
  const max = Math.max(1, ...posts.map(p => p.likes));
  const x = (iso: string) => pad + ((Date.parse(iso) - t0) / (t1 - t0)) * (w - 2 * pad);
  const months: string[] = [];
  for (let d = new Date(t0); d.getTime() <= t1; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 10));
  const platforms = [...new Set(posts.map(p => platformKey(p.platform ?? 'instagram')))];
  return (
    <>
      <svg className="bars-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Reactions per post over time">
        <line x1={pad} x2={w - pad} y1={h - 20} y2={h - 20} className="axis" />
        {[max, Math.round(max / 2)].map(v => <g key={v}><line x1={pad} x2={w - pad} y1={h - 20 - (v / max) * (h - 40)} y2={h - 20 - (v / max) * (h - 40)} className="grid" /><text x={pad - 4} y={h - 20 - (v / max) * (h - 40) + 4} className="tick" textAnchor="end">{v}</text></g>)}
        {months.filter((_, i) => i % 2 === 0).map(m => <text key={m} x={x(m)} y={h - 6} className="tick" textAnchor="middle">{new Date(m + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' })}</text>)}
        {posts.map((p, i) => { const bh = (p.likes / max) * (h - 40); const pk = platformKey(p.platform ?? 'instagram'); const ww = words(pk); return <rect key={i} x={x(p.postedAt) - 3} y={h - 20 - bh} width={6} height={bh} rx={3} className="bar" style={{ fill: `hsl(${pHue(pk)} 65% 50%)` }}><title>{`${fmtY(p.postedAt)}, ${pk}: ${p.likes} ${ww.like}${p.comments ? `, ${p.comments} comments` : ''}${p.shares ? `, ${p.shares} ${ww.share}` : ''}${p.views != null ? `, ${p.views} views` : ''} — ${cap(p.text, 80)}`}</title></rect>; })}
      </svg>
      {platforms.length > 1 && <div className="legend">{platforms.map(p => <span key={p}><i style={{ background: `hsl(${pHue(p)} 65% 50%)` }} />{title(p)}</span>)}</div>}
    </>
  );
}

function Spark({ points }: { points: number[] }) {
  const w = 160, h = 36, min = Math.min(...points), max = Math.max(...points);
  const d = points.map((v, i) => `${(i / (points.length - 1)) * w},${h - 4 - ((v - min) / Math.max(1, max - min)) * (h - 8)}`).join(' ');
  return <svg className="spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Followers over time"><polyline points={d} /></svg>;
}

// --- Competitors: who else talks to your audience, what they publish, the dates that audience lives by, and posts worth borrowing from
export function WatchBoard({ pid, team, reload, go }: Common) {
  const { busy, error, run } = useAction(reload);
  const w = team.watch;
  const again = <button className="primary" disabled={busy !== '' || Boolean(team.working)} onClick={() => run('watch', () => teamApi.run(pid, ['scout'], ''))}>{busy ? 'Sending…' : team.working ? 'Team busy…' : w ? 'Watch again' : 'Watch the field'}</button>;
  if (!w) return <section className="card"><h3>Nobody watched yet</h3><p className="hint">The Scout searches the web for who else talks to your audience, what they publish and how big they are, the dates your audience gathers around, and concrete posts worth borrowing from. A few minutes.</p>{again}{error && <p className="error">{error}</p>}</section>;
  const d = w.data;
  return (
    <div className="stack">
      <section className="card">
        <div className="head"><h3>The market, as the Scout sees it</h3><span className="hint small">watched {ago(w.at)} · from the web, with the links</span></div>
        <p className="market">{d.market}</p>
        <div className="row">{again}{error && <p className="error">{error}</p>}</div>
      </section>
      <section className="card">
        <div className="head"><h3>The players</h3><span className="hint small">who they are, how big, who they talk to, what they publish, and the room they leave you</span></div>
        <div className="player-grid">{d.players.map(p => <PlayerCard key={p.name} p={p} />)}</div>
      </section>
      {d.events.length > 0 && <section className="card">
        <div className="head"><h3>Your audience's calendar</h3><span className="hint small">moments when these people are busy with one thing. Post about it before, not after.</span></div>
        <div className="events">{d.events.map(e => <EventCard key={e.name} pid={pid} e={e} reload={reload} go={go} />)}</div>
      </section>}
      <section className="card">
        <div className="head"><h3>Posts worth borrowing from</h3><span className="hint small">{d.finds.length} concrete posts and pages seen at these players: what each is, its figure, and what we would take. “Do our version” hands a brief to the Writer.</span></div>
        <div className="finds">{d.finds.map((f, n) => <FindCard key={n} pid={pid} f={f} reload={reload} go={go} />)}</div>
      </section>
    </div>
  );
}

const ROWS: Array<[keyof Player, string]> = [['place', 'Place in the market'], ['size', 'Size'], ['audience', 'Talks to'], ['channels', 'Where'], ['publishes', 'What they publish'], ['strength', 'Their strength'], ['opening', 'What they leave you']];

function PlayerCard({ p }: { p: Player }) {
  const rows = ROWS.filter(([k]) => p[k]);
  return (
    <article className="player-card" style={{ ['--h' as string]: hue(p.name) }}>
      <a className="player-head" href={p.url} target="_blank" rel="noreferrer"><span className="plogo small">{p.name[0]}</span><span><b>{p.name}</b><span className="hint small">{p.what}</span></span></a>
      {rows.length === 0 ? <p className="hint small">Only the name and what they sell were found. Watch again for a fuller profile.</p>
        : <dl className="player-rows">{rows.map(([k, label]) => <div key={k} className={k === 'opening' ? 'opening' : ''}><dt>{label}</dt><dd>{p[k]}</dd></div>)}</dl>}
    </article>
  );
}

function EventCard({ pid, e, reload, go }: { pid: string; e: Event; reload: () => Promise<void>; go: (v: View) => void }) {
  const [added, setAdded] = useState(false);
  const { busy, error, run } = useAction(reload);
  const take = () => run('take', async () => {
    await contentApi.addItem(pid, { kind: 'social-post', title: `Around ${cap(e.name, 60)}`, brief: e.post || `A post for ${e.name} (${e.when}): ${e.why}`, rationale: `${e.name}, ${e.when}: ${e.why}`, source: 'trend', pitch: { hook: '', channel: '', measure: '', context: `${e.name}, ${e.when}. ${e.why}` } });
    setAdded(true);
  });
  return (
    <div className="event">
      <b>{e.when}</b><span className="event-name">{e.name}</span>
      <span className="hint small">{e.why}</span>
      {e.post && <p className="event-post">{e.post}</p>}
      <span className="row">{added ? <button className="linkish" onClick={() => go('studio')}>In the pipeline →</button> : <button className="linkish" disabled={busy !== ''} onClick={take}>{busy ? '…' : 'Plan a post for it →'}</button>}</span>
      {error && <span className="error">{error}</span>}
    </div>
  );
}

function FindCard({ pid, f, reload, go }: { pid: string; f: Find; reload: () => Promise<void>; go: (v: View) => void }) {
  const [noPic, setNoPic] = useState(false);
  const [added, setAdded] = useState(false);
  const { busy, error, run } = useAction(reload);
  const take = () => run('take', async () => {
    await contentApi.addItem(pid, { kind: 'social-post', title: `Our take: ${cap(f.title, 60)}`, brief: `${f.whatItIs} Seen at ${f.account} (${f.platform}): ${f.url}. ${f.whyForYou}`, rationale: `Seen at ${f.account} on ${f.platform}: ${f.whatItIs}${f.number ? ` (${f.number})` : ''}. ${f.whyForYou}`, source: 'trend', pitch: { hook: '', channel: f.platform, measure: '', context: `${f.account} published this on ${f.platform}: ${f.whatItIs}${f.number ? ` It shows ${f.number}.` : ''}` } });
    setAdded(true);
  });
  return (
    <article className="find" style={{ ['--h' as string]: pHue(f.platform) }}>
      <a className="find-pic" href={f.url} target="_blank" rel="noreferrer">{noPic ? <span className="plogo">{f.platform[0]?.toUpperCase()}</span> : <img src={teamApi.thumbUrl(pid, f.url)} alt="" loading="lazy" onError={() => setNoPic(true)} />}</a>
      <div className="find-body">
        <span className="find-meta"><Pill name={f.platform} /><span className="hint small">{cap(f.account, 36)}</span></span>
        <b>{cap(f.title, 80)}</b>
        <span className="hint small">{cap(f.whatItIs, 110)}{f.number ? <> · <b>{cap(f.number, 40)}</b></> : null}</span>
        <p className="why-you"><b>Take:</b> {f.whyForYou}</p>
        <span className="row"><a className="linkish" href={f.url} target="_blank" rel="noreferrer">See it ↗</a>{added ? <button className="linkish" onClick={() => go('studio')}>Added to the pipeline →</button> : <button disabled={busy !== ''} onClick={take}>{busy ? '…' : 'Do our version'}</button>}</span>
        {error && <span className="error">{error}</span>}
      </div>
    </article>
  );
}
