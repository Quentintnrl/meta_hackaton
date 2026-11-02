import type { AgentId, ContentView, TeamView } from '../api';
import { OrgChart } from './DirectorPage';
import { SettingsView } from './SettingsView';
import type { View } from './Studio';

// Team: who does what, how much of it works, and what you told them. The numbers live in Insights.
export function TeamView({ pid, team, view, reload, go, askAgent }: { pid: string; team: TeamView; view: ContentView; reload: () => Promise<void>; go: (v: View) => void; askAgent: (agent: AgentId, kind?: 'item' | 'milestone', id?: string) => void }) {
  return (
    <div className="stack">
      <OrgChart pid={pid} team={team} go={go} reload={reload} onAsk={askAgent} />
      <button className="note-line" onClick={() => go('insights')}><b>Insights:</b> {team.plan ? team.plan.data.headline : team.audit ? 'the research, your numbers and the plan live there' : 'the field research and your numbers live there'} <span>Open →</span></button>

      <div className="today">
        <div><b>Voice & rules</b><span className="hint small">Told once, read by every agent: how you speak, who you speak to, and how pieces leave the studio.</span></div>
      </div>
      <SettingsView pid={pid} view={view} reload={reload} />
    </div>
  );
}
