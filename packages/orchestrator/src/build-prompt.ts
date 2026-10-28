import type { Plan } from './planner.ts';

// The builder starts from the validated plan; for each technical option it takes the recommended choice.
export function buildPrompt(brief: { title: string; design: string }, plan: Plan, feedback?: string): string {
  const steps = plan.steps.map((s, i) => `${i + 1}. ${s.title}: ${s.detail}`).join('\n');
  const choices = plan.options.map(o => `- ${o.question} -> ${o.recommended}`).join('\n');
  return `Implement this feature in the current repository. Explore the code first and reuse what exists.
Keep the change small and in the existing style. Do not touch docs, assets or config unless needed.
Make sure the project still builds (run the build command if you can).

Feature: ${brief.title}
Design (source of truth, from the Figma mockup):
${brief.design}

Plan:
${steps}

Technical choices:
${choices}
${feedback ? `\nThe previous attempt did not match the mockup. Fix this:\n${feedback}\n` : ''}`;
}
