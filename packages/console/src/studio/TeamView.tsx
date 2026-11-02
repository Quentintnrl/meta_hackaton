import type { AgentId, ContentView, TeamView } from '../api';
import { OrgChart } from './DirectorPage';
import { SettingsView } from './SettingsView';
import type { View } from './Studio';

// Team: who does what, how much of it works, and what you told them. The numbers live in Insights.
export function TeamView({ pid, team, view, reload, go, askAgent }: { pid: string; team: TeamView; view: ContentView; reload: () => Promise<void>; go: (v: View) => void; askAgent: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void }) {
  return (
    <div className="stack">
      <OrgChart pid={pid} team={team} go={go} reload={reload} onAsk={askAgent} />
      <div className="today">
        <div><b>Voice and rules</b><span className="hint small">Written once, read by every agent before it works: how you speak, who you speak to, what never to say, and how pieces leave the studio.</span></div>
      </div>
      <SettingsView pid={pid} view={view} reload={reload} />
    </div>
  );
}
