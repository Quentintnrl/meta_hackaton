import { z } from 'zod';
import type { LLM } from '../adapters/llm.ts';
import { ItemKind, normalizeHashtags, type Forecast, type Item, type Milestone, type Media, type Profile } from './types.ts';

export interface FeatureFacts {
  title: string;
  state: string;
  summary?: string; // what the plan says the feature does
  stat?: string; // what the build changed
}

const KIND_HELP: Record<ItemKind, string> = {
  changelog: 'a short, factual list of what changed, for users',
  'release-notes': 'what is new in this release and why it matters, for users',
  devlog: 'a first-person progress note about building it, with a decision or a lesson',
  'social-post': 'a post for social media: a hook, one idea, no filler',
  teaser: 'a post that makes people curious about something not out yet, without giving it all away',
  'doc-update': 'a change to the documentation: what to add or fix, and the new text',
  'demo-script': 'a script for a short demo video: the steps to show and what to say on each',
  newsletter: 'an email to subscribers: subject line, then body',
};

const voice = (p: Profile) => [
  p.voice && `Voice of the project: ${p.voice}`,
  p.audience && `Audience: ${p.audience}`,
  `Write in ${p.language}.`,
].filter(Boolean).join('\n');

const featureLines = (fs: FeatureFacts[]) => fs.map(f => `- ${f.title} (${f.state.toLowerCase().replace(/_/g, ' ')})${f.summary ? `: ${f.summary}` : ''}${f.stat ? ` [${f.stat}]` : ''}`).join('\n') || '(none linked yet)';

const Proposal = z.object({
  items: z.array(z.object({
    kind: ItemKind,
    title: z.string(),
    brief: z.string(), // what the piece should say, in one or two sentences, for the user to correct
    offsetDays: z.number().int().min(-60).max(30), // relative to the milestone date: negative = before it lands
  })).min(1).max(8),
});

// From the roadmap to a content plan: which pieces, when, about what. The user then corrects the briefs.
export async function proposeContent(llm: LLM, a: { milestone: Milestone; forecast?: Forecast; profile: Profile; features: FeatureFacts[]; existing: Item[]; guidance?: string }) {
  const r = await llm.json(
    `You plan the content that goes with a software milestone, for a solo developer who has little time for communication.
Propose between 3 and 6 pieces of content, spread over time: some before the milestone lands (teasers, devlogs), one when it lands (changelog or release notes, a post), one or two after (demo, newsletter).
offsetDays is relative to the date the milestone lands: negative = before. Do not repeat a piece that already exists.
Each brief is one or two sentences saying what the piece should cover. The user will correct it, so be concrete rather than polished.

${voice(a.profile)}

Milestone: ${a.milestone.title}
What the user wants: ${a.milestone.intent || '(nothing specified)'}
Target date: ${a.milestone.targetDate}${a.forecast ? `; projected date: ${a.forecast.predictedDate}` : ''}
Features in it:
${featureLines(a.features)}
Content that already exists:
${a.existing.map(i => `- ${i.kind}: ${i.title}`).join('\n') || '(none)'}
${a.guidance ? `\nThe user adds: ${a.guidance}` : ''}`,
    Proposal,
    'content_plan',
  );
  return r.items;
}

const Draft = z.object({ draft: z.string() });

export async function draftItem(llm: LLM, a: { item: Item; milestone?: Milestone; profile: Profile; features: FeatureFacts[]; commits?: string[]; guidance?: string }) {
  const r = await llm.json(
    `You write ${a.item.kind} content for a software project: ${KIND_HELP[a.item.kind]}.
Write only what was asked, in the project's voice. Do not invent features, numbers or dates that are not below.

${voice(a.profile)}

Title: ${a.item.title}
What the user wants it to say: ${a.item.brief || '(left to you: stay close to the facts below)'}
${a.milestone ? `Milestone: ${a.milestone.title}. ${a.milestone.intent}` : ''}
Facts, features:
${featureLines(a.features)}
${a.commits?.length ? `Facts, commits:\n${a.commits.map(c => `- ${c}`).join('\n')}` : ''}
${a.item.draft ? `\nPrevious draft (improve on it):\n${a.item.draft}` : ''}
${a.guidance ? `\nThe user adds: ${a.guidance}` : ''}`,
    Draft,
    'draft',
  );
  return r.draft.trim();
}

export async function reviseItem(llm: LLM, a: { item: Item; instruction: string; profile: Profile }) {
  const r = await llm.json(
    `Revise this ${a.item.kind} following the instruction. Change only what the instruction asks for; keep the rest as it is.

${voice(a.profile)}

Instruction: ${a.instruction}

Current text:
${a.item.draft}`,
    Draft,
    'revision',
  );
  return r.draft.trim();
}

const Note = z.object({ note: z.string() });

