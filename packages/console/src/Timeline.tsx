import type { JournalEntry } from './api';

function describe(e: JournalEntry): string {
  const p = e.payload;
  switch (e.type) {
    case 'STATE': return `→ ${String(p.state)}`;
    case 'CREATED': return 'feature created';
    case 'PLAN': return 'planner: plan ready';
    case 'BUILD': return `builder: ${String(p.branch)}`;
    case 'BEFORE': return 'app captured before the feature';
    case 'VISUAL': return `visual check: ${String(p.verdict)}`;
    case 'VISUAL_SKIPPED': return `visual check skipped: ${String(p.reason)}`;
    case 'MERGE': return `merged into main${p.pushed ? ' and pushed' : ''}`;
    case 'ERROR': return `${String(p.agent)} failed: ${String(p.message)}`;
    case 'EVENT': return `${p.by === 'agent' ? 'agents approved' : 'event'} ${String(p.type).toLowerCase()}${p.gate ? ' ' + String(p.gate) : ''}`;
    default: return e.type;
  }
}

export function Timeline({ events, only }: { events: JournalEntry[]; only?: string }) {
  const shown = (only ? events.filter(e => e.featureId === only) : events).slice().reverse();
  if (!shown.length) return <p className="hint">Nothing yet.</p>;
  return (
    <ul>
      {shown.map(e => (
        <li key={e.id} className={e.type === 'ERROR' ? 'err' : ''}>
          <span>{describe(e)}</span>
          <small>{new Date(e.at).toLocaleTimeString()}{!only && ` · ${e.featureId}`}</small>
        </li>
      ))}
    </ul>
  );
}
