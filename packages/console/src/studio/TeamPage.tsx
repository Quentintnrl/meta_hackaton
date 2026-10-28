import { teamApi, type AgentId, type TeamView } from '../api';
import { AGENT_HUE, ago, useAction } from './shared';
import { Avatar, agentState } from './Agents';

// The detail behind the studio header: each agent, what it last said, and the full log.
export function TeamPage({ pid, team, reload }: { pid: string; team: TeamView; reload: () => Promise<void> }) {
  const { busy, error, run } = useAction(reload);
  const working = Boolean(team.working);
  return (
    <div className="stack">
      <div className="agents">{team.agents.map(a => {
        const state = agentState(team, a.id);
        const last = team.activity.find(x => x.agent === a.id);
        return (
          <section key={a.id} className={`card agent ${state}`} style={{ ['--h' as string]: AGENT_HUE[a.id] }}>
            <Avatar id={a.id} state={state} />
            <div><b>{a.name}</b><p className="hint small">{a.role}</p></div>
            <p className="said">{state === 'working' ? 'Working on it…' : last ? <>{last.ok ? '' : 'Stuck: '}{last.summary}</> : 'Has not worked yet.'}</p>
            <button disabled={working || busy !== ''} onClick={() => run('a', () => teamApi.run(pid, [a.id as AgentId], ''))}>Run only {a.name}</button>
          </section>
        );
      })}</div>
      {error && <p className="error">{error}</p>}
      <section className="card"><h3>Activity</h3>
        {team.activity.length === 0 ? <p className="hint">Nothing yet.</p> : <ul className="feed">{team.activity.map(a => (
          <li key={a.id} style={{ ['--h' as string]: AGENT_HUE[a.agent] }}><i className="dot" /><b>{team.agents.find(x => x.id === a.agent)?.name}</b> <span className={a.ok ? '' : 'error'}>{a.summary}</span><time>{ago(a.at)}</time></li>
        ))}</ul>}
      </section>
    </div>
  );
}
