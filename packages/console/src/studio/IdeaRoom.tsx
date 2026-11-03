import { useEffect, useState } from 'react';
import { contentApi, teamApi, type AgentId, type ContentItem, type ContentView, type TeamView } from '../api';
import { TeamChat } from './Chat';
import { ChainLog, Checkpoints } from './Chain';
import { ProofCard } from './Numbers';
import { KindChip, SOURCE, fmt, logicFor, useAction } from './shared';

// The ideation of one post, in a room of its own: everything the Strategist saw, the shape it proposes, the numbers it leans on,
// a conversation to push the idea further, and the decision. Nothing is written until the manager says yes here.

export function IdeaRoom({ pid, item, view, team, reload, onClose }: { pid: string; item: ContentItem; view: ContentView; team: TeamView; reload: () => Promise<void>; onClose: () => void; askAgent?: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void }) {
  const { busy, error, run } = useAction(reload);
  const [brief, setBrief] = useState(item.brief);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => { setBrief(item.brief); }, [item.id, item.brief]);
  const [why, evidence] = item.rationale.split('\nEvidence: ');
  const ms = view.milestones.find(m => m.id === item.milestoneId);
  const date = item.fixedDate ?? item.date;
  const hook = item.pitch?.hook || (item.draft ? item.draft.split('\n')[0] : '');
  const stats = team.account?.data.stats ?? [];
  const source = item.source ? SOURCE[item.source] : undefined;
  const logic = logicFor(item);
  const saveBrief = () => { if (brief !== item.brief) void run('brief', () => contentApi.patchItem(item.id, { brief })); };
  const context = `Piece "${item.title}" (${item.kind}, ${item.status}). Brief: ${item.brief || '(none)'}${item.rationale ? ` Why it was suggested: ${item.rationale}` : ''}${item.pitch ? ` Pitch: hook "${item.pitch.hook}", channel ${item.pitch.channel}, measure ${item.pitch.measure}.` : ''}`;
  const [lock, setLock] = useState<AgentId | undefined>(undefined);
  const b = busy !== '';
  return (
    <div className="room-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="room" role="dialog" aria-modal="true" aria-label={`The idea: ${item.title}`}>
        <header className="room-head">
          <div className="room-meta"><KindChip kind={item.kind} />{item.pitch?.channel && <span className="chip">{item.pitch.channel}</span>}<span className="hint small">{fmt(date)}{ms ? ` · for ${ms.title}` : ''}</span>{source && <span className="src-badge" title={source.hint}>{source.label}</span>}</div>
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="room-body">
          <div className="room-main">
            <p className="room-hook">{hook ? `“${hook}”` : item.title}</p>
            {hook && <h2 className="room-title">{item.title}</h2>}
            {logic && <p className="room-logic">Proposed because {logic}.</p>}

            <div className="room-grid">
              {item.pitch?.context && <section className="room-sec"><h4>The situation it answers</h4><p>{item.pitch.context}</p></section>}
              {item.pitch?.audience && <section className="room-sec"><h4>Who reads it</h4><p>{item.pitch.audience}</p></section>}
              {why && <section className="room-sec wide"><h4>Why this piece, now</h4><p>{why}</p>{evidence && <p className="hint small">Behind it: {evidence}</p>}</section>}
              {item.pitch?.measure && <section className="room-sec"><h4>We will know it worked by</h4><p>{item.pitch.measure}</p></section>}
              <section className="room-sec"><h4>Where and when</h4>
                <p>{item.pitch?.channel || 'Channel not set'}{ms ? `, around ${ms.title}` : ''}</p>
                <label className="inline lock"><span>Lock the date</span><input type="date" value={item.fixedDate ?? ''} onChange={e => run('date', () => e.target.value ? contentApi.patchItem(item.id, { fixedDate: e.target.value }) : contentApi.patchItem(item.id, { clearFixedDate: true }))} /></label>
              </section>
            </div>

            {item.proof && <ProofCard proof={item.proof} stats={stats} simulated={team.account?.simulated} />}

            <section className="room-sec wide brief-sec">
              <h4>What it should say <span className="hint small">your words, read by the Writer before it writes</span></h4>
              <textarea rows={3} value={brief} onChange={e => setBrief(e.target.value)} onBlur={saveBrief} placeholder="Add the angle, the facts to keep, the words to avoid…" />
              {busy === 'brief' && <span className="hint small">Saving…</span>}
            </section>

            <section className="room-sec wide">
              <h4>Where it stands</h4>
              <Checkpoints item={item} />
              <ChainLog item={item} />
            </section>
          </div>

          <aside className="room-side">
            <h4>Push the idea with the team</h4>
            <p className="hint small">They already see everything on the left. Angles go to the Strategist, lines to the Writer, numbers to the Analyst; what you decide stays yours.</p>
            <TeamChat pid={pid} team={team} view={view} base="team" subject={{ key: `item:${item.id}`, label: item.title, context, item }} lock={lock} hint="idea" reload={reload} onLock={setLock} tall />
          </aside>
        </div>

        <footer className="room-foot">
          {refusing ? (
            <div className="refuse">
              <input autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="Why not? The Strategist remembers it next time." onKeyDown={e => e.key === 'Enter' && run('no', async () => { await teamApi.reject(item.id, reason); onClose(); })} />
              <button disabled={b} onClick={() => run('no', async () => { await teamApi.reject(item.id, reason); onClose(); })}>Refuse</button>
              <button className="linkish" onClick={() => setRefusing(false)}>Cancel</button>
            </div>
          ) : (
            <>
              <button className="primary big" disabled={b} title="The Writer writes it now: about 30 seconds, one model call" onClick={() => run('yes', async () => { saveBrief(); await teamApi.accept(item.id); await contentApi.draft(item.id); })}>{busy === 'yes' ? 'The Writer is on it…' : 'Yes, write it'}</button>
              <button disabled={b} onClick={() => run('keep', async () => { await teamApi.accept(item.id); onClose(); })}>Keep for later</button>
              <button disabled={b} onClick={() => setRefusing(true)}>No</button>
              <span className="hint small room-foot-hint">Yes sends it to the Writer with your words above (about 30 seconds). Later keeps it accepted without writing. No teaches the team.</span>
            </>
          )}
          {error && <p className="error">{error}</p>}
        </footer>
      </section>
    </div>
  );
}
