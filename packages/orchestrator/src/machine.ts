import { setup, assign } from 'xstate';
import type { AutonomyConfig, Gate } from '@ripple/shared';

export interface FeatureContext {
  featureId: string;
  autonomy: AutonomyConfig;
  visualAttempts: number;
}

export type FeatureEvent =
  | { type: 'PLAN_READY' }
  | { type: 'APPROVE'; gate: Gate; push?: boolean; by?: 'agent' } // `by` marks an approval the agents gave on their own
  | { type: 'REJECT'; gate: Gate }
  | { type: 'BUILD_DONE' }
  | { type: 'VISUAL_OK' }
  | { type: 'VISUAL_DIFF'; feedback?: string }
  | { type: 'MERGE_DONE' }
  | { type: 'MERGE_FAILED' }
  | { type: 'FEEDBACK_READY' }
  | { type: 'ANNOUNCE_READY' }
  | { type: 'PUBLISHED' };

const MAX_VISUAL_ATTEMPTS = 2;

// Dev branch of the feature state machine. A gate parks until approved unless its autonomy is `high`.
// `medium` (the agent judges) is not wired yet: it behaves like `low`.
export const featureMachine = setup({
  types: { context: {} as FeatureContext, events: {} as FeatureEvent },
  guards: {
    planAuto: ({ context }) => context.autonomy.plan === 'high',
    mergeAuto: ({ context }) => context.autonomy.merge === 'high',
    publishAuto: ({ context }) => context.autonomy.publish === 'high',
    canRetryVisual: ({ context }) => context.visualAttempts < MAX_VISUAL_ATTEMPTS,
    approvedPlan: (_, params: { gate: Gate }) => params.gate === 'plan',
    approvedMerge: (_, params: { gate: Gate }) => params.gate === 'merge',
    approvedPublish: (_, params: { gate: Gate }) => params.gate === 'publish',
  },
}).createMachine({
  id: 'feature',
  initial: 'DESIGN_DEFINED',
  context: ({ input }) => ({ visualAttempts: 0, ...(input as Pick<FeatureContext, 'featureId' | 'autonomy'>) }),
  states: {
    DESIGN_DEFINED: { on: { PLAN_READY: 'PLANNED' } },
    PLANNED: {
      always: { guard: 'planAuto', target: 'BUILDING' },
      on: { APPROVE: { guard: { type: 'approvedPlan', params: ({ event }) => ({ gate: event.gate }) }, target: 'BUILDING' } },
    },
    BUILDING: { on: { BUILD_DONE: 'VISUAL_CHECK' } },
    VISUAL_CHECK: {
      on: {
        VISUAL_OK: 'PR_READY',
        VISUAL_DIFF: [
          { guard: 'canRetryVisual', target: 'BUILDING', actions: assign({ visualAttempts: ({ context }) => context.visualAttempts + 1 }) },
          { target: 'PR_READY' }, // out of retries: hand the diff to the user rather than loop
        ],
      },
    },
    PR_READY: {
      always: { guard: 'mergeAuto', target: 'MERGING' },
      on: { APPROVE: { guard: { type: 'approvedMerge', params: ({ event }) => ({ gate: event.gate }) }, target: 'MERGING' } },
    },
    MERGING: { on: { MERGE_DONE: 'APPLIED', MERGE_FAILED: 'MERGE_FAILED' } },
    // Waits for the user even at high autonomy: retrying blindly would loop on the same error.
    MERGE_FAILED: { on: { APPROVE: { guard: { type: 'approvedMerge', params: ({ event }) => ({ gate: event.gate }) }, target: 'MERGING' } } },
    APPLIED: { on: { FEEDBACK_READY: 'FEEDBACK' } },
    FEEDBACK: { on: { ANNOUNCE_READY: 'ANNOUNCE_DRAFTED' } },
    ANNOUNCE_DRAFTED: {
      always: { guard: 'publishAuto', target: 'PUBLISHING' },
      on: { APPROVE: { guard: { type: 'approvedPublish', params: ({ event }) => ({ gate: event.gate }) }, target: 'PUBLISHING' } },
    },
    PUBLISHING: { on: { PUBLISHED: 'PUBLISHED' } },
    PUBLISHED: { type: 'final' },
  },
});
