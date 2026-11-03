import { useEffect, useState } from 'react';
import { contentApi, teamApi, type AccountPost, type AgentId, type ContentItem, type ContentView, type Event, type Find, type Fix, type Player, type Reading, type Strategy, type TeamView } from '../api';
import { KIND_HUE, KindChip, ago, fmt, useAction } from './shared';
import { hue } from './Numbers';
import { Ahead, Compare, Dots, Strip, Timeline, dateIn, followersIn } from './charts';
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
export function DutyLine({ pid, team, go, reload }: { pid: string; team: TeamView; go: (v: View) => void; reload?: () => Promise<void> }) {
  const w = team.working;
  const last = team.duty.lastPass;
  const next = last ? Math.max(0, 24 - (Date.now() - Date.parse(last)) / 3_600_000) : 0;
  const [stopping, setStopping] = useState(false);
  useEffect(() => { if (!w) setStopping(false); }, [w]);
  const stop = async () => { setStopping(true); try { await teamApi.stop(pid); await reload?.(); } catch { setStopping(false); } };
  return (
    <p className="duty">
      <span className={`dot ${w ? 'on' : team.duty.autopilot ? 'idle' : 'off'}`} />
      {w ? <>{team.agents.find(a => a.id === w.agent)?.name ?? w.agent} is working, since {ago(w.since)}. <button className="linkish tight stop" disabled={stopping} title="Aborts the call in flight and skips the rest of the pass. What was already saved stays." onClick={() => void stop()}>{stopping ? 'Stopping…' : 'Stop ■'}</button></>
        : team.duty.autopilot ? <>Team on duty. Last pass {last ? ago(last) : 'never'}, next in about {next < 1 ? 'an hour' : `${Math.round(next)} h`}.</>
        : <>Team off duty: it only works when you ask. <button className="linkish tight" onClick={() => go('settings')}>Put it on duty →</button></>}
    </p>
  );
}

// --- Create: proposals to judge, then every accepted piece with the step it is at and the one thing it needs
// The Create page is the thread of a post, in Flow.tsx.
export { FlowBoard as CreateBoard } from './Flow';

// --- Platforms: one card per place you publish, with its real rhythm, and where to feed it
export function PlatformsBoard({ pid, team, view, reload }: Common) {
  const [posts, setPosts] = useState<AccountPost[]>([]);
  useEffect(() => { contentApi.accountPosts(pid).then(setPosts).catch(() => setPosts([])); }, [pid, team.accountPosts]);
  const names = [...new Set(['instagram', 'linkedin', ...posts.map(p => platformKey(p.platform ?? 'instagram')), ...team.snapshots.map(s => platformKey(s.platform))])];
  return (
    <div className="stack">
      <div className="platforms">{names.map(n => <PlatformCard key={n} pid={pid} name={n} profile={view.profile} working={Boolean(team.working)} connected={n === 'instagram' && team.connected?.instagram} lastRead={team.snapshots.filter(s => platformKey(s.platform) === n).at(-1)?.at} posts={posts.filter(p => platformKey(p.platform ?? 'instagram') === n)} snaps={team.snapshots.filter(s => platformKey(s.platform) === n)} planned={view.items.filter(i => i.status !== 'published' && i.status !== 'rejected' && i.pitch?.channel && platformKey(i.pitch.channel) === n || (i.pitch?.channel ?? '').toLowerCase().includes(n))} reload={reload} />)}</div>
      <div className="row export-row">
        <p className="hint small">Pieces leave the studio {view.profile.publishMode === 'connected' ? 'through your Meta app' : view.profile.publishMode === 'assisted' ? 'by hand, via your scheduler' : 'by hand: copy the approved post, publish it, mark it posted'}.</p>
        {view.items.some(i => i.status === 'approved' && i.draft) && <a className="button" href={contentApi.exportWeekUrl(pid)} download title="One ZIP: posts.csv (date, channel, title, caption, hashtags, media) and a folder per piece with its caption and pictures, ready for Buffer, Later or Business Suite">Export the approved pieces (ZIP) ↓</a>}
      </div>
    </div>
  );
}

