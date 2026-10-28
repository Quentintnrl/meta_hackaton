import { teamApi, type AgentId, type ContentView, type TeamView } from '../api';
import { AGENT_HUE, ago, useAction } from './shared';
import { Avatar, agentState } from './Agents';
import { Chat } from './Chat';
import type { View } from './Studio';

const UNIT: Record<string, string> = { scout: 'researcher', analyst: 'analyst', strategist: 'strategist', writer: 'writer' };

// How many of an agent work at once: the manager's lever on cost and depth.
export function Workers({ agent, value, disabled, onChange }: { agent: AgentId; value: number; disabled?: boolean; onChange: (n: number) => void }) {
  const fixed = agent === 'analyst' || agent === 'director';
  return (
    <div className="stepper" aria-label={`${agent} workers`}>
      <button disabled={disabled || fixed || value <= 1} onClick={() => onChange(value - 1)} aria-label="Fewer">−</button>
      <span className="dots">{[1, 2, 3].map(n => <i key={n} className={n <= value ? 'on' : ''} />)}</span>
      <button disabled={disabled || fixed || value >= 3} onClick={() => onChange(value + 1)} aria-label="More">+</button>
    </div>
  );
}

export function Switch({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><i /></button>;
}

// The org chart: the director on top, its four agents below, each with its own dials.
function OrgChart({ pid, team, go, reload }: { pid: string; team: TeamView; go: (v: View) => void; reload: () => Promise<void> }) {
  const { busy, run } = useAction(reload);
  const crew = team.agents.filter(a => a.id !== 'director');
  const set = (a: AgentId, patch: Parameters<typeof teamApi.configure>[2]) => run('cfg', () => teamApi.configure(pid, a, patch));
  return (
    <section className="card org">
      <button className="node lead" style={{ ['--h' as string]: AGENT_HUE.director }} onClick={() => go('agent:director')}>
        <Avatar id="director" state={agentState(team, 'director')} />
        <span><b>Director</b><small>{team.working?.agent === 'director' ? 'Writing the summary…' : 'Leads the team · talk to it first'}</small></span>
      </button>
      <div className="trunk" aria-hidden />
      <div className="crew">{crew.map(a => {
        const c = team.config[a.id];
        const st = agentState(team, a.id);
        return (
          <div key={a.id} className={`node ${st} ${c.enabled ? '' : 'off'}`} style={{ ['--h' as string]: AGENT_HUE[a.id] }}>
            <button className="nodehead" onClick={() => go(`agent:${a.id}`)}>
              <Avatar id={a.id} state={st} size={36} />
              <span><b>{a.name}</b><small>{!c.enabled ? 'Switched off' : st === 'working' ? 'Working…' : st === 'failed' ? 'Stuck' : 'Ready'}</small></span>
            </button>
            <div className="dial"><span className="hint small">{c.workers} {UNIT[a.id]}{c.workers > 1 ? 's' : ''}</span><Workers agent={a.id} value={c.workers} disabled={busy !== '' || !c.enabled} onChange={n => set(a.id, { workers: n })} /></div>
            <div className="dial"><span className="hint small">{c.enabled ? 'On' : 'Off'}</span><Switch on={c.enabled} disabled={busy !== ''} onChange={v => set(a.id, { enabled: v })} label={`${a.name} on or off`} /></div>
          </div>
        );
      })}</div>
    </section>
  );
}

export function DirectorPage({ pid, team, view, reload, go }: { pid: string; team: TeamView; view: ContentView; reload: () => Promise<void>; go: (v: View) => void }) {
  const waiting = view.items.filter(i => i.status === 'idea').length;
  const s = team.synthesis;
  return (
    <div className="stack">
      <OrgChart pid={pid} team={team} go={go} reload={reload} />
      <div className="director-grid">
        <section className="card">
          <h3>Talk to the Director</h3>
          <p className="hint small">Say what you want. It answers, proposes what to run or change, and sends you to the right agent when you need to talk to them directly.</p>
          <Chat pid={pid} agent="director" reload={reload} goAgent={a => go(`agent:${a}`)} placeholder="e.g. Prepare the beta, and look deeper at what works…"
            starters={['What should we do this week?', 'Do a deeper field research', 'Why is the beta late, and what should we post?']} />
        </section>
        <div className="stack">
          <section className="card">
            <h3>Latest summary</h3>
            {s ? <><p className="lead"><b>{s.data.headline}</b></p><ul className="plain">{s.data.points.map(p => <li key={p}>{p}</li>)}</ul><p className="next"><b>Next</b> {s.data.next}</p><p className="hint small">{ago(s.at)}</p></> : <p className="hint">No summary yet. After the team has worked, the Director sums it up here.</p>}
          </section>
          <section className="card">
            <h3>Right now</h3>
            <ul className="plain">
              <li><button className="linkish tight" onClick={() => go('inbox')}>{waiting} proposal{waiting === 1 ? '' : 's'}</button> waiting for you</li>
              <li>{team.accountPosts} posts loaded · field research {team.audit ? 'done' : 'not done'}</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
