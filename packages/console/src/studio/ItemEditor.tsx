import { useEffect, useRef, useState } from 'react';
import { contentApi, SOCIAL_KINDS, type AgentId, type ContentItem, type Milestone, type Series } from '../api';
import { PostBuilder, PostPreview } from './PostBuilder';
import { KindChip, credit, fmt, useAction } from './shared';
import { ChainLog, Checkpoints } from './Chain';

// The working surface of one piece: say what you want, let the Writer draft, ask for changes, sign off.
export function ItemEditor({ item, milestones, series, reload, onClose, goItem, askAgent }: { item: ContentItem; milestones: Milestone[]; series: Series[]; reload: () => Promise<void>; onClose: () => void; goItem: (id: string) => void; askAgent: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void }) {
  const { busy, error, run } = useAction(reload);
  const [brief, setBrief] = useState(item.brief);
  const [draft, setDraft] = useState(item.draft);
  const [ask, setAsk] = useState('');
  const [seriesName, setSeriesName] = useState(series.find(s => s.id === item.seriesId)?.name ?? '');
  useEffect(() => { setBrief(item.brief); setDraft(item.draft); setSeriesName(series.find(s => s.id === item.seriesId)?.name ?? ''); }, [item.id, item.brief, item.draft, item.seriesId]);
  const b = busy !== '';
  const saveSeriesName = () => {
    const clean = seriesName.trim();
    if (!clean) { if (item.seriesId) void run('series', () => contentApi.patchItem(item.id, { seriesId: null })); return; }
    const found = series.find(s => s.name.toLowerCase() === clean.toLowerCase());
    if (found && found.id === item.seriesId) return;
    void run('series', async () => {
      const s = found ?? await contentApi.saveSeries(item.projectId, clean);
      await contentApi.patchItem(item.id, { seriesId: s.id });
    });
  };
  // Auto-save edits shortly after the user stops typing, so Approve never waits on a forgotten Save.
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const briefTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (draftTimer.current) clearTimeout(draftTimer.current); if (briefTimer.current) clearTimeout(briefTimer.current); }, [item.id]);
  const queueDraftSave = (next: string) => {
    setDraft(next);
    if (next === item.draft) { if (draftTimer.current) clearTimeout(draftTimer.current); return; }
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => { void run('save', () => contentApi.patchItem(item.id, { draft: next })); }, 800);
  };
  const queueBriefSave = (next: string) => {
    setBrief(next);
    if (next === item.brief) { if (briefTimer.current) clearTimeout(briefTimer.current); return; }
    if (briefTimer.current) clearTimeout(briefTimer.current);
    briefTimer.current = setTimeout(() => { void run('brief', () => contentApi.patchItem(item.id, { brief: next })); }, 800);
  };
  const dirtyDraft = draft !== item.draft;
  const dirtyBrief = brief !== item.brief;
  const saving = busy === 'save' || busy === 'brief';
  const canApprove = Boolean(item.draft.trim()) && item.status !== 'approved' && item.status !== 'published';
  const approveHint = !item.draft.trim() ? 'Write a draft first' : item.status === 'approved' || item.status === 'published' ? `Already ${item.status}` : dirtyDraft || dirtyBrief ? 'Your edits save first, then it approves' : 'Sign off this version';
  const approveNow = () => run('approve', async () => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    if (briefTimer.current) clearTimeout(briefTimer.current);
    if (draft !== item.draft || brief !== item.brief) await contentApi.patchItem(item.id, { draft, brief });
    await contentApi.approve(item.id);
  });
  const ms = milestones.find(m => m.id === item.milestoneId);
  const copyText = [item.draft, (item.media?.hashtags ?? []).join(' ')].filter(Boolean).join('\n\n');
  const [copied, setCopied] = useState(false);
  const copyNow = async () => {
    try { await navigator.clipboard.writeText(copyText); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* clipboard unavailable: the text stays visible above */ }
  };
  return (
    <aside className="editor card" aria-label={`Editing ${item.title}`}>
      <div className="head"><KindChip kind={item.kind} /><span className={`badge ${item.status === 'published' || item.status === 'approved' ? 'done' : item.status === 'drafted' ? 'work' : 'wait'}`}><i />{item.status}</span><button className="x" onClick={onClose} aria-label="Close">×</button></div>
      <h3>{item.title}</h3>
      <p className="hint small">{fmt(item.date)}{ms ? ` · ${ms.title}` : ''}{item.shiftDays ? ` · moved ${item.shiftDays > 0 ? '+' : ''}${item.shiftDays} d by the projection` : ''} · {credit(item)}</p>
      <Checkpoints item={item} />
      <details className="tcard-chain editor-chain" open>
        <summary>How it got here</summary>
        <ChainLog item={item} />
      </details>
      {item.rationale && <p className="why"><b>Why</b> {item.rationale}</p>}
      {item.reusedFrom && <p className="hint small">Reused from {item.reusedFrom}</p>}
      {!!item.versionCount && <p className="hint small">{item.versionCount} approved version{item.versionCount > 1 ? 's' : ''} kept</p>}
      <label>Series <span className="opt">optional</span><input value={seriesName} list={`series-${item.id}`} onChange={e => setSeriesName(e.target.value)} onBlur={saveSeriesName} onKeyDown={e => e.key === 'Enter' && saveSeriesName()} placeholder="e.g. Beta diary" />
        <datalist id={`series-${item.id}`}>{series.map(s => <option key={s.id} value={s.name} />)}</datalist></label>
      <label>What it should say<textarea rows={2} value={brief} onChange={e => queueBriefSave(e.target.value)} onBlur={() => { if (briefTimer.current) clearTimeout(briefTimer.current); if (brief !== item.brief) void run('brief', () => contentApi.patchItem(item.id, { brief })); }} /></label>
      <div className="row">
        <button className="linkish" onClick={() => askAgent('writer', 'item', item.id)}>Ask the Writer →</button>
        <button className="primary" disabled={b} onClick={() => run('draft', () => contentApi.draft(item.id, ask.trim() || undefined))}>{busy === 'draft' ? 'The Writer is on it…' : item.draft ? 'Rewrite' : 'Have it written'}</button>
        <input value={ask} onChange={e => setAsk(e.target.value)} placeholder={item.draft ? 'Ask for a change: shorter, funnier…' : 'Direction (optional)'} onKeyDown={e => e.key === 'Enter' && item.draft && ask.trim() && run('revise', async () => { await contentApi.revise(item.id, ask.trim()); setAsk(''); })} />
        {item.draft && <button disabled={b || !ask.trim()} onClick={() => run('revise', async () => { await contentApi.revise(item.id, ask.trim()); setAsk(''); })}>{busy === 'revise' ? 'Revising…' : 'Revise'}</button>}
      </div>
      {SOCIAL_KINDS.includes(item.kind) && item.draft && <PostPreview item={item} />}
      {item.draft && <label>{SOCIAL_KINDS.includes(item.kind) ? 'Description' : 'Text'}<textarea className="draft" rows={10} value={draft} onChange={e => queueDraftSave(e.target.value)} />
        {(dirtyDraft || saving) && <span className="hint small">{saving ? 'Saving…' : 'Unsaved changes — saving shortly…'}</span>}
        {dirtyDraft && !saving && <span className="row"><button disabled={b} onClick={() => { if (draftTimer.current) clearTimeout(draftTimer.current); void run('save', () => contentApi.patchItem(item.id, { draft })); }}>Save now</button></span>}
      </label>}
      {SOCIAL_KINDS.includes(item.kind) && <PostBuilder item={item} reload={reload} />}
      <div className="row">
        <button disabled={b || !canApprove} title={approveHint} onClick={approveNow}>{busy === 'approve' ? 'Approving…' : dirtyDraft || dirtyBrief ? 'Save & approve' : 'Approve'}</button>
        {!!copyText && <button disabled={b} title="Copy the caption and hashtags to paste where your audience lives" onClick={() => void copyNow()}>{copied ? 'Copied' : 'Copy caption'}</button>}
        <button disabled={b || item.status !== 'approved'} title="Post it where your audience lives first, then record it here" onClick={() => run('publish', () => contentApi.publish(item.id))}>Mark posted</button>
        <label className="inline lock"><span>Lock date</span><input type="date" value={item.fixedDate ?? ''} onChange={e => run('date', () => e.target.value ? contentApi.patchItem(item.id, { fixedDate: e.target.value }) : contentApi.patchItem(item.id, { clearFixedDate: true }))} /></label>
        <button className="linkish" disabled={b} title="Start a new idea from this piece" onClick={() => run('reuse', async () => { const n = await contentApi.reuseItem(item.id); goItem(n.id); })}>{busy === 'reuse' ? 'Reusing…' : 'Reuse as new idea'}</button>
        <button className="linkish" disabled={b} onClick={() => run('rm', async () => { await contentApi.removeItem(item.id); onClose(); })}>Delete</button>
      </div>
      {item.exportedPath && <p className="hint small">Approved copy saved: <code>{item.exportedPath}</code></p>}
      {error && <p className="error">{error}</p>}
    </aside>
  );
}
