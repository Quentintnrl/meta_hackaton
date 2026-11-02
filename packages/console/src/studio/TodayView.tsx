import { contentApi, type AgentId, type ContentView, type TeamView } from '../api';
import { KindChip, credit, fmt, logicFor, useAction } from './shared';
import { IdeaDeck } from './Pieces';
import type { View } from './Studio';

// Today: decide, review, publish. Making things lives in Create.
export function TodayView({ team, view, reload, go, open, askAgent }: { team: TeamView; view: ContentView; reload: () => Promise<void>; go: (v: View) => void; open: (id: string) => void; askAgent: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void }) {
  const ideas = view.items.filter(i => i.status === 'idea');
  const briefed = view.items.filter(i => i.status === 'briefed');
  const toReview = view.items.filter(i => i.status === 'drafted');
  const toPublish = view.items.filter(i => i.status === 'approved');
  const done = view.items.filter(i => i.status === 'published');
  const todo = ideas.length + toReview.length + toPublish.length;
  const funnel: Array<[string, number]> = [['Ideas', ideas.length], ['Accepted', briefed.length], ['Drafts', toReview.length], ['Ready', toPublish.length], ['Posted', done.length]];
  return (
    <div className="stack">
      <div className="today">
        <div><b>{todo === 0 ? 'All caught up' : `${todo} for you`}</b>
          <span className="hint small">{ideas.length > 0 && `${ideas.length} to decide on`}{ideas.length > 0 && (toReview.length > 0 || toPublish.length > 0) && ' · '}{toReview.length > 0 && `${toReview.length} to review`}{(ideas.length > 0 || toReview.length > 0) && toPublish.length > 0 && ' · '}{toPublish.length > 0 && `${toPublish.length} to post`}</span></div>
        <button onClick={() => go('create')}>+ Make something</button>
      </div>
      <section className="card funnel" aria-label="Where your content stands">
        {funnel.map(([label, n], k) => (
          <div key={label} className="fstep"><b>{n}</b><span>{label}</span>{k < funnel.length - 1 && <i aria-hidden>→</i>}</div>
        ))}
      </section>

      {ideas.length > 0 && <IdeaDeck key={ideas[0].id} ideas={ideas} milestones={view.milestones} reload={reload} askAgent={askAgent} />}

      {toReview.length > 0 && (
        <section className="card">
          <div className="head"><h3>Review <span className="count">{toReview.length}</span></h3></div>
          <ul className="rows">{toReview.map(i => (
            <li key={i.id}><button onClick={() => open(i.id)}><span className="rowmain"><KindChip kind={i.kind} /> <b>{i.title}</b></span><span className="hint small">{credit(i)}{logicFor(i) ? ` · ${logicFor(i)}` : ''} · Open →</span></button>
              <span className="row"><button className="linkish" onClick={() => askAgent('writer', 'item', i.id)}>Ask the Writer →</button></span></li>
          ))}</ul>
        </section>
      )}

      {toPublish.length > 0 && <PublishQueue items={toPublish} reload={reload} open={open} />}

      {team.synthesis && (
        <button className="note-line" onClick={() => go('agent:director')}><b>Director:</b> {team.synthesis.data.headline} <span>Ask →</span></button>
      )}

      {todo === 0 && (
        <section className="card guide"><h3>How a piece moves</h3>
          <ol className="steps big">
            <li><span className="tick">1</span><span><b>Brief the team</b> in <button className="linkish" onClick={() => go('create')}>Create</button>: it proposes ideas grounded in field research and your numbers.</span></li>
            <li><span className="tick">2</span><span><b>You judge here</b>: yes writes it, no teaches the team, keep for later parks it.</span></li>
            <li><span className="tick">3</span><span><b>Copy the caption, post it</b> where your audience lives, then mark it posted. The team learns from the winners.</span></li>
          </ol>
          <div className="row"><button className="primary" onClick={() => go('create')}>Brief the team</button><button className="linkish" onClick={() => go('calendar')}>See the calendar →</button></div></section>
      )}
    </div>
  );
}

// Signed off, not out yet: post it where your audience lives, then mark it here. No Meta app involved.
function PublishQueue({ items, reload, open }: { items: ContentView['items']; reload: () => Promise<void>; open: (id: string) => void }) {
  const { busy, error, run } = useAction(reload);
  const copy = (id: string) => {
    const i = items.find(x => x.id === id);
    if (!i) return;
    const text = [i.draft, (i.media?.hashtags ?? []).join(' ')].filter(Boolean).join('\n\n');
    void navigator.clipboard.writeText(text).catch(() => {});
  };
  return (
    <section className="card">
      <div className="head"><h3>To post <span className="count">{items.length}</span></h3></div>
      <ul className="rows">{items.map(i => (
        <li key={i.id}><button onClick={() => open(i.id)}><span className="rowmain"><KindChip kind={i.kind} /> <b>{i.title}</b></span><span className="hint small">{fmt(i.date)}{logicFor(i) ? ` · ${logicFor(i)}` : ''} · Open →</span></button>
          <span className="row"><button disabled={busy !== ''} onClick={() => copy(i.id)}>Copy caption</button><button className="primary" disabled={busy !== ''} onClick={() => run(`pub-${i.id}`, () => contentApi.publish(i.id))}>{busy === `pub-${i.id}` ? 'Recording…' : 'Mark posted'}</button></span></li>
      ))}</ul>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
