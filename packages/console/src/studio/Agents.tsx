import type { AgentId, TeamView } from '../api';
import { AGENT_HUE } from './shared';

const GLYPH: Record<AgentId, string> = { scout: 'M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z', analyst: 'M4 20V10h3v10H4Zm6.5 0V4h3v16h-3ZM17 20v-7h3v7h-3Z', strategist: 'M12 2 3 7v2h18V7l-9-5Zm-7 9v7H3v2h18v-2h-2v-7h-2v7h-3v-7h-2v7h-2v-7H9v7H7v-7H5Z', writer: 'M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25ZM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z' };

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
