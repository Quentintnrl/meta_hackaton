import type { AgentId, ContentView, TeamView } from '../api';
import { OrgChart } from './DirectorPage';
import { AccountCard, AccountData, AuditCard } from './Insights';
import { SettingsView } from './SettingsView';
import type { View } from './Studio';

// Team: who does what, what they found, and what you told them. One page,
// four sections. Chatting happens in the drawer, from anywhere.
export function TeamView({ pid, team, view, reload, go, askAgent }: { pid: string; team: TeamView; view: ContentView; reload: () => Promise<void>; go: (v: View) => void; askAgent: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void }) {
  return (
    <div className="stack">
      <OrgChart pid={pid} team={team} go={go} reload={reload} onAsk={askAgent} />

      <div className="today">
        <div><b>What works out there</b><span className="hint small">Found by the Scout</span></div>
        <button className="linkish" onClick={() => askAgent('scout')}>Ask the Scout →</button>
      </div>
      <AuditCard audit={team.audit} />

      <div className="today">
        <div><b>Your account</b><span className="hint small">Compared by the Analyst</span></div>
        <button className="linkish" onClick={() => askAgent('analyst')}>Ask the Analyst →</button>
      </div>
      <AccountCard team={team} />
      <AccountData pid={pid} team={team} items={view.items} reload={reload} />

      <div className="today">
        <div><b>Voice & rules</b><span className="hint small">Told once, used everywhere</span></div>
      </div>
      <SettingsView pid={pid} view={view} reload={reload} />
    </div>
  );
}
