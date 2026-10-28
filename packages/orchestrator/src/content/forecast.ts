import { addDays, daysBetween, day, type Forecast, type Milestone } from './types.ts';

const MIN_CALIBRATION = 0.6;
const MAX_CALIBRATION = 2.5;
const SAMPLES = 5; // the last milestones count; an old habit should not weigh forever

// How much the raw projection has been off, measured on the milestones that already landed.
// 1.3 means "the work took 30% longer than the raw projection said". Geometric mean, so 2x too slow and 2x too fast cancel out.
export function calibration(finished: Array<{ doneAt: string; forecasts: Forecast[] }>): { factor: number; samples: number } {
  const perMilestone: number[] = [];
  for (const m of finished.slice(-SAMPLES)) {
    const ratios = m.forecasts
      .map(f => ({ raw: f.rawRemainingDays, actual: daysBetween(f.madeAt, m.doneAt) }))
      .filter(r => r.raw >= 0.5 && r.actual >= 0.5)
      .map(r => r.actual / r.raw);
    if (ratios.length) perMilestone.push(Math.exp(ratios.reduce((s, r) => s + Math.log(r), 0) / ratios.length));
  }
  if (!perMilestone.length) return { factor: 1, samples: 0 };
  const g = Math.exp(perMilestone.reduce((s, r) => s + Math.log(r), 0) / perMilestone.length);
  return { factor: Math.min(MAX_CALIBRATION, Math.max(MIN_CALIBRATION, g)), samples: perMilestone.length };
}

export interface Projection {
  predictedDate: string;
  rawRemainingDays: number;
  calibration: number;
  done: number;
  scope: number;
  confidence: Forecast['confidence'];
  pace: 'observed' | 'planned'; // observed = from what got done, planned = from the user's own target (nothing done yet)
}

// Where the milestone lands. With work done, the pace is what actually happened. With none, the only honest pace
// is the user's own plan, so the forecast starts at the target and moves as evidence comes in.
export function project(m: Pick<Milestone, 'startDate' | 'targetDate' | 'scope'>, done: number, now: Date, cal: { factor: number; samples: number }): Projection {
  const scope = Math.max(1, m.scope);
  const remaining = Math.max(0, scope - done);
  const elapsed = Math.max(1, daysBetween(m.startDate + 'T00:00:00Z', day(now) + 'T00:00:00Z'));
  const plannedPace = Math.max(0.5, daysBetween(m.startDate + 'T00:00:00Z', m.targetDate + 'T00:00:00Z') / scope);
  const observed = done > 0;
  const paceDays = observed ? elapsed / done : plannedPace;
  const raw = remaining * paceDays;
  const adjusted = raw * cal.factor;
  const confidence = !observed ? 'low' : done / scope >= 0.5 && cal.samples >= 2 ? 'high' : 'medium';
  return {
    predictedDate: addDays(day(now), Math.ceil(adjusted)),
    rawRemainingDays: raw,
    calibration: cal.factor,
    done,
    scope,
    confidence,
    pace: observed ? 'observed' : 'planned',
  };
}

// Worth recording? A forecast that says the same thing as the last one is noise.
export function moved(prev: Pick<Forecast, 'predictedDate' | 'done' | 'scope'> | undefined, next: Pick<Projection, 'predictedDate' | 'done' | 'scope'>): boolean {
  return !prev || prev.predictedDate !== next.predictedDate || prev.done !== next.done || prev.scope !== next.scope;
}
