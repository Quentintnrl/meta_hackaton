import { useEffect, useState } from 'react';
import { contentApi, teamApi, type AgentId, type ContentItem, type ContentView, type ItemStatus, type TeamView } from '../api';
import { KIND_HUE, KindChip, Trail, ago, fmt, useAction } from './shared';
import { locale, t, t2 } from '../i18n';
import { Brief } from './NextView';
import { Checkpoints } from './Chain';
import { Avatar } from './Agents';
import type { View } from './Studio';

type Props = { pid: string; team: TeamView; view: ContentView; reload: () => Promise<void>; go: (v: View) => void; open: (id: string) => void; askAgent: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void; since?: string };

// The thread a post follows, left to right. Each stage says who acts there and what it waits for.
const STAGES: Array<{ status: ItemStatus; title: string; who: string; empty: string }> = [
  { status: 'idea', title: t('Proposed'), who: t('The Strategist proposes, you decide'), empty: t('Nothing proposed. Brief the team above, or wait for its next pass.') },
  { status: 'briefed', title: t('Being written'), who: t('The Writer drafts it'), empty: t('Nothing in writing. Say yes to a proposal and it moves here.') },
  { status: 'drafted', title: t('To review'), who: t('You read, change, approve'), empty: t('No draft waits for you.') },
  { status: 'approved', title: t('Ready to post'), who: t('You copy it and post it'), empty: t('Nothing approved yet.') },
  { status: 'published', title: t('Posted'), who: t('Done, counted on Platforms'), empty: t('Nothing posted from here yet.') },
];

type Sort = 'date' | 'newest' | 'channel';
const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const byDate = (a: ContentItem, b: ContentItem) => (a.fixedDate ?? a.date ?? '9999').localeCompare(b.fixedDate ?? b.date ?? '9999');

