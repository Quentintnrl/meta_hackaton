import type { AgentId, TeamView } from '../api';
import { AGENT_HUE, ago } from './shared';

// What each agent does, in the manager's words. Read on the Team page, the agent pages and the brief.
export const ABOUT: Record<Exclude<AgentId, 'director'>, { does: string; workers: string; ideas: string[]; starters: string[] }> = {
  scout: { does: 'Searches the web for what works in your field.', workers: 'Each extra researcher takes another angle (formats, hooks and topics, what flops) at the same time.', ideas: ['Only look at video formats', 'Ignore big brands, focus on solo developers', 'Always cite recent examples'], starters: ['What did you find?', 'Look only at video formats from now on', 'How reliable are your sources?'] },
  analyst: { does: 'Compares your account with what the Scout found.', workers: 'One analyst is enough: it reads all your posts.', ideas: ['Weigh shares more than likes', 'Compare only the last 3 months', 'Be blunt about what does not work'], starters: ['What is my weakest format?', 'Be blunter in your analysis', 'How do you measure engagement?'] },
  strategist: { does: 'Reads your roadmap and proposes content, with its evidence.', workers: 'Each extra strategist looks through another lens (roadmap, your account, field trends) and the proposals are merged.', ideas: ['Always propose one video', 'Max 3 proposals at a time', 'Favour posts tied to a milestone'], starters: ['Why these proposals?', 'Propose fewer, better ideas', 'Focus on the beta launch'] },
  writer: { does: 'Drafts what you accept: caption, hashtags, slides or storyboard.', workers: 'Extra writers draft several accepted pieces at the same time.', ideas: ['Shorter captions, max 3 hashtags', 'Always end with a question', 'More humour, fewer adjectives'], starters: ['Write shorter captions from now on', 'Always end with a question', 'What do you draft first?'] },
};


const GLYPH: Record<AgentId, string> = { director: 'M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17l-6.1 3.6 1.4-6.8L2.2 9.1l6.9-.8L12 2Z', scout: 'M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z', analyst: 'M4 20V10h3v10H4Zm6.5 0V4h3v16h-3ZM17 20v-7h3v7h-3Z', strategist: 'M12 2 3 7v2h18V7l-9-5Zm-7 9v7H3v2h18v-2h-2v-7h-2v7h-3v-7h-2v7h-2v-7H9v7H7v-7H5Z', writer: 'M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25ZM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z' };

export type AgentState = 'working' | 'failed' | 'idle';
export const agentState = (team: TeamView, id: AgentId): AgentState => {
  if (team.working?.agent === id) return 'working';
  const last = team.activity.find(a => a.agent === id);
  return last && !last.ok ? 'failed' : 'idle';
};

export function Avatar({ id, state, size = 40 }: { id: AgentId; state: AgentState; size?: number }) {
  return (
    <div className={`avatar ${state}`} style={{ ['--h' as string]: AGENT_HUE[id], width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size / 2} height={size / 2} aria-hidden><path d={GLYPH[id]} fill="currentColor" /></svg><i />
    </div>
  );
}

// Always visible in the studio header: who is doing what, without taking any room.
export function TeamPulse({ team, onOpen }: { team: TeamView; onOpen: () => void }) {
  const w = team.working && team.agents.find(a => a.id === team.working!.agent);
  return (
    <button className="pulse" onClick={onOpen} title="Open the team">
      <span className="stack-av">{team.agents.map(a => <Avatar key={a.id} id={a.id} state={agentState(team, a.id)} size={26} />)}</span>
      <span className="pulse-text">{w ? `${w.name} is working…` : 'Team is idle'}</span>
    </button>
  );
}

// The team's log, newest first: who did what, when, and whether it went well. The same strip on Today and on
// the brief page, so the work is always visibly the team's, with a time on it.
export function TeamLog({ team, n = 4, onOpen, title }: { team: TeamView; n?: number; onOpen: (id: AgentId) => void; title?: string }) {
  const w = team.working && team.agents.find(a => a.id === team.working!.agent);
  const lines = team.activity.slice(0, n);
  return (
    <section className="card tlog" aria-live="polite">
      <div className="head"><h3>{title ?? 'The team right now'}</h3><span className="hint small">{w ? 'Working' : lines[0] ? `Last activity ${ago(lines[0].at)}` : 'Idle'}</span></div>
      {w && <div className="tl-line working"><Avatar id={w.id} state="working" size={30} /><span><b>{w.name}</b> is working<span className="typing"><i /><i /><i /></span><small>since {ago(team.working!.since)}</small></span></div>}
      {lines.map(a => { const who = team.agents.find(x => x.id === a.agent); return (
        <button key={a.id} className={`tl-line ${a.ok ? '' : 'failed'}`} onClick={() => onOpen(a.agent)}>
          <Avatar id={a.agent} state={a.ok ? 'idle' : 'failed'} size={30} />
          <span><b>{who?.name ?? a.agent}</b> {a.summary}<small>{ago(a.at)}{a.ok ? '' : ' · failed'}</small></span>
        </button>
      ); })}
      {!w && lines.length === 0 && <p className="hint">The team has not worked yet. Brief it and its work shows up here, line by line.</p>}
    </section>
  );
}
