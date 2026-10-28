import { useState } from 'react';
import type { Autonomy, Gate } from './api';

export type AutonomyChoice = Record<Gate, Autonomy>;

const LEVELS: Autonomy[] = ['low', 'medium', 'high'];
const LEVEL_NAME: Record<Autonomy, string> = { low: 'Ask me', medium: 'Agent decides', high: 'Automatic' };

// The gates a feature goes through today. Publishing joins when the content agent exists.
const GATES: Array<{ id: Gate; name: string; help: Record<Autonomy, string> }> = [
  { id: 'plan', name: 'Plan', help: {
    low: 'You approve every plan before anything is built.',
    medium: 'Goes ahead when the planner sees nothing ambiguous. Otherwise it asks you.',
    high: 'Always goes ahead.',
  } },
  { id: 'visual', name: 'Visual check', help: {
    low: 'You decide, with the comparison report in front of you.',
    medium: 'Accepted when the build matches the mockup. When it differs, you decide.',
    high: 'Accepted when it matches. When it differs, the builder tries again with the differences.',
  } },
  { id: 'merge', name: 'Merge', help: {
    low: 'You approve each merge into main.',
    medium: 'Merges by itself once the visual check passed.',
    high: 'Always merges. Pushing to GitHub stays your call.',
  } },
];

const PRESETS: Array<{ id: string; name: string; text: string; level: Autonomy }> = [
  { id: 'manual', name: 'Manual', text: 'You validate every step.', level: 'low' },
  { id: 'balanced', name: 'Balanced', text: 'Agents continue when they are confident.', level: 'medium' },
  { id: 'autopilot', name: 'Autopilot', text: 'Agents go all the way.', level: 'high' },
];

export const allAt = (level: Autonomy): AutonomyChoice => ({ plan: level, visual: level, merge: level, publish: 'low', teaser: 'low' });

export function AutonomyPicker({ value, onChange }: { value: AutonomyChoice; onChange: (v: AutonomyChoice) => void }) {
  const [custom, setCustom] = useState(false);
  const active = PRESETS.find(p => GATES.every(g => value[g.id] === p.level));

  return (
    <div className="autonomy">
      <span className="eyebrow">How much do you want to be asked?</span>
      <div className="presets" role="radiogroup">
        {PRESETS.map(p => (
          <button key={p.id} type="button" role="radio" aria-checked={active?.id === p.id} className={active?.id === p.id ? 'preset on' : 'preset'} onClick={() => onChange(allAt(p.level))}>
            <b>{p.name}</b>
            <small>{p.text}</small>
          </button>
        ))}
      </div>

      <button type="button" className="link" onClick={() => setCustom(!custom)} aria-expanded={custom}>
        {custom || !active ? 'Hide' : 'Customize'} per step{!active && ' · custom'}
      </button>

      {(custom || !active) && (
        <div className="gates">
          {GATES.map(g => (
            <div key={g.id} className="gate-row">
              <span className="gate-name">{g.name}</span>
              <div className="seg" role="radiogroup" aria-label={g.name}>
                {LEVELS.map(l => (
                  <button key={l} type="button" role="radio" aria-checked={value[g.id] === l} className={value[g.id] === l ? 'on' : ''} onClick={() => onChange({ ...value, [g.id]: l })}>{LEVEL_NAME[l]}</button>
                ))}
              </div>
              <small className="gate-help">{g.help[value[g.id]]}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
