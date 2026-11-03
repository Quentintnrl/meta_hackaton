import { useEffect, useState } from 'react';
import { teamApi, type AgentId, type ContentView, type TeamView } from '../api';
import { AGENT_HUE, ago, useAction } from './shared';
import { ABOUT, Avatar, agentState } from './Agents';
export { ABOUT };
import { TeamChat, type Subject } from './Chat';
import { Switch, Workers } from './DirectorPage';
import type { View } from './Studio';


export function AgentPage({ pid, agent, team, view, reload, go, subject, onClearAbout }: { pid: string; agent: Exclude<AgentId, 'director'>; team: TeamView; view: ContentView; reload: () => Promise<void>; go: (v: View) => void; subject?: Subject; onClearAbout?: () => void }) {
  const info = team.agents.find(a => a.id === agent)!;
  const about = ABOUT[agent];
  const cfg = team.config[agent];
  const st = agentState(team, agent);
  const [text, setText] = useState(cfg.instructions);
  useEffect(() => setText(cfg.instructions), [cfg.instructions, agent]);
  const { busy, error, run } = useAction(reload);
  const mine = team.activity.filter(a => a.agent === agent);
  const working = Boolean(team.working);
  const items = view.items;

  const result = {
    scout: team.audit && <ResultStats stats={[[team.audit.data.whatWorks.length, 'formats'], [team.audit.data.hooks.length, 'hooks'], [team.audit.data.topics.length, 'topics'], [team.audit.data.sources.length, 'sources']]} cta="See the findings" onGo={() => go('team')} note={`Researched ${ago(team.audit.at)}`} />,
    analyst: team.account && <ResultStats stats={[[team.account.data.postCount, 'posts compared'], [team.account.data.stats[0]?.format ?? '–', 'best format'], [team.account.data.gaps.length, 'gaps found']]} cta="See the comparison" onGo={() => go('team')} note={team.account.simulated ? 'On demo data' : `Compared ${ago(team.account.at)}`} />,
    strategist: <ResultStats stats={[[items.filter(i => i.status === 'idea').length, 'waiting for you'], [items.filter(i => ['briefed', 'drafted', 'approved'].includes(i.status) && i.origin === 'ai').length, 'accepted'], [items.filter(i => i.status === 'rejected').length, 'refused']]} cta="Decide in Today" onGo={() => go('today')} note="Refusals teach it what you do not want." />,
    writer: <ResultStats stats={[[items.filter(i => i.status === 'briefed' && !i.draft).length, 'waiting to be written'], [items.filter(i => i.status === 'drafted').length, 'drafts to review'], [items.filter(i => i.status === 'approved' || i.status === 'published').length, 'approved']]} cta="Review in Today" onGo={() => go('today')} note="" />,
  }[agent];

  return (
    <div className="stack" style={{ ['--h' as string]: AGENT_HUE[agent] }}>
      <section className="card agent-hero">
        <Avatar id={agent} state={st} size={56} />
        <div><h3>{info.name}</h3><p className="hint">{about.does}</p></div>
        <span className={`badge ${st === 'working' ? 'work' : st === 'failed' ? 'wait' : cfg.enabled ? 'done' : ''}`}><i />{!cfg.enabled ? 'off' : st === 'working' ? 'working' : st === 'failed' ? 'stuck' : 'ready'}</span>
        <button className="primary" disabled={working || !cfg.enabled || busy !== ''} onClick={() => run('run', () => teamApi.run(pid, [agent], ''))}>Run {info.name} now</button>
      </section>

      <div className="agent-grid">
        <section className="card">
          <h3>Capacity</h3>
          <div className="dial wide"><span>{cfg.enabled ? 'Working for you' : 'Switched off'}</span><Switch on={cfg.enabled} disabled={busy !== ''} onChange={v => run('cfg', () => teamApi.configure(pid, agent, { enabled: v }))} label={`${info.name} on or off`} /></div>
          <div className="dial wide"><span>{cfg.workers} at once</span><Workers agent={agent} value={cfg.workers} disabled={busy !== '' || !cfg.enabled} onChange={n => run('cfg', () => teamApi.configure(pid, agent, { workers: n }))} /></div>
          <p className="hint small">{about.workers} More means wider results and more model calls.</p>
        </section>
        <section className="card">
          <h3>Last result</h3>
          {result || <p className="hint">Nothing yet. Run {info.name} to see its work here.</p>}
        </section>
      </div>

      <section className="card">
        <h3>Behaviour</h3>
        <p className="hint small">What you want {info.name} to do differently, in your words. Or just tell it in the chat below, and apply what it proposes.</p>
        <textarea rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="e.g. Always cite recent examples." />
        <div className="chips">{about.ideas.map(i => <button key={i} className="chip" onClick={() => setText(t => (t ? `${t} ` : '') + i + '.')}>{i}</button>)}</div>
        {error && <p className="error">{error}</p>}
        <div className="row"><button className="primary" disabled={busy !== '' || text === cfg.instructions} onClick={() => run('save', () => teamApi.configure(pid, agent, { instructions: text }))}>{text === cfg.instructions ? 'Saved' : 'Save behaviour'}</button></div>
      </section>

      <section className="card">
        <h3>Talk to the {info.name}</h3>
        {subject && <p className="hint small">About “{subject.label}” — it already sees it, just ask. <button className="linkish tight" onClick={onClearAbout}>Clear</button></p>}
        <TeamChat pid={pid} team={team} view={view} base={agent} lock={agent} subject={subject} hint={`agent:${agent}`} reload={reload} onTalk={a => go(`agent:${a}`)} onOpenItem={id => { go('studio'); window.location.hash = `#/projects/${pid}/content/studio/item/${id}`; }} />
      </section>

      {mine.length > 0 && <section className="card"><h3>Recent work</h3><ul className="feed">{mine.slice(0, 6).map(a => <li key={a.id}><i className="dot" /><span className={a.ok ? '' : 'error'}>{a.summary}</span><time>{ago(a.at)}</time></li>)}</ul></section>}
    </div>
  );
}

function ResultStats({ stats, cta, onGo, note }: { stats: Array<[number | string, string]>; cta: string; onGo: () => void; note: string }) {
  return (
    <div className="result">
      <div className="kpis">{stats.map(([n, l]) => <div key={l} className="kpi"><b>{n}</b><span>{l}</span></div>)}</div>
      {note && <p className="hint small">{note}</p>}
      <button onClick={onGo}>{cta} →</button>
    </div>
  );
}

