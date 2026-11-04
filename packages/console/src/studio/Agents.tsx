import type { AgentId, TeamView } from '../api';
import { t } from '../i18n';
import { AGENT_HUE, ago } from './shared';

// What each agent does, in the manager's words. Read on the Team page, the agent pages and the brief.
export const ABOUT: Record<Exclude<AgentId, 'director'>, { does: string; workers: string; ideas: string[]; starters: string[] }> = {
  scout: { does: t('Searches the web for what works in your field.'), workers: t('Each extra researcher takes another angle (formats, hooks and topics, what flops) at the same time.'), ideas: [t('Only look at video formats'), t('Ignore big brands, focus on solo developers'), t('Always cite recent examples')], starters: [t('What did you find?'), t('Look only at video formats from now on'), t('How reliable are your sources?')] },
  analyst: { does: t('Compares your account with what the Scout found.'), workers: t('One analyst is enough: it reads all your posts.'), ideas: [t('Weigh shares more than likes'), t('Compare only the last 3 months'), t('Be blunt about what does not work')], starters: [t('What is my weakest format?'), t('Be blunter in your analysis'), t('How do you measure engagement?')] },
  strategist: { does: t('Reads your roadmap and proposes content, with its evidence.'), workers: t('Each extra strategist looks through another lens (roadmap, your account, field trends) and the proposals are merged.'), ideas: [t('Always propose one video'), t('Max 3 proposals at a time'), t('Favour posts tied to a milestone')], starters: [t('Why these proposals?'), t('Propose fewer, better ideas'), t('Focus on the beta launch')] },
  writer: { does: t('Drafts what you accept: caption, hashtags, slides or storyboard.'), workers: t('Extra writers draft several accepted pieces at the same time.'), ideas: [t('Shorter captions, max 3 hashtags'), t('Always end with a question'), t('More humour, fewer adjectives')], starters: [t('Write shorter captions from now on'), t('Always end with a question'), t('What do you draft first?')] },
};


// One trade, one sign: a star for the Director, a magnifier for the Scout, a rising curve for the Analyst,
// a compass for the Strategist, a pen for the Writer. Drawn as strokes so they stay readable at 26 px.
const GLYPH: Record<AgentId, { d: string; fill?: boolean }> = {
  director: { d: 'M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17l-5.4 2.8 1.1-6.1L3.2 9.4l6.1-.8L12 3Z', fill: true },
  scout: { d: 'M10.5 4.5a6 6 0 1 1 0 12 6 6 0 0 1 0-12Zm4.3 10.3L20 20' },
  analyst: { d: 'M4 19h16M5 15l4.5-5 3.5 3 6-7M16 6h3v3' },
  strategist: { d: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17Zm3.6 4.9-2.1 5.3-5.1 2.4 2.1-5.3 5.1-2.4Z' },
  writer: { d: 'M4 20l1-4L16 5l3 3L8 19l-4 1Zm9-12 3 3M4 20h6' },
};

export type AgentState = 'working' | 'failed' | 'idle';
export const agentState = (team: TeamView, id: AgentId): AgentState => {
  if (team.working?.agent === id) return 'working';
  const last = team.activity.find(a => a.agent === id);
  return last && !last.ok ? 'failed' : 'idle';
};

export function Avatar({ id, state, size = 40 }: { id: AgentId; state: AgentState; size?: number }) {
  return (
    <div className={`avatar ${state}`} style={{ ['--h' as string]: AGENT_HUE[id], width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.6)} height={Math.round(size * 0.6)} aria-hidden fill={GLYPH[id].fill ? 'currentColor' : 'none'} stroke={GLYPH[id].fill ? 'none' : 'currentColor'} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d={GLYPH[id].d} /></svg><i />
    </div>
  );
}

// Always visible in the studio header: who is doing what, without taking any room.
export function TeamPulse({ team, onOpen }: { team: TeamView; onOpen: () => void }) {
  const w = team.working && team.agents.find(a => a.id === team.working!.agent);
  return (
    <button className="pulse" onClick={onOpen} title={t('Open the team')}>
      <span className="stack-av">{team.agents.map(a => <Avatar key={a.id} id={a.id} state={agentState(team, a.id)} size={26} />)}</span>
      <span className="pulse-text">{w ? t('{name} is working…', { name: w.name }) : t('Team is idle')}</span>
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
      <div className="head"><h3>{title ?? t('The team right now')}</h3><span className="hint small">{w ? t('Working') : lines[0] ? t('Last activity {ago}', { ago: ago(lines[0].at) }) : t('Idle')}</span></div>
      {w && <div className="tl-line working"><Avatar id={w.id} state="working" size={30} /><span><b>{w.name}</b> {t('is working')}<span className="typing"><i /><i /><i /></span><small>{t('since {ago}', { ago: ago(team.working!.since) })}</small></span></div>}
      {lines.map(a => { const who = team.agents.find(x => x.id === a.agent); return (
        <button key={a.id} className={`tl-line ${a.ok ? '' : 'failed'}`} onClick={() => onOpen(a.agent)}>
          <Avatar id={a.agent} state={a.ok ? 'idle' : 'failed'} size={30} />
          <span><b>{who?.name ?? a.agent}</b> {a.summary}<small>{ago(a.at)}{a.ok ? '' : ` · ${t('failed')}`}</small></span>
        </button>
      ); })}
      {!w && lines.length === 0 && <p className="hint">{t('The team has not worked yet. Brief it and its work shows up here, line by line.')}</p>}
    </section>
  );
}
