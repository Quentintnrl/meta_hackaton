import { z } from 'zod';

export const ItemKind = z.enum(['changelog', 'release-notes', 'devlog', 'social-post', 'teaser', 'doc-update', 'demo-script', 'newsletter']);
export type ItemKind = z.infer<typeof ItemKind>;

// idea = the team proposed it and waits for the manager, rejected = the manager said no (the reason is kept: the team learns from it), briefed = the user said what they want, drafted = text exists, approved = the user signed it off.
export const ItemStatus = z.enum(['idea', 'briefed', 'drafted', 'approved', 'published', 'rejected']);
export type ItemStatus = z.infer<typeof ItemStatus>;

export const PublishMode = z.enum(['local', 'assisted', 'connected']);
export type PublishMode = z.infer<typeof PublishMode>;

// How a piece leaves the studio. `local` = the manager posts it by hand and
// marks it here (no Meta app needed); `assisted` = same, via a scheduler
// (Buffer, Later, Business Suite); `connected` = the studio posts it through
// the configured publisher, which needs a working Meta app.
export interface Profile {
  voice: string; // how the project speaks
  audience: string; // who reads it
  language: string;
  autoDraft: boolean; // draft on its own when an item gets close; it never approves or publishes
  autopilot?: boolean; // the team works on its own: a daily watch of the field and the account, proposals when nothing waits; it never posts
  niche: string; // what the project is about, for the scout
  directives: string; // standing orders from the manager, read by every agent
  publishMode: PublishMode; // local by default: nothing depends on Meta
  cadence?: Record<string, number>; // posts a week the manager aims for, per platform: the Platforms page counts against it
}

export const defaultProfile: Profile = { voice: '', audience: '', language: 'English', autoDraft: false, autopilot: false, niche: '', directives: '', publishMode: 'local', cadence: {} };

export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  intent: string; // what the user wants, in their words: the AI plans content from it
  targetDate: string; // YYYY-MM-DD, the date the user wants
  startDate: string;
  scope: number; // how many features this milestone is expected to take
  status: 'open' | 'done';
  doneAt?: string;
  featureIds: string[];
  createdAt: string;
}

// One projection of when the milestone lands. Forecasts are kept, never overwritten: that history is how the AI is held to account.
export interface Forecast {
  id: number;
  milestoneId: string;
  madeAt: string;
  predictedDate: string;
  rawRemainingDays: number; // the projection before correction, so errors are measured on the model and not on its corrections
  calibration: number; // the correction applied (1 = none)
  done: number;
  scope: number;
  confidence: 'low' | 'medium' | 'high';
  note: string; // what changed since the previous forecast, in words
}

// What a social post is made of: a description (the item's `draft`), hashtags, and one or more pieces of media.
export type MediaFormat = 'image' | 'carousel' | 'video';
export interface Slide {
  kind: 'image' | 'video'; // video = a shot of the storyboard: the video itself is filmed or edited by the manager
  visual: string; // what is on screen; for an image this is the prompt sent to the image model
  text: string; // text on the image, or the voiceover of the shot
  seconds: number; // video shots only, 0 otherwise
  file?: string; // generated picture (the image itself, or a keyframe of the shot)
}
export interface Media { format: MediaFormat; hashtags: string[]; slides: Slide[] }

// '#Meal Prep', 'mealprep' and '##mealprep' are one hashtag.
export function normalizeHashtags(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const clean = t.replace(/[^\p{L}\p{N}_]/gu, '');
    if (clean && !out.some(o => o.toLowerCase() === `#${clean}`.toLowerCase())) out.push(`#${clean}`);
  }
  return out.slice(0, 20);
}

export type ItemSource = 'trend' | 'account' | 'roadmap' | 'manager' | '';

// A measured figure the Scout found in the field, with where it comes from.
// value 0 and unit '' mean no figure was found: the UI says so instead of guessing.
export interface Figure { what: string; value: number; unit: string; source: string; period: string }
export const NO_FIGURE: Figure = { what: '', value: 0, unit: '', source: '', period: '' };
export const hasFigure = (f?: Figure): f is Figure => Boolean(f && (f.value > 0 || f.unit));
// A reference number for the field as a whole: posting frequency, ideal length, typical engagement rate.
export interface Benchmark { name: string; value: number; unit: string; note: string; source: string }
// How a format scores on this account: average engagement, how many posts, and its rank among the formats.
export interface YourScore { value: number; posts: number; rank: number; of: number }
// Why a piece is worth doing, in numbers: the format it uses, how that format scores here, and the field
// figure it leans on. Computed on the server from the stats, never written by the model.
export interface Proof { format: string; yours?: YourScore; field?: Figure; text: string }
// The Director's plan for the coming weeks: a format mix, each line with the numbers behind it.
export type PlanLever = 'double-down' | 'fill-gap' | 'test' | 'keep';
export interface PlanLine { format: string; count: number; lever: PlanLever; why: string; yours?: YourScore; field?: Figure }
export interface Plan { period: string; headline: string; mix: PlanLine[]; cadence: string; next: string; basis: { posts: number; audited: boolean } }

// Everything the manager needs to post a piece by hand: the exact text to
// paste (caption, then hashtags), the media files to attach, and where the
// signed-off copy lives. No Meta app involved.
export interface ExportPack {
  copyText: string;
  caption: string;
  hashtags: string[];
  mediaFiles: string[];
  exportedPath?: string;
}

// The concrete shape of a proposal, so the manager can judge it without reading a report.
export interface Pitch { hook: string; channel: string; measure: string; context?: string; audience?: string } // context: the situation this piece answers; audience: who exactly reads it

