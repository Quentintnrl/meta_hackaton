import { teamApi, type AgentId, type ContentView, type TeamView } from '../api';
import { t, t2 } from '../i18n';
import { AGENT_HUE, ago, useAction } from './shared';
import { ABOUT, Avatar, agentState } from './Agents';
import { TeamChat, type Subject } from './Chat';
import type { View } from './Studio';

// Singular and plural of one worker, for the dial: "2 researchers".
const UNIT: Record<string, [string, string]> = { scout: ['{n} researcher', '{n} researchers'], analyst: ['{n} analyst', '{n} analysts'], strategist: ['{n} strategist', '{n} strategists'], writer: ['{n} writer', '{n} writers'] };

// How many of an agent work at once: the manager's lever on cost and depth.
export function Workers({ agent, value, disabled, onChange }: { agent: AgentId; value: number; disabled?: boolean; onChange: (n: number) => void }) {
  const fixed = agent === 'analyst' || agent === 'director';
  return (
    <div className="stepper" aria-label={t('{agent} workers', { agent })}>
      <button disabled={disabled || fixed || value <= 1} onClick={() => onChange(value - 1)} aria-label={t('Fewer')}>−</button>
      <span className="dots">{[1, 2, 3].map(n => <i key={n} className={n <= value ? 'on' : ''} />)}</span>
      <button disabled={disabled || fixed || value >= 3} onClick={() => onChange(value + 1)} aria-label={t('More')}>+</button>
    </div>
  );
}

