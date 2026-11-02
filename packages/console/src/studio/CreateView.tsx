import type { AgentId, ContentView, TeamView } from '../api';
import { AskPanel, BriefedList } from './Pieces';
import type { View } from './Studio';

// Create: ask the team for ideas, start what was accepted. Deciding and
// reviewing happen in Today.
export function CreateView({ pid, team, view, reload, go, open, askAgent }: { pid: string; team: TeamView; view: ContentView; reload: () => Promise<void>; go: (v: View) => void; open: (id: string) => void; askAgent: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void }) {
  const briefed = view.items.filter(i => i.status === 'briefed');
  const grounded = [team.audit ? 'field research: done' : 'field research: missing', `${team.accountPosts} posts loaded`];
  return (
    <div className="stack">
      <section className="card grounding" aria-label="What the next proposals will be grounded in">
        <div><b>Ideas are born here, grounded in what the team knows.</b>
          <span className="hint small"> {grounded.join(' · ')}. Without research or numbers, proposals come as early sketches — still useful, but check them.</span></div>
        {!team.audit && <span className="hint small">Tip: brief the team below and the Scout researches first.</span>}
      </section>
      <AskPanel pid={pid} team={team} view={view} go={go} reload={reload} />
      {briefed.length > 0 && <BriefedList pid={pid} briefed={briefed} autoDraft={view.profile.autoDraft} reload={reload} go={go} open={open} askAgent={askAgent} />}
      {briefed.length === 0 && (
        <section className="card empty"><h3>Nothing waiting</h3><p>Accepted ideas appear here to be written. New ideas land in <button className="linkish" onClick={() => go('today')}>Today</button> when ready.</p></section>
      )}
    </div>
  );
}