export interface Item {
  id: string;
  projectId: string;
  milestoneId?: string;
  featureId?: string;
  kind: ItemKind;
  title: string;
  brief: string; // what the user wants this piece to say
  draft: string;
  status: ItemStatus;
  offsetDays?: number; // date relative to the milestone's forecast: the item moves when the forecast does
  fixedDate?: string; // or a date the user locked
  origin: 'user' | 'ai' | 'dev';
  seriesId?: string; // the editorial line it belongs to, if any
  media?: Media; // social posts only
  rationale: string; // why the team proposes it: what it saw in trends, in the account, in the roadmap
  proof?: Proof; // the numbers behind the rationale, computed from the stats
  pitch?: Pitch; // the concrete shape of the piece: its first line, where it goes, what tells us it worked
  source: ItemSource;
  rejectedReason?: string;
  revisions: number;
  exportedPath?: string;
  publishedAt?: string;
  createdAt: string;
}

export const day = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => day(new Date(Date.parse(iso + 'T00:00:00Z') + n * 86_400_000));
export const daysBetween = (a: string | Date, b: string | Date) => (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;

export type AgentId = 'director' | 'scout' | 'analyst' | 'strategist' | 'writer';
export const WORKERS = ['scout', 'analyst', 'strategist', 'writer'] as const; // the director leads them, it is not one of them

// How the manager runs one agent: on or off, how many of it work at once, and what it has been told to do differently.
export interface AgentConfig { enabled: boolean; workers: number; instructions: string }
export const MAX_WORKERS = 3;
export const defaultAgentConfig: AgentConfig = { enabled: true, workers: 1, instructions: '' };

// What an agent offers the manager after a question. Nothing happens until the manager clicks.
// `by` is the agent who offered it; `why` says in one line what it changes.
export interface SuggestedAction {
  kind: 'run' | 'configure' | 'talk' | 'generate' | 'revise' | 'rebrief' | 'propose' | 'date';
  label: string;
  why?: string;
  by?: AgentId;
  agents?: AgentId[]; // run
  brief?: string; // run: what they are asked; rebrief, propose: the brief of the piece
  agent?: AgentId; // configure, talk
  enabled?: boolean; // configure
  workers?: number; // configure
  instructions?: string; // configure
  itemId?: string; // generate, revise, rebrief, date: the piece concerned
  index?: number; // generate: one shot (0-based), or every missing shot when absent
  instruction?: string; // revise: the change to make to the text
  title?: string; // propose
  hook?: string; // propose
  channel?: string; // propose
  pieceKind?: ItemKind; // propose
  date?: string; // propose, date: YYYY-MM-DD
}
// One link of the chain a piece follows: who did what, when, in a few words. 'you' is the manager.
export type StepKind = 'proposed' | 'added' | 'accepted' | 'refused' | 'restored' | 'drafted' | 'revised' | 'edited' | 'picture' | 'approved' | 'posted' | 'matched' | 'reused' | 'asked' | 'answered';
export interface Step { kind: StepKind; who: AgentId | 'you'; text: string; at: string }
// `agent`: who answered (agent messages in a team thread); `basis`: what the answer was grounded in, as labels.
export interface ChatMessage { id: number; thread: string; role: 'user' | 'agent'; text: string; actions: SuggestedAction[]; at: string; agent?: AgentId; basis?: string[] }

// What a posted piece got once it is tied to the real post: the numbers a week later, against what the pitch promised.
export interface Outcome { postId: number; platform: string; text: string; postedAt: string; likes: number; comments: number; shares: number; saves: number; views?: number; daysSince: number }
// A real post that looks like a posted piece, waiting for the manager to confirm the link.
export interface Match { postId: number; platform: string; text: string; postedAt: string; why: string }
export interface AccountPost { id?: number; platform?: string; text: string; format: string; likes: number; comments: number; shares: number; saves: number; views?: number; postedAt: string; simulated: boolean; itemId?: string } // views: impressions when the platform shows them (LinkedIn does, Instagram's public page does not) // itemId: the studio piece this post came from, linked by the manager
export interface Series { id: string; projectId: string; name: string; createdAt: string } // a recurring editorial line: a pillar or a series
export interface ItemLink { parentId: string; childId: string; kind: 'reuse'; createdAt: string } // a piece derived from another: recycle, decline, retry
export interface Activity { id: number; projectId: string; agent: AgentId; summary: string; ok: boolean; at: string }
export interface Report<T = unknown> { id: number; kind: 'audit' | 'account' | 'synthesis' | 'plan' | 'watch'; data: T; simulated: boolean; at: string }

// What the Scout saw at comparable players: concrete posts and pages, each with its link, and the market they draw.
export interface Find { title: string; url: string; account: string; platform: string; whatItIs: string; number: string; whyForYou: string; format: string }
// One comparable player, as a short profile: where it stands, how big, who it talks to, what it publishes, and the room it leaves.
export interface Strategy { rhythm: string; formats: string; subjects: string; tone: string; voices: string; callsToAction: string; lesson: string }
export interface Player { name: string; url: string; what: string; place?: string; size?: string; audience?: string; channels?: string; publishes?: string; strength?: string; opening?: string; strategy?: Strategy }
// A date the audience gathers around, and what to post about it, when.
export interface Event { name: string; when: string; why: string; post?: string }
// `trail`: what the Scout did to get there when it worked as an agent (searches made, pages opened), newest last.
export interface Watch { market: string; players: Player[]; finds: Find[]; events: Event[]; sources: string[]; trail?: string[] }
// The size of the audience on one platform at one moment: a trend once there are two.
export interface Snapshot { at: string; platform: string; followers: number; posts: number }
export const engagement = (p: Pick<AccountPost, 'likes' | 'comments' | 'shares' | 'saves'>) => p.likes + p.comments * 2 + p.shares * 3 + p.saves * 3;
