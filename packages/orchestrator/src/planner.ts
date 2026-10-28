import { z } from 'zod';
import type { LLM } from './adapters/llm.ts';

export const Plan = z.object({
  summary: z.string(),
  // The planner's own judgement, used when the plan gate is on `medium` autonomy.
  needsInput: z.boolean(),
  reason: z.string(), // why the user should look at it; empty when needsInput is false
  steps: z.array(z.object({ title: z.string(), detail: z.string() })).min(1).max(8),
  // A small, closed set of technical choices the user can pick from at the plan gate.
  options: z.array(z.object({ question: z.string(), choices: z.array(z.string()).min(2).max(3), recommended: z.string() })).max(3),
});
export type Plan = z.infer<typeof Plan>;

export interface FeatureBrief {
  title: string;
  design: string; // text description of the Figma frames that changed
}

export async function planFeature(llm: LLM, brief: FeatureBrief): Promise<Plan> {
  return llm.json(
    `You are the planner of a small software team working for a solo founder.
Turn this design change into an implementation plan for a web app. Keep it short and concrete.
Offer at most 3 technical options, each with 2-3 choices and a recommended one.
Set needsInput to true only if the design is ambiguous, or if a technical option would change what the user sees or costs them (a paid service, an account, user data stored on a server). Otherwise false, with an empty reason.

Feature: ${brief.title}
Design change (from the Figma mockup):
${brief.design}`,
    Plan,
    'plan',
  );
}
