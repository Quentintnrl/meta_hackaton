import { z } from 'zod';
import type { LLM } from '../adapters/llm.ts';

// What the browser may do to reach the screen under review. A closed set: the model never writes code.
export const CaptureAction = z.discriminatedUnion('do', [
  z.object({ do: z.literal('click'), text: z.string().min(1).max(80) }),
  z.object({ do: z.literal('goto'), path: z.string().regex(/^\/[^\s]*$/).max(200) }),
  z.object({ do: z.literal('wait'), ms: z.number().int().min(0).max(3000) }),
]);
export type CaptureAction = z.infer<typeof CaptureAction>;

// The structured-output API refuses oneOf/anyOf, so the model fills one flat shape (unused fields left empty)
// and each action is then checked against the strict CaptureAction above.
const FlatAction = z.object({ do: z.enum(['click', 'goto', 'wait']), text: z.string(), path: z.string(), ms: z.number().int() });
const Actions = z.object({ actions: z.array(FlatAction).max(6) });
const Checklist = z.object({ elements: z.array(z.string().min(2).max(40)).min(4).max(12) });

export async function chooseActions(llm: LLM, design: string, labels: string[]): Promise<CaptureAction[]> {
  const r = await llm.json(
    `A web app is open on its home page. Below is the design change that was just implemented, and the visible text of its buttons and links.
Choose the few browser actions (at most 6) that bring the app to the screen state described by the design, so it can be screenshotted.
Only click things that open or show the new UI. Never delete, submit or change data. If the home page already shows it, return no action.
Use "click" with the exact visible text in "text", "goto" with a path starting with / in "path", or "wait" with "ms". Leave unused fields as "" or 0.

Design change:
${design}

Buttons and links on the page:
${labels.map(l => `- ${l}`).join('\n') || '(none)'}`,
    Actions,
    'capture_actions',
  );
  return r.actions.flatMap(a => {
    const parsed = CaptureAction.safeParse(a.do === 'click' ? { do: 'click', text: a.text } : a.do === 'goto' ? { do: 'goto', path: a.path } : { do: 'wait', ms: Math.min(Math.max(a.ms, 0), 3000) });
    return parsed.success ? [parsed.data] : []; // an invalid action is dropped, never run
  });
}

// Short, concrete noun phrases that an image segmenter can find, and that the mockup is expected to show.
export async function visualChecklist(llm: LLM, design: string): Promise<string[]> {
  const r = await llm.json(
    `List 8 to 10 visible UI elements that a screenshot of this design must show, to check an implementation against the mockup.
Each is a SHORT concrete noun phrase of one to three words that an image segmentation model can find. Describe what it LOOKS like:
shape and colour work best, for example "outlined button", "burgundy button", "white panel", "rounded rectangle", "square checkbox", "logo", "dark banner", "close icon".
Avoid generic single words like "text" or "card", avoid abstract words like "drawer", "list" or "heading", and avoid brand-specific names.
Cover different parts of the screen: header, main area, the new element and its children. Some phrases may not be found: that is fine.

Design:
${design}`,
    Checklist,
    'visual_checklist',
  );
  return [...new Set(r.elements.map(e => e.trim().toLowerCase()))];
}
