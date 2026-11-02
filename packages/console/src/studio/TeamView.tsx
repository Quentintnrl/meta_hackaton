import { teamApi, type AgentId, type ContentView, type TeamView } from '../api';
import { OrgChart } from './DirectorPage';
import { AccountCard, AccountData, AuditCard } from './Insights';
import { SettingsView } from './SettingsView';
import { useAction } from './shared';
import type { View } from './Studio';

// Team: who does what, what they found, and what you told them. One page,
// four sections. Chatting happens in the drawer, from anywhere.
export function TeamView({ pid, team, view, reload, go, askAgent }: { pid: string; team: TeamView; view: ContentView; reload: () => Promise<void>; go: (v: View) => void; askAgent: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void }) {
  const { busy, error, run } = useAction(reload);
  const working = Boolean(team.working) || busy !== '';
  const brief = () => run('brief', () => teamApi.run(pid, ['scout', 'analyst', 'strategist'], ''));
  return (
    <div className="stack">
      <OrgChart pid={pid} team={team} go={go} reload={reload} onAsk={askAgent} />

      <div className="today">
        <div><b>What works out there</b><span className="hint small">The Scout's field research: which formats win, which hooks land, what flops — with examples and sources.</span></div>
        <button className="linkish" onClick={() => askAgent('scout')}>Ask the Scout →</button>
      </div>
      <AuditCard audit={team.audit} log={team.audits} onBrief={working ? undefined : brief} />
      {error && <p className="error">{error}</p>}

      <div className="today">
        <div><b>Your account</b><span className="hint small">The Analyst's comparison: scores per format, your best and worst posts, strengths and gaps vs the field.</span></div>
        <button className="linkish" onClick={() => askAgent('analyst')}>Ask the Analyst →</button>
      </div>
      <AccountCard team={team} />
      <AccountData pid={pid} team={team} items={view.items} reload={reload} />

      <div className="today">
        <div><b>Voice & rules</b><span className="hint small">Told once, read by every agent: how you speak, who you speak to, and how pieces leave the studio.</span></div>
      </div>
      <SettingsView pid={pid} view={view} reload={reload} />
    </div>
  );
}
