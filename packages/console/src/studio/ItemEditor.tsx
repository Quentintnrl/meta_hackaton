import { useEffect, useState } from 'react';
import { contentApi, SOCIAL_KINDS, type ContentItem, type Milestone } from '../api';
import { PostBuilder, PostPreview } from './PostBuilder';
import { KindChip, fmt, useAction } from './shared';

// The working surface of one piece: say what you want, let the Writer draft, ask for changes, sign off.
export function ItemEditor({ item, milestones, reload, onClose }: { item: ContentItem; milestones: Milestone[]; reload: () => Promise<void>; onClose: () => void }) {
  const { busy, error, run } = useAction(reload);
  const [brief, setBrief] = useState(item.brief);
  const [draft, setDraft] = useState(item.draft);
  const [ask, setAsk] = useState('');
  useEffect(() => { setBrief(item.brief); setDraft(item.draft); }, [item.id, item.brief, item.draft]);
  const b = busy !== '';
  const ms = milestones.find(m => m.id === item.milestoneId);
  return (
    <aside className="editor card" aria-label={`Editing ${item.title}`}>
      <div className="head"><KindChip kind={item.kind} /><span className={`badge ${item.status === 'published' || item.status === 'approved' ? 'done' : item.status === 'drafted' ? 'work' : 'wait'}`}><i />{item.status}</span><button className="x" onClick={onClose} aria-label="Close">×</button></div>
      <h3>{item.title}</h3>
      <p className="hint small">{fmt(item.date)}{ms ? ` · ${ms.title}` : ''}{item.shiftDays ? ` · moved ${item.shiftDays > 0 ? '+' : ''}${item.shiftDays} d by the projection` : ''}</p>
      {item.rationale && <p className="why"><b>Why</b> {item.rationale}</p>}
      <label>What it should say<textarea rows={2} value={brief} onChange={e => setBrief(e.target.value)} onBlur={() => brief !== item.brief && run('brief', () => contentApi.patchItem(item.id, { brief }))} /></label>
      <div className="row">
        <button className="primary" disabled={b} onClick={() => run('draft', () => contentApi.draft(item.id, ask.trim() || undefined))}>{busy === 'draft' ? 'The Writer is on it…' : item.draft ? 'Rewrite' : 'Have it written'}</button>
        <input value={ask} onChange={e => setAsk(e.target.value)} placeholder={item.draft ? 'Ask for a change: shorter, funnier…' : 'Direction (optional)'} onKeyDown={e => e.key === 'Enter' && item.draft && ask.trim() && run('revise', async () => { await contentApi.revise(item.id, ask.trim()); setAsk(''); })} />
        {item.draft && <button disabled={b || !ask.trim()} onClick={() => run('revise', async () => { await contentApi.revise(item.id, ask.trim()); setAsk(''); })}>{busy === 'revise' ? 'Revising…' : 'Revise'}</button>}
      </div>
      {SOCIAL_KINDS.includes(item.kind) && item.draft && <PostPreview item={item} />}
      {item.draft && <label>{SOCIAL_KINDS.includes(item.kind) ? 'Description' : 'Text'}<textarea className="draft" rows={10} value={draft} onChange={e => setDraft(e.target.value)} />
        {draft !== item.draft && <span className="row"><button disabled={b} onClick={() => run('save', () => contentApi.patchItem(item.id, { draft }))}>Save my edits</button></span>}
      </label>}
      {SOCIAL_KINDS.includes(item.kind) && (item.draft || item.media) && <PostBuilder item={item} reload={reload} />}
      <div className="row">
        <button disabled={b || !item.draft || draft !== item.draft || item.status === 'approved' || item.status === 'published'} onClick={() => run('approve', () => contentApi.approve(item.id))}>Approve</button>
        <button disabled={b || item.status !== 'approved'} onClick={() => run('publish', () => contentApi.publish(item.id))}>Mark published</button>
        <label className="inline lock"><span>Lock date</span><input type="date" value={item.fixedDate ?? ''} onChange={e => run('date', () => e.target.value ? contentApi.patchItem(item.id, { fixedDate: e.target.value }) : contentApi.patchItem(item.id, { clearFixedDate: true }))} /></label>
        <button className="linkish" disabled={b} onClick={() => run('rm', async () => { await contentApi.removeItem(item.id); onClose(); })}>Delete</button>
      </div>
      {item.exportedPath && <p className="hint small">Approved copy saved: <code>{item.exportedPath}</code></p>}
      {error && <p className="error">{error}</p>}
    </aside>
  );
}
