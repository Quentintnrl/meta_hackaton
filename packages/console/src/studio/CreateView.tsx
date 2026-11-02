import { useState } from 'react';
import { teamApi, type AgentId, type ContentView, type TeamView } from '../api';
import { ABOUT, Avatar, TeamLog, agentState } from './Agents';
import { BriefedList } from './Pieces';
import { ago, useAction } from './shared';
import type { View } from './Studio';

type Runnable = 'scout' | 'analyst' | 'strategist';
const STEPS: Array<[Runnable, string]> = [['scout', 'Research the field'], ['analyst', 'Score your posts'], ['strategist', 'Propose ideas']];

// Brief: say what you want, pick who works, send. The ideas land in Today; nothing is written before you say yes.
export function CreateView({ pid, team, view, reload, go, open, askAgent }: { pid: string; team: TeamView; view: ContentView; reload: () => Promise<void>; go: (v: View) => void; open: (id: string) => void; askAgent: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void }) {
  const [brief, setBrief] = useState('');
  const [who, setWho] = useState<Runnable[]>(() => STEPS.map(([id]) => id).filter(id => team.config[id].enabled));
  const { busy, error, run } = useAction(reload);
  const working = Boolean(team.working);
  const briefed = view.items.filter(i => i.status === 'briefed');
  const toggle = (id: Runnable) => setWho(w => w.includes(id) ? w.filter(x => x !== id) : [...w, id]);
  const send = () => run('run', async () => { await teamApi.run(pid, who, brief.trim()); setBrief(''); });
  const last = (id: AgentId) => team.activity.find(a => a.agent === id);
  const detail: Record<Runnable, string> = {
    scout: `${team.config.scout.workers} researcher${team.config.scout.workers > 1 ? 's' : ''} search the web and keep the figures with their source.${team.audit ? ` Last research ${ago(team.audit.at)}.` : ' Not done yet.'}`,
    analyst: team.accountPosts ? `Scores your ${team.accountPosts} loaded posts per format and finds the gaps.` : 'No posts loaded yet: it will have nothing to score.',
    strategist: `Turns the research, your numbers and your roadmap into ideas, each with its proof. Refusals teach it.`,
  };
  const noVoice = !(view.profile.voice || view.profile.audience || view.profile.niche || view.profile.directives);
  return (
    <div className="stack">
      <section className="card brief-hero">
        <h3>What do you want?</h3>
        <textarea rows={3} value={brief} onChange={e => setBrief(e.target.value)} placeholder="e.g. Get people excited about the beta. Or leave empty: the team works from your roadmap and your numbers." onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }} />
        <div className="chips">{['Prepare the next release', 'More like what works for us', 'Refresh the field research'].map(q => <button key={q} className="chip" onClick={() => setBrief(q)}>{q}</button>)}</div>

        <h4 className="mini">Who works on it</h4>
        <div className="runwho">{STEPS.map(([id, label], k) => {
          const on = who.includes(id); const off = !team.config[id].enabled; const l = last(id);
          return (
            <label key={id} className={`runstep ${on && !off ? 'on' : ''}`}>
              <input type="checkbox" checked={on && !off} disabled={off || working} onChange={() => toggle(id)} />
              <span className="runno">{k + 1}</span>
              <Avatar id={id} state={agentState(team, id)} size={34} />
              <span className="runtext"><b>{label}</b><small>{off ? `The ${id} is switched off in Team.` : detail[id]}</small>{l && !off && <small className="hint">Last time: “{l.summary}” · {ago(l.at)}</small>}</span>
            </label>
          );
        })}
          <div className="runstep end"><span className="runno">4</span><span className="runtext"><b>You decide, in Today</b><small>Each idea comes with its reasons and numbers. Yes sends it to the Writer; no teaches the team.</small></span></div>
        </div>

        <div className="row brief-send">
          <button className="primary big" disabled={busy !== '' || working || who.length === 0} onClick={send}>{working ? 'The team is working…' : busy ? 'Sending…' : 'Send the brief'}</button>
          <span className="hint small">{who.length === 0 ? 'Pick at least one step.' : 'Takes a minute or two. Nothing is written before you say yes.'}</span>
        </div>
        {noVoice && <p className="hint small">The team writes better when it knows your voice. <button className="linkish" onClick={() => go('team')}>Tell it about your project →</button></p>}
        {error && <p className="error">{error}</p>}
      </section>

      <TeamLog team={team} n={6} title="What the team did" onOpen={a => go(`agent:${a}`)} />

      {briefed.length > 0 ? <BriefedList pid={pid} briefed={briefed} autoDraft={view.profile.autoDraft} reload={reload} go={go} open={open} askAgent={askAgent} />
        : <p className="hint small">Ideas you accept in <button className="linkish tight" onClick={() => go('today')}>Today</button> wait here until the Writer drafts them.</p>}
      <p className="hint small">Want to talk instead of briefing? <button className="linkish tight" onClick={() => askAgent('director')}>Ask the Director →</button></p>
    </div>
  );
}
