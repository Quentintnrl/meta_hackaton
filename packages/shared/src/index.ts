import { z } from 'zod';

// Autonomy of a gate: `low` = the user validates, `medium` = the agent judges whether to ask, `high` = automatic.
export const Autonomy = z.enum(['low', 'medium', 'high']);
export type Autonomy = z.infer<typeof Autonomy>;

// `visual` is the visual check against the mockup: `low` = I decide with the report, `medium` = automatic when it
// matches and I decide when it differs, `high` = automatic both ways (a difference sends the builder back).
export const Gate = z.enum(['plan', 'visual', 'merge', 'publish', 'teaser']);
export type Gate = z.infer<typeof Gate>;

export const AutonomyConfig = z.record(Gate, Autonomy);
export type AutonomyConfig = z.infer<typeof AutonomyConfig>;

export const defaultAutonomy: AutonomyConfig = { plan: 'low', visual: 'low', merge: 'low', publish: 'low', teaser: 'low' };

export interface Post {
  caption: string;
  imagePath: string;
}

export interface PublishedPost {
  id: string;
  url: string;
  simulated: boolean;
}

// Real Instagram or simulated: swapped by config, the orchestrator never knows which.
export interface Publisher {
  readonly simulated: boolean;
  publish(post: Post): Promise<PublishedPost>;
}
