import { useState } from 'react';
import { contentApi, teamApi, type AccountReport, type AgentId, type Audit, type ContentItem, type ContentView, type TeamView as Team } from '../api';
import { AGENT_HUE, KindChip, SOURCE, ago, fmt, useAction } from './shared';

const GLYPH: Record<AgentId, string> = { scout: 'M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z', analyst: 'M4 20V10h3v10H4Zm6.5 0V4h3v16h-3ZM17 20v-7h3v7h-3Z', strategist: 'M12 2 3 7v2h18V7l-9-5Zm-7 9v7H3v2h18v-2h-2v-7h-2v7h-3v-7h-2v7h-2v-7H9v7H7v-7H5Z', writer: 'M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25ZM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z' };

export function TeamView({ pid, team, view, reload, onSettings }: { pid: string; team: Team; view: ContentView; reload: () => Promise<void>; onSettings: () => void }) {
  const [brief, setBrief] = useState('');
  const { busy, error, run } = useAction(reload);
  const working = team.working?.agent;
  const proposals = view.items.filter(i => i.status === 'idea');
  const lastBy = (a: AgentId) => team.activity.find(x => x.agent === a);
  const noAccount = team.accountPosts === 0;
  const go = (agents: AgentId[]) => run('run', () => teamApi.run(pid, agents, brief.trim()));

  return (
    <div className="stack">
      <section className="card manager">
        <div className="team-strip">
          {team.agents.map(a => {
            const last = lastBy(a.id);
            const state = working === a.id ? 'working' : last && !last.ok ? 'failed' : 'idle';
            return (
              <div key={a.id} className={`agent ${state}`} style={{ ['--h' as string]: AGENT_HUE[a.id] }}>
                <div className="avatar"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><path d={GLYPH[a.id]} fill="currentColor" /></svg><i /></div>
                <b>{a.name}</b>
                <span className="role">{a.role}</span>
                <span className="said">{state === 'working' ? 'Working on it…' : last ? <>{last.ok ? '' : 'Stuck: '}{last.summary}</> : 'Waiting for your brief'}</span>
                <button disabled={!!working || busy !== ''} onClick={() => go([a.id])}>Run only this one</button>
              </div>
            );
          })}
        </div>

        <div className="brief">
          <label>Brief your team
            <textarea rows={2} value={brief} onChange={e => setBrief(e.target.value)} placeholder="What should they focus on? e.g. “Get people excited about the beta, no discounts, one video idea.” Leave empty to let them decide." />
          </label>
          <div className="row">
            <button className="primary" disabled={!!working || busy !== ''} onClick={() => go(['scout', 'analyst', 'strategist'])}>{working ? 'The team is working…' : 'Brief the team'}</button>
            {['Prepare the next release', 'More ideas like what works for us', 'Refresh the field research'].map(q => <button key={q} className="chip" onClick={() => setBrief(q)}>{q}</button>)}
            <button className="linkish" onClick={onSettings}>Standing orders…</button>
          </div>
          {noAccount && <p className="hint small">No account data yet: the Analyst has nothing to compare. <button className="linkish" onClick={onSettings}>Add your posts or load the demo</button></p>}
          {error && <p className="error">{error}</p>}
        </div>
      </section>

      <section>
        <div className="head"><h3>Waiting for your decision {proposals.length > 0 && <span className="count">{proposals.length}</span>}</h3></div>
        {proposals.length === 0 && <div className="card empty"><p>Nothing to decide. Brief the team and they will bring proposals, each with the evidence behind it.</p></div>}
        <div className="proposals">{proposals.map(p => <Proposal key={p.id} item={p} reload={reload} milestone={view.milestones.find(m => m.id === p.milestoneId)?.title} />)}</div>
      </section>

      <div className="insights">
        <AuditCard audit={team.audit} />
        <AccountCard report={team.account} />
      </div>

      {team.activity.length > 0 && (
        <section className="card">
          <h3>What the team did</h3>
          <ul className="feed">{team.activity.slice(0, 8).map(a => (
            <li key={a.id} style={{ ['--h' as string]: AGENT_HUE[a.agent] }}><i className="dot" /><b>{team.agents.find(x => x.id === a.agent)?.name}</b> <span className={a.ok ? '' : 'error'}>{a.summary}</span><time>{ago(a.at)}</time></li>
          ))}</ul>
        </section>
      )}
    </div>
  );
}

