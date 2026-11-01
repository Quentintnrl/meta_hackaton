import { contentApi, type AgentId, type ContentView, type TeamView } from '../api';
import { KindChip, credit, fmt, useAction } from './shared';
import { IdeaDeck } from './Pieces';
import type { View } from './Studio';

// Today: decide, review, publish. Making things lives in Create.
export function TodayView({ team, view, reload, go, open, askAgent }: { team: TeamView; view: ContentView; reload: () => Promise<void>; go: (v: View) => void; open: (id: string) => void; askAgent: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void }) {
  const ideas = view.items.filter(i => i.status === 'idea');
  const toReview = view.items.filter(i => i.status === 'drafted');
  const toPublish = view.items.filter(i => i.status === 'approved');
  const todo = ideas.length + toReview.length + toPublish.length;
  return (
    <div className="stack">
      <div className="today">
        <div><b>{todo === 0 ? 'All caught up' : `${todo} for you`}</b>
          <span className="hint small">{ideas.length > 0 && `${ideas.length} to decide on`}{ideas.length > 0 && (toReview.length > 0 || toPublish.length > 0) && ' · '}{toReview.length > 0 && `${toReview.length} to review`}{(ideas.length > 0 || toReview.length > 0) && toPublish.length > 0 && ' · '}{toPublish.length > 0 && `${toPublish.length} to publish`}</span></div>
        <button onClick={() => go('create')}>+ Make something</button>
      </div>

      {ideas.length > 0 && <IdeaDeck key={ideas[0].id} ideas={ideas} milestones={view.milestones} reload={reload} askAgent={askAgent} />}

      {toReview.length > 0 && (
        <section className="card">
          <div className="head"><h3>Review <span className="count">{toReview.length}</span></h3></div>
          <ul className="rows">{toReview.map(i => (
            <li key={i.id}><button onClick={() => open(i.id)}><span className="rowmain"><KindChip kind={i.kind} /> <b>{i.title}</b></span><span className="hint small">{credit(i)} · Open →</span></button>
              <span className="row"><button className="linkish" onClick={() => askAgent('writer', 'item', i.id)}>Ask the Writer →</button></span></li>
          ))}</ul>
        </section>
      )}

      {toPublish.length > 0 && <PublishQueue items={toPublish} reload={reload} open={open} />}

      {team.synthesis && (
        <button className="note-line" onClick={() => go('agent:director')}><b>Director:</b> {team.synthesis.data.headline} <span>Ask →</span></button>
      )}

      {todo === 0 && (
        <section className="card empty"><h3>Nothing needs you</h3><p>Make something new, or check the <button className="linkish" onClick={() => go('calendar')}>calendar</button>.</p>
          <div className="row"><button className="primary" onClick={() => go('create')}>Create</button></div></section>
      )}
    </div>
  );
}

// Signed off, not out yet: post it where your audience lives, then mark it here.
function PublishQueue({ items, reload, open }: { items: ContentView['items']; reload: () => Promise<void>; open: (id: string) => void }) {
  const { busy, error, run } = useAction(reload);
  return (
    <section className="card">
      <div className="head"><h3>Publish <span className="count">{items.length}</span></h3></div>
      <ul className="rows">{items.map(i => (
        <li key={i.id}><button onClick={() => open(i.id)}><span className="rowmain"><KindChip kind={i.kind} /> <b>{i.title}</b></span><span className="hint small">{fmt(i.date)} · Open →</span></button>
          <span className="row"><button className="primary" disabled={busy !== ''} onClick={() => run(`pub-${i.id}`, () => contentApi.publish(i.id))}>{busy === `pub-${i.id}` ? 'Publishing…' : 'Mark published'}</button></span></li>
      ))}</ul>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