export function FlowBoard({ pid, team, view, reload, open, askAgent, since = '' }: Props) {
  const note = team.synthesis;
  const { busy, run } = useAction(reload);
  const fresh = view.items.filter(i => i.status === 'idea' && i.createdAt > since).length;
  // How the board is read: by date (the default), newest first, or grouped by channel; narrowed to one kind or one channel.
  const [sort, setSort] = useState<Sort>(() => { try { return (localStorage.getItem('flow:sort') as Sort) || 'date'; } catch { return 'date'; } });
  const [kind, setKind] = useState('');
  const [channel, setChannel] = useState('');
  useEffect(() => { try { localStorage.setItem('flow:sort', sort); } catch { /* private window */ } }, [sort]);
  const kinds = [...new Set(view.items.filter(i => i.status !== 'rejected').map(i => i.kind))];
  const channels = [...new Set(view.items.filter(i => i.status !== 'rejected').map(i => i.pitch?.channel ?? '').filter(Boolean))].sort();
  const keep = (i: ContentItem) => (!kind || i.kind === kind) && (!channel || (i.pitch?.channel ?? '') === channel);
  const order = (status: ItemStatus) => (a: ContentItem, b: ContentItem) =>
    sort === 'newest' ? b.createdAt.localeCompare(a.createdAt)
      : sort === 'channel' ? ((a.pitch?.channel ?? '~').localeCompare(b.pitch?.channel ?? '~') || byDate(a, b))
        : status === 'published' ? byDate(b, a) : byDate(a, b);
  const lanes = STAGES.map(s => ({ ...s, items: view.items.filter(i => i.status === s.status && keep(i)).sort(order(s.status)) }));
  const hidden = view.items.filter(i => i.status !== 'rejected' && !keep(i)).length;
  const refused = view.items.filter(i => i.status === 'rejected');
  const writing = team.working?.agent === 'writer';
  const away = awayRows(team, since);
  return (
    <div className="stack">
      {away ? <Away team={team} since={since} fresh={fresh} rows={away} askAgent={askAgent} />
        : note && <p className="note-line"><b>{t('Director, {when}:', { when: ago(note.at) })}</b> {note.data.headline} <button className="linkish tight" onClick={() => askAgent('director')}>{t('Ask →')}</button></p>}
      <Brief pid={pid} team={team} reload={reload} />

      <div className="board-tools" role="toolbar" aria-label={t('Sort and filter')}>
        <label>{t('Sort')} <select value={sort} onChange={e => setSort(e.target.value as Sort)}><option value="date">{t('by date')}</option><option value="newest">{t('newest first')}</option><option value="channel">{t('by channel')}</option></select></label>
        <label>{t('Kind')} <select value={kind} onChange={e => setKind(e.target.value)}><option value="">{t('all')}</option>{kinds.map(k => <option key={k} value={k}>{k.replace('-', ' ')}</option>)}</select></label>
        {channels.length > 0 && <label>{t('Channel')} <select value={channel} onChange={e => setChannel(e.target.value)}><option value="">{t('all')}</option>{channels.map(c => <option key={c} value={c}>{c}</option>)}</select></label>}
        {hidden > 0 && <span className="hint small">{t('{n} hidden', { n: hidden })} · <button className="linkish tight" onClick={() => { setKind(''); setChannel(''); }}>{t('show all')}</button></span>}
      </div>
      <ol className="thread" aria-label={t('The thread of a post')}>
        {lanes.map((lane, n) => (
          <li key={lane.status} className={`stage ${lane.status}${lane.items.length ? '' : ' bare'}`}>
            <header className="stage-head">
              <div className="stage-title"><i>{n + 1}</i><h3>{lane.title}</h3>{lane.items.length > 0 && <span className="count">{lane.items.length}</span>}</div>
              <p className="hint small">{lane.who}{lane.status === 'briefed' && writing ? ` · ${t('writing now')}` : ''}</p>
            </header>
            <div className="stage-body">
              {lane.status === 'idea' && <Trail who="Strategist" lines={team.proposals?.data.trail} summary={team.proposals ? t('what it read before proposing, {when}', { when: ago(team.proposals.at) }) : undefined} />}
              {lane.items.length === 0 && <p className="stage-empty">{lane.empty}</p>}
              {lane.items.map(i => <ThreadCard key={i.id} item={i} view={view} reload={reload} open={open} askAgent={askAgent} writing={writing} fresh={i.status === 'idea' && i.createdAt > since} />)}
              {lane.status === 'idea' && refused.length > 0 && (
                <details className="refused"><summary className="hint small">{t('Refused ({n})', { n: refused.length })}</summary>
                  <ul>{refused.map(i => <li key={i.id}><span>{cap(i.title, 60)}{i.rejectedReason && <span className="hint small"> — {i.rejectedReason}</span>}</span><button className="linkish tight" disabled={busy !== ''} title={t('Back to the proposals, the refusal kept in its chain')} onClick={() => run('back:' + i.id, () => teamApi.restore(i.id))}>{busy === 'back:' + i.id ? '…' : t('Take it back ↶')}</button></li>)}</ul>
                </details>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// What the team did while the manager was away: one line per agent, read from the activity log.
// Lines newer than the last visit; failing that, the last pass (24 h), so the proof that the team works
// on its own never disappears from the first screen.
const ORDER: AgentId[] = ['scout', 'analyst', 'strategist', 'writer', 'director'];
type AwayRows = { away: boolean; onDuty: boolean; latest: TeamView['activity'] };
function awayRows(team: TeamView, since: string): AwayRows | null {
  const ok = team.activity.filter(a => a.ok);
  const sinceMs = Date.parse(since) || 0;
  let rows = ok.filter(a => Date.parse(a.at) > sinceMs);
  const away = rows.length > 0 && sinceMs > 0;
  if (!rows.length) rows = ok.filter(a => Date.now() - Date.parse(a.at) < 24 * 3_600_000);
  const onDuty = rows.some(a => a.summary.startsWith('On duty'));
  const latest = ORDER.flatMap(id => { const a = rows.find(r => r.agent === id && !r.summary.startsWith('On duty')); return a ? [a] : []; });
  return latest.length ? { away, onDuty, latest } : null;
}
function Away({ team, since, fresh, rows: { away, onDuty, latest }, askAgent }: { team: TeamView; since: string; fresh: number; rows: AwayRows; askAgent: Props['askAgent'] }) {
  const name = (id: AgentId) => team.agents.find(a => a.id === id)?.name ?? id;
  return (
    <section className="away" aria-label={t('What the team did')}>
      <header>
        <b>{away ? t('While you were away') : t('The team\u2019s last pass')}</b>
        {onDuty && <span className="pill duty-pill" title={t('The team started this pass on its own, as set in Settings. Nothing was written or posted without you.')}>{t('on its own, nobody asked')}</span>}
        <span className="hint small">{away ? t('since {when}', { when: ago(since) }) : ago(latest[0].at)}</span>
        {fresh > 0 && <span className="since">{t2(fresh, '{n} new proposal', '{n} new proposals')}</span>}
      </header>
      <ul>{latest.map(a => <li key={a.id}><Avatar id={a.agent} state="idle" size={26} /><div><b>{name(a.agent)}</b><p>{cap(a.summary, 170)}{a.agent === 'director' && <> <button className="linkish tight" onClick={() => askAgent('director')}>{t('Ask →')}</button></>}</p></div></li>)}</ul>
    </section>
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
    <article className={`tcard ${item.status}`} style={{ ['--h' as string]: KIND_HUE[item.kind] }} role="button" tabIndex={0} aria-label={t('Open {title}', { title: item.title })}
      onClick={() => open(item.id)} onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) open(item.id); }}>
      {first && <span className="tcard-pic"><img src={contentApi.mediaUrl(item.id, first.file!)} alt="" /></span>}
      <div className="tcard-meta"><KindChip kind={item.kind} />{item.pitch?.channel && <span className="chip">{item.pitch.channel}</span>}<span className="hint small">{fmt(date)}</span>{fresh && <span className="fresh" title={t('Arrived since your last visit')}>{t('new')}</span>}</div>
      <b className="tcard-title">{item.title}</b>
      {hook && <p className="tcard-hook">“{cap(hook, 140)}”</p>}
      <Checkpoints item={item} />
      {item.status === 'drafted' && item.draft && <span className="hint small">{t('{n} words', { n: item.draft.split(/\s+/).length })}{pictures ? `, ${t2(pictures, '{n} picture', '{n} pictures')}` : ''} · {t('open to read')}</span>}
      {item.status === 'approved' && pictures > 0 && !first && <span className="hint small">{t('{n} picture(s) ready', { n: pictures })}</span>}
      {item.status === 'published' && <AfterPosting item={item} reload={reload} />}

      {refusing ? (
        <div className="refuse" onClick={e => e.stopPropagation()}>
          <input autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder={t('Why not? The team remembers it.')} onKeyDown={e => e.key === 'Enter' && refuse()} />
          <div className="row nomargin"><button disabled={busy !== ''} onClick={refuse}>{t('Refuse')}</button><button className="linkish" onClick={() => setRefusing(false)}>{t('Cancel')}</button></div>
        </div>
      ) : (
        <div className="tcard-actions" onClick={e => e.stopPropagation()}>
          {item.status === 'idea' && <>
            <button className="primary" disabled={busy !== ''} title={t('The Writer writes it now: about 30 seconds, one model call')} onClick={() => run('yes', async () => { await teamApi.accept(item.id); await contentApi.draft(item.id); })}>{busy === 'yes' ? t('Writing…') : t('Yes, write it')}</button>
            <button disabled={busy !== ''} onClick={() => setRefusing(true)}>{t('No')}</button>
            <button className="linkish" disabled={busy !== ''} onClick={() => run('keep', () => teamApi.accept(item.id))}>{t('Later')}</button>
            <button className="linkish" onClick={() => askAgent('strategist', 'item', item.id)}>{t('Ask why')}</button>
          </>}
          {item.status === 'briefed' && <>
            <button className="primary" disabled={busy !== '' || writing} onClick={() => run('draft', () => contentApi.draft(item.id))}>{busy === 'draft' || writing ? t('Writing…') : t('Write it now')}</button>
          </>}
          {item.status === 'drafted' && <>
            <button className="primary" disabled={busy !== ''} onClick={() => run('ok', () => contentApi.approve(item.id))}>{busy === 'ok' ? '…' : t('Approve as is')}</button>
            <button className="linkish" onClick={() => askAgent('writer', 'item', item.id)}>{t('Ask the Writer')}</button>
          </>}
          {item.status === 'approved' && <>
            <button className="primary" disabled={busy !== ''} onClick={copy}>{copied ? t('Copied') : t('Copy the post')}</button>
            <button disabled={busy !== ''} onClick={() => run('posted', () => contentApi.publish(item.id))}>{t('Mark as posted')}</button>
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
        <b>{soon ? t2(o.daysSince, '{n} day after', '{n} days after') : t('A week after')}</b>
        <div className="after-nums"><span><b>{o.likes}</b>{li ? t('reactions') : t('likes')}</span><span><b>{o.comments}</b>{t('comments')}</span><span><b>{o.shares}</b>{li ? t('reposts') : t('shares')}</span>{o.views != null && <span><b>{o.views.toLocaleString(locale)}</b>{t('views')}</span>}{!li && o.saves > 0 && <span><b>{o.saves}</b>{t('saves')}</span>}</div>
        {item.pitch?.measure && <p className="hint small">{t('We said we would count: {measure}', { measure: item.pitch.measure })}{soon ? ` · ${t('too early to judge')}` : ''}</p>}
      </div>
    );
  }
  if (m) {
    return (
      <div className="after match" onClick={e => e.stopPropagation()}>
        <b>{t('Is this it on {platform}?', { platform: m.platform })}</b>
        <p className="hint small">“{cap(m.text, 90)}” · {fmt(m.postedAt)}, {m.why}</p>
        <button className="tight" disabled={busy !== ''} onClick={() => run('match', () => teamApi.confirmMatch(item.id, m.postId))}>{busy === 'match' ? '…' : t('Yes, tie them')}</button>
        {error && <span className="error">{error}</span>}
      </div>
    );
  }
  return <span className="hint small">{t('Posted {date} · not found in the account yet: read the platform again once it is up', { date: fmt(date) })}</span>;
}