function PlatformCard({ pid, name, posts, snaps, planned, reload, connected, lastRead, profile, working }: { pid: string; name: string; posts: AccountPost[]; snaps: TeamView['snapshots']; planned: ContentItem[]; reload: () => Promise<void>; connected?: boolean; lastRead?: string; profile: ContentView['profile']; working: boolean }) {
  const { busy, error, run } = useAction(reload);
  const aim = profile.cadence?.[name] ?? 0;
  const [aimText, setAimText] = useState(String(aim || ''));
  const todayIso = new Date().toISOString().slice(0, 10);
  const monday = (() => { const d = new Date(todayIso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
  const sunday = (() => { const d = new Date(monday + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().slice(0, 10); })();
  const postedThisWeek = posts.filter(p => p.postedAt >= monday && p.postedAt <= sunday).length;
  const plannedThisWeek = planned.filter(i => { const d = i.fixedDate ?? i.date ?? ''; return d >= monday && d <= sunday; });
  const missing = Math.max(0, aim - postedThisWeek - plannedThisWeek.length);
  const top = [...posts].sort((a, b) => b.likes - a.likes).slice(0, 2);
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
      <div className="week-plan">
        <div className="row"><b>This week</b><span className="hint small">{fmt(monday)} to {fmt(sunday)}</span></div>
        <p>{postedThisWeek} posted, {plannedThisWeek.length} planned{aim ? `, aim ${aim} a week` : ''}.{aim ? (missing ? ` ${missing} slot${missing > 1 ? 's' : ''} to fill.` : ' On target.') : ''}</p>
        <div className="row">
          <label className="hint small">Aim <input type="number" min={0} max={30} value={aimText} onChange={e => setAimText(e.target.value)} onBlur={() => { const n = Number(aimText) || 0; if (n !== aim) void run('aim', () => contentApi.setProfile(pid, { ...profile, cadence: { ...(profile.cadence ?? {}), [name]: n } })); }} style={{ width: 56 }} /> posts a week</label>
          {aim > 0 && missing > 0 && <button className="primary" disabled={busy !== '' || working} onClick={() => run('fill', () => teamApi.run(pid, ['strategist'], `${missing} piece${missing > 1 ? 's' : ''} for ${title(name)} to post before ${fmt(sunday)}, for the audience that is on ${title(name)}.`))}>{busy === 'fill' ? 'Asking…' : working ? 'Team busy…' : `Fill ${missing > 1 ? 'the slots' : 'the slot'}`}</button>}
          {aim > 0 && missing > 0 && !working && <span className="cost">Strategist, about a minute</span>}
        </div>
      </div>
      <div className="pnext"><b>Planned here</b>{planned.length === 0 ? <span className="hint small"> nothing yet</span> : <ul>{planned.slice(0, 4).map(i => <li key={i.id}>{fmt(i.fixedDate ?? i.date)} · {cap(i.title, 48)} <span className="hint small">{i.status}</span></li>)}</ul>}</div>
      {top.length > 0 && <div className="pnext"><b>What worked here</b><ul>{top.map((p, n) => <li key={n}>{p.likes} {w.like}{p.views ? `, ${p.views} views` : ''} · {cap(p.text, 60)} <span className="hint small">{fmt(p.postedAt)}</span></li>)}</ul></div>}
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

// --- Community: the account as a story with drawings, each finding in one sentence, then what the Analyst says to do
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function CommunityBoard({ pid, team, reload, go, askAgent }: Common) {
  const [posts, setPosts] = useState<AccountPost[] | null>(null);
  useEffect(() => { contentApi.accountPosts(pid).then(setPosts).catch(() => setPosts([])); }, [pid, team.accountPosts]);
  const { busy, error, run } = useAction(reload);
  if (!posts) return null;
  const f = team.facts;
  if (!f || posts.length === 0) return <section className="card"><h3>No posts yet</h3><p className="hint">Feed a platform first: paste the posts, or connect Instagram. The drawings start from the first post.</p><button className="linkish" onClick={() => go('platforms')}>Platforms →</button></section>;
  const snaps = team.snapshots;
  const latest = [...new Set(snaps.map(s => platformKey(s.platform)))].map(p => snaps.filter(s => platformKey(s.platform) === p).at(-1)!);
  const asked = [...posts].sort((a, b) => b.postedAt.localeCompare(a.postedAt)).find(p => p.text.includes('?'));
  const report = team.account;
  const fixes = report?.data.fixes ?? [];
  const noteFor = (p: { text: string }) => report?.data.winners?.find(w => p.text.startsWith(w.text.slice(0, 40)) || w.text.startsWith(p.text.slice(0, 40)))?.note;
  const top = [...posts].sort((a, b) => b.likes - a.likes).slice(0, 3);
  const q = f.question, tr = f.trend;
  const small = (n: number) => n < 8;
  const diff = (a: number, b: number) => Math.abs(a - b) < Math.max(1, Math.max(a, b) * 0.15);
  const busiest = [...f.weekday].sort((a, b) => b.n - a.n)[0];
  const bestDay = [...f.weekday].filter(w => w.n >= 3).sort((a, b) => b.avg - a.avg)[0];
  const lengths = f.length.filter(l => l.n);
  const longest = [...lengths].sort((a, b) => b.avg - a.avg)[0];
  const li = f.reach;
  const liHue = PLATFORM_HUE.linkedin;
  const readings = report?.data.readings ?? [];
  // The action first, in the accent; the meaning after, short. The numbers stay on the drawing.
  const Read = ({ fact }: { fact: Reading['fact'] }) => { const r = readings.find(x => x.fact === fact); if (!r) return null; const act = r.action && r.action.toLowerCase() !== 'nothing' ? r.action : ''; return <p className="reading">{act ? <span className="todo">→ {act}</span> : <span className="todo muted">Nothing to change here.</span>}<span className="meaning"><b>Analyst:</b> {r.meaning}</span></p>; };
  const hk = f.hooks;
  const bestHook = [...hk].filter(h => h.n >= 3).sort((a, b) => b.avg - a.avg)[0];
  const HOOK: Record<string, string> = { question: 'a question', number: 'a number', you: '“vous” / you', other: 'a statement' };
  return (
    <div className="stack">
      <section className="card">
        <div className="head"><h3>The story of your account</h3><span className="hint small">{latest.map(s => `${s.followers.toLocaleString()} on ${title(platformKey(s.platform))}`).join(' · ')}{latest.length ? ' · ' : ''}{f.n} posts since {fmtY(f.first)}</span></div>
        <Timeline posts={posts} silences={f.silences} hueOf={p => pHue(p.platform ?? 'instagram')} best={f.best} />
        <p className="finding">
          {f.perMonth} posts a month on average, the last one {f.daysSinceLast} days ago.
          {f.silences.length ? ` ${f.silences.length === 1 ? 'One silence' : `${f.silences.length} silences`} of more than three weeks: ${f.silences.map(s => `${s.days} days from ${fmtY(s.from)}`).join(', ')}. Each one resets what the audience remembers.` : ' No silence longer than three weeks: the account stays in view.'}
          {f.comments === 0 ? ` No one has commented on any post${asked ? `; your last question, ${fmt(asked.postedAt)}, got no answer` : ''}.` : ` ${f.comments} comments in all.`}
        </p>
        <Read fact="pace" />
        {[...new Set(posts.map(p => platformKey(p.platform ?? 'instagram')))].length > 1 && <div className="legend">{[...new Set(posts.map(p => platformKey(p.platform ?? 'instagram')))].map(p => <span key={p}><i style={{ background: `hsl(${pHue(p)} 65% 50%)` }} />{title(p)}</span>)}</div>}
      </section>

      <section className="card">
        <div className="head"><h3>What the posts say, counted, and what the Analyst reads in it</h3><span className="hint small">the numbers are recomputed from your {f.n} loaded posts at every load, no model; the sentence in bold under each drawing is the Analyst's, written from these same numbers. Under eight posts a group is a hint, not a rule.</span></div>
        <div className="findings">
          <article className="finding-card">
            <h4>{tr.direction === 'up' ? 'Likes are climbing' : tr.direction === 'down' ? 'Likes are slipping' : 'Likes are flat'}: {tr.early.avg} per post in the first half, {tr.late.avg} in the second, {tr.last5.avg} on the last five.</h4>
            <Compare groups={[{ label: 'first half', n: tr.early.n, avg: tr.early.avg }, { label: 'second half', n: tr.late.n, avg: tr.late.avg }, { label: 'last five', n: tr.last5.n, avg: tr.last5.avg }]} />
            <Read fact="trend" />
          </article>
          <article className="finding-card">
            <h4>{q.asked.n === 0 ? 'None of your posts asks a question.' : diff(q.asked.avg, q.not.avg) ? `Asking a question changes nothing in likes (${q.asked.avg} against ${q.not.avg})${f.comments === 0 ? ', and it does not bring answers either' : ''}.` : q.asked.avg > q.not.avg ? `Posts that ask a question get more likes: ${q.asked.avg} against ${q.not.avg}.` : `Posts that ask a question get fewer likes: ${q.asked.avg} against ${q.not.avg}.`}{small(Math.min(q.asked.n, q.not.n)) ? ' Few posts on one side.' : ''}</h4>
            <Compare groups={[{ label: 'asks a question', n: q.asked.n, avg: q.asked.avg }, { label: 'does not', n: q.not.n, avg: q.not.avg }]} />
            <Read fact="question" />
          </article>
          <article className="finding-card">
            <h4>Your first lines open with {HOOK[[...hk].sort((a, b) => b.n - a.n)[0].kind]} most often ({[...hk].sort((a, b) => b.n - a.n)[0].n} posts).{bestHook ? ` Opening with ${HOOK[bestHook.kind]} did best: ${bestHook.avg} likes.` : ''}</h4>
            <Compare groups={hk.map(h => ({ label: HOOK[h.kind], n: h.n, avg: h.avg }))} />
            <Read fact="hooks" />
          </article>
          <article className="finding-card">
            <h4>{lengths.length < 2 ? `All your posts are ${lengths[0]?.label ?? 'the same length'}.` : diff(longest.avg, Math.min(...lengths.map(l => l.avg))) ? 'Length does not change the likes.' : `${title(longest.label)} posts do best: ${longest.avg} likes against ${lengths.filter(l => l !== longest).map(l => `${l.avg} for ${l.label}`).join(' and ')}.`}{lengths.some(l => small(l.n)) ? ' Thin groups.' : ''}</h4>
            <Compare groups={f.length.map(l => ({ label: l.label === 'short' ? 'short (<120)' : l.label === 'medium' ? 'medium (<300)' : 'long', n: l.n, avg: l.avg }))} />
            <Read fact="length" />
          </article>
          <article className="finding-card">
            <h4>You post mostly on {DAYS[busiest.day]} ({busiest.n} posts).{bestDay && bestDay.day !== busiest.day && !diff(bestDay.avg, busiest.avg) ? ` ${DAYS[bestDay.day]} did better: ${bestDay.avg} likes against ${busiest.avg}.` : bestDay ? ' No weekday stands out.' : ''}</h4>
            <Compare groups={f.weekday.map(w => ({ label: DAYS[w.day], n: w.n, avg: w.avg }))} />
            <Read fact="weekday" />
          </article>
          <article className="finding-card">
            <h4>{f.words.length ? 'Words your best third of posts use more than the others.' : 'No word comes back in your best posts more than in the others: what they share is a scene, not a vocabulary.'}</h4>
            {f.words.length > 0 && <div className="words">{f.words.map(w => <span key={w.word} className="word" style={{ fontSize: `${13 + Math.round(w.best * 10)}px` }} title={`in ${Math.round(w.best * 100)}% of the best third, ${Math.round(w.rest * 100)}% of the others`}>{w.word}<i>{Math.round(w.best * 100)}% · {Math.round(w.rest * 100)}%</i></span>)}</div>}
            <p className="hint small">Best third = the {Math.max(1, Math.floor(f.n / 3))} most liked posts. The two figures: share of those posts using the word, share of the others.</p>
            <Read fact="words" />
          </article>
          {li.length > 0 && <article className="finding-card">
            <h4>On LinkedIn, {li.reduce((a, r) => a + r.likes, 0)} reactions for {li.reduce((a, r) => a + r.views, 0).toLocaleString()} views: {Math.round((li.reduce((a, r) => a + r.likes, 0) / li.reduce((a, r) => a + r.views, 0)) * 1000) / 10}% of the people who saw a post reacted. The most seen post ({li[0].views} views) got {li[0].likes}.</h4>
            <Dots points={li} hue={liHue} />
            <Read fact="reach" />
          </article>}
        </div>
        {f.thin && <p className="plain-truth">With likes this small and no comments, formats cannot be ranked: a few likes apart is noise. What the drawings can show is the pace, the silences, the drift, and what the best posts have in common.</p>}
      </section>

      <section className="card">
        <div className="head"><h3>What the Analyst makes of it, and what to do</h3><span className="hint small">{report ? <>Analyst, {ago(report.at)} · <button className="linkish tight" onClick={() => askAgent('analyst')}>ask →</button></> : 'no reading yet'}</span></div>
        {report && <p className="piece-why">{report.data.summary}</p>}
        {fixes.length > 0 ? <div className="fixes">{fixes.map((x, n) => <FixCard key={n} pid={pid} f={x} reload={reload} go={go} />)}</div>
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

// --- Competitors: who else talks to your audience, each as a readable profile with its way of communicating, and the dates ahead
export function WatchBoard({ pid, team, view, reload, go }: Common) {
  const { busy, error, run } = useAction(reload);
  const w = team.watch;
  const today = new Date().toISOString().slice(0, 10);
  const again = <span className="row nomargin"><button className="primary" disabled={busy !== '' || Boolean(team.working)} title="The Scout searches and opens pages: a few minutes, up to 14 tool calls" onClick={() => run('watch', () => teamApi.run(pid, ['scout'], ''))}>{busy ? 'Sending…' : team.working ? 'Team busy…' : w ? 'Watch again' : 'Watch the field'}</button>{!team.working && <span className="cost">a few minutes</span>}</span>;
  if (!w) return <section className="card"><h3>Nobody watched yet</h3><p className="hint">The Scout searches the web for who else talks to your audience, how each one communicates (rhythm, formats, subjects, tone, who speaks, what they ask), what they leave you, and the dates your audience gathers around. A few minutes.</p>{again}{error && <p className="error">{error}</p>}</section>;
  const d = w.data;
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const findsOf = (p: Player) => d.finds.filter(f => key(f.account).includes(key(p.name).slice(0, 6)) || key(p.name).includes(key(f.account.split(/[ /—-]/)[0]).slice(0, 6)));
  const taken = new Set(d.players.flatMap(p => findsOf(p)));
  const rest = d.finds.filter(f => !taken.has(f));
  const seen = new Map<string, number>();
  for (const x of d.finds) { const n = followersIn(x.number); if (n && platformKey(x.platform) === 'linkedin') seen.set(x.account.split(/ [—-] /)[0], Math.max(seen.get(x.account) ?? 0, n)); }
  const you = team.snapshots.filter(s => platformKey(s.platform) === 'linkedin').at(-1);
  const players = [...seen].map(([name, followers]) => ({ name, followers }));
  return (
    <div className="stack">
      <section className="card">
        <div className="head"><h3>The market in three lines</h3><span className="hint small">watched {ago(w.at)} · from the web, every player linked</span></div>
        <p className="market">{d.market}</p>
        {players.length >= 2 && <>
          <Strip players={players} you={you ? { name: 'you', followers: you.followers } : undefined} hue={PLATFORM_HUE.linkedin} />
          <p className="finding">Their LinkedIn followers on a log scale{you ? `, you at ${you.followers}` : ''}. {you ? `The smallest has ${Math.min(...players.map(p => p.followers)).toLocaleString()}: ${Math.round(Math.min(...players.map(p => p.followers)) / Math.max(1, you.followers))} times your audience.` : ''} The point is not to catch them but to take the ground each one leaves open, named on its card below.</p>
        </>}
        {d.trail && d.trail.length > 0 && <details className="trail"><summary className="hint small">How the Scout worked: {d.trail.filter(t => t.startsWith('Searched')).length} searches, {d.trail.filter(t => t.startsWith('Opened')).length} pages opened and read before writing this</summary><ol>{d.trail.map((t, n) => <li key={n} className={/ → /.test(t) ? 'refused' : ''}>{t}</li>)}</ol></details>}
        <div className="row">{again}{error && <p className="error">{error}</p>}</div>
      </section>
      <section className="card">
        <div className="head"><h3>The players, one by one</h3><span className="hint small">who they are · how they communicate · what they leave you, with what the Scout saw on their pages</span></div>
        <div className="player-list">{d.players.map(p => <PlayerRow key={p.name} pid={pid} p={p} finds={findsOf(p)} reload={reload} go={go} />)}</div>
        {rest.length > 0 && <details className="also-seen"><summary className="hint small">Also seen, at others ({rest.length})</summary><ul className="post-lines">{rest.map((f, n) => <li key={n}><Pill name={f.platform} /><a href={f.url} target="_blank" rel="noreferrer">{cap(f.title, 70)} ↗</a><span className="hint small">{f.account}{f.number ? ` · ${f.number}` : ''}</span></li>)}</ul></details>}
      </section>
      {d.events.length > 0 && <section className="card">
        <div className="head"><h3>Your audience's calendar</h3><span className="hint small">moments when these people are busy with one thing. Post about it before, not after. <button className="linkish tight" onClick={() => go('agenda')}>Open the calendar →</button></span></div>
        <Ahead today={today} events={d.events.map(e => ({ name: e.name, at: dateIn(e.when, today) ?? '', post: e.post })).filter(e => e.at)} pieces={view.items.filter(i => !['published', 'rejected'].includes(i.status) && (i.fixedDate ?? i.date)).map(i => ({ title: i.title, at: (i.fixedDate ?? i.date)! }))} />
        <div className="events">{d.events.map(e => <EventCard key={e.name} pid={pid} e={e} reload={reload} go={go} />)}</div>
      </section>}
    </div>
  );
}

const STRAT: Array<[keyof Strategy, string]> = [['rhythm', 'Rhythm'], ['formats', 'Formats'], ['subjects', 'Subjects'], ['tone', 'Tone'], ['voices', 'Who speaks'], ['callsToAction', 'They ask you to']];

// One player as a row: identity on the left, how they communicate in the middle, what they leave you on the right.
function PlayerRow({ pid, p, finds, reload, go }: { pid: string; p: Player; finds: Find[]; reload: () => Promise<void>; go: (v: View) => void }) {
  const st = p.strategy;
  const strat = st ? STRAT.filter(([k]) => st[k]) : [];
  return (
    <article className="player-row" style={{ ['--h' as string]: hue(p.name) }}>
      <div className="pr-id">
        <a className="player-head" href={p.url} target="_blank" rel="noreferrer"><span className="plogo small">{p.name[0]}</span><span><b>{p.name}</b><span className="hint small">{p.what}</span></span></a>
        {p.place && <p><b>{cap(p.place, 60)}</b></p>}
        {p.size && <p className="hint small">{p.size}</p>}
        {p.audience && <p className="hint small">Talks to {p.audience}</p>}
      </div>
      <div className="pr-how">
        <h4>How they communicate</h4>
        {strat.length ? <dl className="strat">{strat.map(([k, label]) => <div key={k}><dt>{label}</dt><dd>{st![k]}</dd></div>)}</dl>
          : <p className="hint small">{p.channels ? `Where: ${p.channels}. ` : ''}{p.publishes ? `What: ${p.publishes}.` : 'Not described yet: watch again for the strategy.'}</p>}
        {p.strength && <p className="hint small"><b>Their strength:</b> {p.strength}</p>}
      </div>
      <div className="pr-you">
        <h4>What they leave you</h4>
        <p>{p.opening || 'Nothing named yet.'}</p>
        {st?.lesson && <p className="lesson">{st.lesson}</p>}
        {finds.length > 0 && <ul className="seen">{finds.slice(0, 3).map((f, n) => <li key={n}><Pill name={f.platform} /><a href={f.url} target="_blank" rel="noreferrer" title={f.whatItIs}>{cap(f.title, 56)} ↗</a>{f.number && <span className="hint small"> {cap(f.number, 30)}</span>}<Take pid={pid} f={f} reload={reload} go={go} /></li>)}</ul>}
      </div>
    </article>
  );
}

function Take({ pid, f, reload, go }: { pid: string; f: Find; reload: () => Promise<void>; go: (v: View) => void }) {
  const [added, setAdded] = useState(false);
  const { busy, run } = useAction(reload);
  const take = () => run('take', async () => {
    await contentApi.addItem(pid, { kind: 'social-post', title: `Our take: ${cap(f.title, 60)}`, brief: `${f.whatItIs} Seen at ${f.account} (${f.platform}): ${f.url}. ${f.whyForYou}`, rationale: `Seen at ${f.account} on ${f.platform}: ${f.whatItIs}${f.number ? ` (${f.number})` : ''}. ${f.whyForYou}`, source: 'trend', pitch: { hook: '', channel: f.platform, measure: '', context: `${f.account} published this on ${f.platform}: ${f.whatItIs}${f.number ? ` It shows ${f.number}.` : ''}` } });
    setAdded(true);
  });
  return added ? <button className="linkish tight" onClick={() => go('studio')}>in the pipeline →</button> : <button className="linkish tight" disabled={busy !== ''} title={f.whyForYou} onClick={take}>{busy ? '…' : 'do our version'}</button>;
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