function Proposal({ item, reload, milestone }: { item: ContentItem; reload: () => Promise<void>; milestone?: string }) {
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction(reload);
  const src = item.source ? SOURCE[item.source] : undefined;
  return (
    <article className="proposal">
      <div className="top"><KindChip kind={item.kind} />{src && <span className={`src ${item.source}`} title={src.hint}>{src.label}</span>}<span className="when">{fmt(item.fixedDate)}{milestone ? ` · around ${milestone}` : ''}</span></div>
      <h4>{item.title}</h4>
      <p>{item.brief}</p>
      {item.rationale && <p className="why"><b>Why</b> {item.rationale}</p>}
      {refusing ? (
        <div className="refuse">
          <input autoFocus value={reason} onChange={e => setReason(e.target.value)} placeholder="Why not? The team will remember." onKeyDown={e => e.key === 'Enter' && run('no', () => teamApi.reject(item.id, reason))} />
          <button disabled={busy !== ''} onClick={() => run('no', () => teamApi.reject(item.id, reason))}>Refuse</button>
          <button className="linkish" onClick={() => setRefusing(false)}>Cancel</button>
        </div>
      ) : (
        <div className="row">
          <button className="primary" disabled={busy !== ''} onClick={() => run('yes', async () => { await teamApi.accept(item.id); })}>Accept</button>
          <button disabled={busy !== ''} onClick={() => run('yes+', async () => { await teamApi.accept(item.id); await contentApi.draft(item.id); })}>{busy === 'yes+' ? 'Writing…' : 'Accept & write'}</button>
          <button className="linkish" onClick={() => setRefusing(true)}>Refuse…</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </article>
  );
}

function AuditCard({ audit }: { audit?: { data: Audit; at: string } }) {
  return (
    <section className="card insight">
      <span className="eyebrow">The field</span>
      <h3>What works for projects like yours</h3>
      {!audit ? <p className="hint">The Scout has not looked yet.</p> : <>
        <p className="lead">{audit.data.summary}</p>
        <ul className="works">{audit.data.whatWorks.map(w => <li key={w.format}><b>{w.format}</b><span>{w.why}</span><em>{w.example}</em></li>)}</ul>
        {audit.data.hooks.length > 0 && <><h5>Hooks that land</h5><div className="chips">{audit.data.hooks.map(h => <span key={h} className="pill">{h}</span>)}</div></>}
        {audit.data.avoid.length > 0 && <><h5>Falls flat</h5><div className="chips">{audit.data.avoid.map(h => <span key={h} className="pill neg">{h}</span>)}</div></>}
        <p className="hint small">Web research, {ago(audit.at)}.{audit.data.sources.slice(0, 3).map((u, i) => <a key={u} href={u} target="_blank" rel="noopener noreferrer"> [{i + 1}]</a>)}</p>
      </>}
    </section>
  );
}

function AccountCard({ report }: { report?: { data: AccountReport; simulated: boolean; at: string } }) {
  const max = Math.max(1, ...(report?.data.stats.map(s => s.avgEngagement) ?? [1]));
  return (
    <section className="card insight">
      <span className="eyebrow">Your account {report?.simulated && <span className="demo">Demo data, not real numbers</span>}</span>
      <h3>How you compare</h3>
      {!report ? <p className="hint">The Analyst has not compared yet.</p> : <>
        <p className="lead">{report.data.summary}</p>
        <div className="bars" role="img" aria-label="Average engagement per format">{report.data.stats.map(s => (
          <div key={s.format} className="barrow"><span>{s.format}</span><div><i style={{ width: `${(s.avgEngagement / max) * 100}%` }} /></div><b>{s.avgEngagement}</b></div>
        ))}</div>
        <div className="two-col">
          <div><h5>Strong</h5><ul>{report.data.strengths.map(x => <li key={x}>{x}</li>)}</ul></div>
          <div><h5>Missing vs the field</h5><ul>{report.data.gaps.map(x => <li key={x}>{x}</li>)}</ul></div>
        </div>
      </>}
    </section>
  );
}