// The AI explains its own correction: what the previous forecast assumed, what happened, why the date moved. It never picks the date.
export async function explainForecast(llm: LLM, a: { milestone: Milestone; previous?: Forecast; next: Omit<Forecast, 'id' | 'note'>; calibrationSamples: number }) {
  const r = await llm.json(
    `You keep the projection of when a software milestone will land, and you correct your own projections as evidence comes in.
The dates below were computed; do not change them. In one or two plain sentences, say what moved and why (work done versus expected, the correction learned from earlier milestones if any), and own the earlier projection if it was off.

Milestone: ${a.milestone.title}; the user wants it by ${a.milestone.targetDate}.
Previous projection: ${a.previous ? `${a.previous.predictedDate} with ${a.previous.done}/${a.previous.scope} done` : 'none, this is the first'}.
New projection: ${a.next.predictedDate} with ${a.next.done}/${a.next.scope} done.
Correction learned from ${a.calibrationSamples} finished milestone(s): x${a.next.calibration.toFixed(2)}.`,
    Note,
    'forecast_note',
  );
  return r.note.trim();
}

const PostPackage = z.object({
  caption: z.string(), // the description under the post
  hashtags: z.array(z.string()).min(3).max(15),
  format: z.enum(['image', 'carousel', 'video']),
  slides: z.array(z.object({
    kind: z.enum(['image', 'video']),
    visual: z.string(),
    text: z.string(),
    seconds: z.number().int().min(0).max(90),
  })).min(1).max(10),
});

const POST_RULES = `A post is a package, not just a picture. Produce:
- caption: the description under the post. Open with the hook (the first line is what people see before "more"). No hashtags inside it.
- hashtags: 5 to 12, a mix of broad and niche, no spaces, none invented to look popular.
- format: "image" (one picture), "carousel" (a series of 3 to 8 pictures that tell something in order, each slide one idea) or "video" (a short vertical video: 3 to 8 shots). Choose what suits the message and what the manager asked for.
- slides: for an image or a carousel, one entry per picture (kind "image"). "visual" is a precise prompt for an image generator: subject, composition, style, colours; keep the same style across slides; write NO text inside the picture itself, put wording in "text" (overlay copy). For a video, one entry per shot (kind "video"): "visual" says what we see, "text" is the voiceover or on-screen text, "seconds" its length. For images "seconds" is 0.`;

const packageToText = (caption: string, media?: Media) => media
  ? `Format: ${media.format}\nCaption:\n${caption}\nHashtags: ${media.hashtags.join(' ')}\nSlides:\n${media.slides.map((x, i) => `${i + 1}. [${x.kind}${x.seconds ? ` ${x.seconds}s` : ''}] visual: ${x.visual} | text: ${x.text}`).join('\n')}`
  : caption;

function asMedia(r: z.infer<typeof PostPackage>, previous?: Media): { caption: string; media: Media } {
  const slides = r.slides.map((x, i) => {
    const old = previous?.slides[i];
    // A generated picture stays while its description is unchanged: no paying twice for the same image.
    return { ...x, file: old?.file && old.visual === x.visual ? old.file : undefined };
  });
  return { caption: r.caption.trim(), media: { format: r.format, hashtags: normalizeHashtags(r.hashtags), slides } };
}

export async function draftPost(llm: LLM, a: { item: Item; milestone?: Milestone; profile: Profile; features: FeatureFacts[]; commits?: string[]; guidance?: string }) {
  const r = await llm.json(
    `You write social posts for a software project, in the project's voice. Do not invent features, numbers or dates that are not below.
${POST_RULES}

${voice(a.profile)}

Kind: ${a.item.kind} (${KIND_HELP[a.item.kind]})
Title: ${a.item.title}
What the manager wants it to say: ${a.item.brief || '(left to you: stay close to the facts below)'}
${a.milestone ? `Milestone: ${a.milestone.title}. ${a.milestone.intent}` : ''}
Facts, features:
${featureLines(a.features)}
${a.commits?.length ? `Facts, commits:\n${a.commits.map(c => `- ${c}`).join('\n')}` : ''}
${a.item.draft ? `\nPrevious version (improve on it):\n${packageToText(a.item.draft, a.item.media)}` : ''}
${a.guidance ? `\nThe manager adds: ${a.guidance}` : ''}`,
    PostPackage, 'post');
  return asMedia(r, a.item.media);
}

export async function revisePost(llm: LLM, a: { item: Item; instruction: string; profile: Profile }) {
  const r = await llm.json(
    `Revise this social post following the instruction. Change only what the instruction asks for; keep the rest as it is (same slides, same wording where it is not concerned).
${POST_RULES}

${voice(a.profile)}

Instruction: ${a.instruction}

Current post:
${packageToText(a.item.draft, a.item.media)}`,
    PostPackage, 'post_revision');
  return asMedia(r, a.item.media);
}