export function Switch({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><i /></button>;
}

const JOB: Record<AgentId, string> = { director: t('Leads the team: writes the plan in Insights and sums up every run. Ask it first.'), scout: ABOUT.scout.does, analyst: ABOUT.analyst.does, strategist: ABOUT.strategist.does, writer: ABOUT.writer.does };
const UNIT_HINT: Record<string, string> = { scout: t('Each extra researcher takes another angle at the same time: deeper, slower, costs more.'), analyst: t('One is enough: it reads all your posts.'), strategist: t('Each extra one looks through another lens; the proposals are merged.'), writer: t('Extra writers draft several accepted pieces at once.') };

// The board: how a run goes, then one card per agent with its job, its last work and its two dials, explained.
export function OrgChart({ pid, team, go, reload, onAsk }: { pid: string; team: TeamView; go: (v: View) => void; reload: () => Promise<void>; onAsk?: (agent: AgentId) => void }) {
  const { busy, run } = useAction(reload);
  const set = (a: AgentId, patch: Parameters<typeof teamApi.configure>[2]) => run('cfg', () => teamApi.configure(pid, a, patch));
  const last = (id: AgentId) => team.activity.find(a => a.agent === id);
  const FLOW: Array<[string, AgentId | null]> = [[t('You brief'), null], [t('Scout researches'), 'scout'], [t('Analyst scores'), 'analyst'], [t('Strategist proposes'), 'strategist'], [t('You decide'), null], [t('Writer drafts'), 'writer'], [t('You post'), null]];
  return (
    <div className="stack">
      <section className="card flowcard">
        <h3>{t('How a run goes')}</h3>
        <ol className="flow">{FLOW.map(([label, id]) => (
          <li key={label} className={id ? (team.config[id].enabled ? '' : 'off') : 'you'}>{id ? <Avatar id={id} state={agentState(team, id)} size={30} /> : <span className="you-dot">{t('you')}</span>}<span>{label}</span></li>
        ))}</ol>
        <p className="hint small">{t('The Director watches the whole run, writes the plan from the research and your numbers, and sums up at the end. Switch an agent off and every run skips its step.')}</p>
      </section>

      <div className="agents">{team.agents.map(a => {
        const c = team.config[a.id]; const st = agentState(team, a.id); const l = last(a.id); const lead = a.id === 'director';
        return (
          <section key={a.id} className={`card agentcard ${st} ${c.enabled ? '' : 'off'}`} style={{ ['--h' as string]: AGENT_HUE[a.id] }}>
            <div className="agenthead">
              <Avatar id={a.id} state={st} size={44} />
              <div><h3>{a.name}</h3><span className={`astate ${st}`}>{!c.enabled ? t('Switched off') : st === 'working' ? t('Working now') : st === 'failed' ? t('Last run failed') : t('Ready')}</span></div>
            </div>
            <p className="ajob">{JOB[a.id]}</p>
            <p className="alast">{l ? <><b>{t('Last:')}</b> {l.summary} <span className="hint">· {ago(l.at)}</span></> : <span className="hint">{t('Has not worked yet.')}</span>}</p>
            {!lead && (
              <div className="dials">
                <div className="dial"><span><b>{UNIT[a.id] ? t2(c.workers, UNIT[a.id][0], UNIT[a.id][1]) : c.workers}</b><small>{UNIT_HINT[a.id]}</small></span><Workers agent={a.id} value={c.workers} disabled={busy !== '' || !c.enabled} onChange={n => set(a.id, { workers: n })} /></div>
                <div className="dial"><span><b>{c.enabled ? t('Part of every run') : t('Skipped in every run')}</b><small>{c.enabled ? t('Switch it off to skip its step.') : t('Switch it on to bring it back.')}</small></span><Switch on={c.enabled} disabled={busy !== ''} onChange={v => set(a.id, { enabled: v })} label={t('{name} on or off', { name: a.name })} /></div>
              </div>
            )}
            <div className="row nomargin">
              <button className="primary" onClick={() => onAsk ? onAsk(a.id) : go(`agent:${a.id}`)}>{lead ? t('Talk to the Director') : t('Talk to it')}</button>
              <button className="linkish" onClick={() => go(`agent:${a.id}`)}>{lead ? t('Its summary →') : t('Its page and its orders →')}</button>
            </div>
          </section>
        );
      })}</div>
    </div>
  );
}

export function DirectorPage({ pid, team, view, reload, go, subject }: { pid: string; team: TeamView; view: ContentView; reload: () => Promise<void>; go: (v: View) => void; subject?: Subject }) {
  const waiting = view.items.filter(i => i.status === 'idea').length;
  const s = team.synthesis;
  return (
    <div className="stack">
      <button className="note-line" onClick={() => go('team')}><b>{t('The team:')}</b> {t('who does what, how many of each, on or off')} <span>{t('Open →')}</span></button>
      <div className="director-grid">
        <section className="card">
          <h3>{t('Talk to the Director')}</h3>
          <p className="hint small">{t('Say what you want. It answers, proposes what to run or change, and sends you to the right agent when you need to talk to them directly.')}</p>
          <TeamChat pid={pid} team={team} view={view} base="director" lock="director" subject={subject} hint="agent:director" reload={reload} onTalk={a => go(`agent:${a}`)} onOpenItem={id => { go('studio'); window.location.hash = `#/projects/${pid}/content/studio/item/${id}`; }} />
        </section>
        <div className="stack">
          <section className="card">
            <h3>{t('Latest summary')}</h3>
            {s ? <><p className="lead"><b>{s.data.headline}</b></p><ul className="plain">{s.data.points.map(p => <li key={p}>{p}</li>)}</ul><p className="next"><b>{t('Next')}</b> {s.data.next}</p><p className="hint small">{ago(s.at)}</p></> : <p className="hint">{t('No summary yet. After the team has worked, the Director sums it up here.')}</p>}
          </section>
          <section className="card">
            <h3>{t('Right now')}</h3>
            <ul className="plain">
              <li><button className="linkish tight" onClick={() => go('today')}>{t2(waiting, '{n} proposal', '{n} proposals')}</button> {t('waiting for you')}</li>
              <li>{t('{n} posts loaded', { n: team.accountPosts })} · {team.audit ? t('field research done') : t('field research not done')}</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
