import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { isAbort, type AgentOpts, type LLM, type Tool } from '../adapters/llm.ts';
import type { ContentService } from './service.ts';
import { parseAccountCsv } from './service.ts';
import { loadInstagram, readInstagram, type InstagramConfig } from './instagram.ts';
import { scoutTools } from './scout-tools.ts';
import { accountFacts, factsText } from './facts.ts';
import { CAN, EMPTY_ACTION, ROLE_OF, Reply, actionsFrom, groundFor, routeAgent, type Subject } from './talk.ts';
import { ItemKind, MAX_WORKERS, NO_FIGURE, WORKERS, addDays, day, engagement, hasFigure, type AccountPost, type AgentConfig, type AgentId, type ChatMessage, type Figure, type Item, type Milestone, type Plan, type Proof, type SuggestedAction, type Watch } from './types.ts';

export const AGENTS: Array<{ id: AgentId; name: string; role: string }> = [
  { id: 'director', name: 'Director', role: 'Leads the team and sums up its work' },
  { id: 'scout', name: 'Scout', role: 'Watches what works in your field' },
  { id: 'analyst', name: 'Analyst', role: 'Compares it with your account' },
  { id: 'strategist', name: 'Strategist', role: 'Reads your roadmap, proposes content' },
  { id: 'writer', name: 'Writer', role: 'Drafts what you accept' },
];

// How every agent talks to the manager: an AI advisor, never the creator,
// answering the question with evidence instead of roleplay.
const CHAT_IDENTITY = `You are an AI advisor, not the creator: the manager is the human who builds the project and films the videos. Never speak as them (no "I chose", "my videos", "I film", "my design skills"): speak to them ("you", "your beta"). Never apologise, never narrate yourself ("I got excited", "I ramble"), no chit-chat.
Answer the question that was asked, nothing else. Ground every claim in what you can see: the piece or goal in context, the field research, the account numbers, the roadmap. Name titles, formats and numbers concretely. Say "(demo data)" when a figure comes from the fictional demo account. If the context is too thin to answer well, ask exactly one focused question instead of inventing.
Reply in the same language as the manager's last message.`;
// Blind by default: the chat model only gets text, never the pictures.
const BLIND = `You cannot see pictures or videos, only the written brief each shot was made from: if asked what one shows, quote that brief, say you cannot look at the image itself, and offer to change the brief. Never pretend you looked at it.`;
// Attached pictures change that: describe what is really on them.
const SIGHTED = `Pictures of the piece are attached to this chat: you can really see them. When asked what a post shows, describe what is actually on the pictures and quote on-image text exactly, instead of the brief. Offer to change the brief when what you see is off.`;

// A number the research text actually gives, with its source. value 0 and unit '' = none found, never a guess.
const FigureSchema = z.object({ what: z.string(), value: z.number().min(0), unit: z.string(), source: z.string(), period: z.string() });
export const Audit = z.object({
  summary: z.string(),
  whatWorks: z.array(z.object({
    format: z.string(), why: z.string(), example: z.string(), strength: z.number().int().min(1).max(5), // strength: how strongly it works, 5 = the best
    figure: FigureSchema.default(NO_FIGURE), // the measured figure behind it (engagement rate, saves, views…)
    exampleUrl: z.string().default(''), // where the example can be seen, '' when the text gives no link
    exampleFigure: z.string().default(''), // the example's own number as written ("12k saves"), '' when none
  })).max(5),
  hooks: z.array(z.string()).max(5),
  topics: z.array(z.string()).max(6),
  avoid: z.array(z.string()).max(4),
  misses: z.array(z.object({ format: z.string(), why: z.string(), example: z.string() })).max(4).default([]), // formats and angles that fall flat, each with a concrete example seen in the field
  benchmarks: z.array(z.object({ name: z.string(), value: z.number().min(0), unit: z.string(), note: z.string(), source: z.string() })).max(6).default([]), // reference figures for the field: posting frequency, ideal length, typical engagement rate
});
export type Audit = z.infer<typeof Audit> & { sources: string[] };

export const AccountAnalysis = z.object({
  summary: z.string(),
  strengths: z.array(z.string()).max(4),
  gaps: z.array(z.string()).max(4), // what the field does that this account does not
  opportunities: z.array(z.string()).max(4),
  winners: z.array(z.object({ text: z.string(), format: z.string(), engagement: z.number().int().min(0), note: z.string() })).max(3).default([]), // the strongest posts, one line each on why they won
  losers: z.array(z.object({ text: z.string(), format: z.string(), engagement: z.number().int().min(0), note: z.string() })).max(3).default([]), // the weakest posts, one line each on why they flopped
  fixes: z.array(z.object({
    problem: z.string(), // what is wrong, in one plain sentence with the number that shows it
    fix: z.string(), // what to do about it, concrete: a kind of post, a change of channel, a rhythm, a question to ask
    firstStep: z.string(), // the very first post or action, described so the Writer could start from it
  })).max(3).default([]), // the diagnosis turned into solutions: never a question back to the manager
  readings: z.array(z.object({
    fact: z.enum(['pace', 'trend', 'question', 'length', 'weekday', 'words', 'reach', 'hooks']), // which computed fact this reads
    meaning: z.string(), // what this fact says about this account, one sentence, without restating the numbers the drawing already shows
    action: z.string(), // what to change because of it, one concrete sentence, shown first; "nothing" when the fact asks for nothing
  })).max(8).default([]), // one reading per computed fact: the drawing shows the number, this says what it means
});
export interface FormatStat { format: string; posts: number; avgEngagement: number }
export type AccountReport = z.infer<typeof AccountAnalysis> & { stats: FormatStat[]; postCount: number };

const Proposals = z.object({
  proposals: z.array(z.object({
    kind: ItemKind,
    title: z.string(),
    brief: z.string(),
    rationale: z.string(), // why this piece, in one or two sentences: which trend, which gap in the account, which part of the roadmap
    evidence: z.string().max(200).default(''), // the concrete proof with numbers, e.g. "tutorials average 412 here vs 180 in the field"
    format: z.string().default(''), // the content format it uses, named as in the account stats or the field research (tutorial, meme…); '' when none applies
    hook: z.string().default(''), // the first line of the post, written as it would be published, in the project's language
    channel: z.string().default(''), // where it goes: the network or place, one word or two (Instagram, LinkedIn, newsletter…)
    measure: z.string().default(''), // what tells the manager it worked, one short sentence, something they can count (sign-ups, replies, a named person reacting), never "engagement"
    context: z.string().default(''), // the situation this piece answers, two or three sentences: what the audience is living right now, what the account did or did not do about it, what is being built
    audience: z.string().default(''), // who exactly reads this one, a few words (not the whole audience of the project)
    source: z.enum(['trend', 'account', 'roadmap']),
    milestoneId: z.string(), // '' when it hangs on no milestone
    offsetDays: z.number().int().min(-60).max(30), // relative to the milestone landing
    date: z.string(), // YYYY-MM-DD, used when there is no milestone
  })).min(1).max(6),
});

// What the Scout saw at comparable players, condensed: every find keeps its link, nothing without one.
const WatchSchema = z.object({
  market: z.string(), // who the comparable players are and where the audience is, in three or four plain sentences
  players: z.array(z.object({
    name: z.string(), url: z.string(),
    what: z.string(), // what they sell or do, one line
    place: z.string().default(''), // where they stand in the market: leader, historic publisher, challenger, media, association, public body… with the one fact that shows it
    size: z.string().default(''), // the figures found: customers, communes, followers, years, staff; '' when none
    audience: z.string().default(''), // who they talk to
    channels: z.string().default(''), // where they publish, with the rhythm when seen ("LinkedIn 3 posts a week, a newsletter, salons")
    publishes: z.string().default(''), // what they actually publish, concretely: the kinds of posts and subjects seen, with an example
    strength: z.string().default(''), // what they do well that this project cannot match today
    opening: z.string().default(''), // what they leave uncovered, that this project could take: subject, tone, audience, format
    strategy: z.object({
      rhythm: z.string().default(''), // how often, on which network ("LinkedIn 3 posts a week, a newsletter a month")
      formats: z.string().default(''), // the formats they lean on, in order (carousels, event photos, customer videos, articles…)
      subjects: z.string().default(''), // what they talk about, the three or four recurring subjects
      tone: z.string().default(''), // how they speak: institutional, expert, warm, salesy… with a telling phrase
      voices: z.string().default(''), // who speaks: the brand page only, the founders, the sales people, customers in testimonials
      callsToAction: z.string().default(''), // what they ask the reader to do: book a demo, download a guide, come to a stand, comment…
      lesson: z.string().default(''), // what this project should copy or avoid from it, one sentence
    }).default({ rhythm: '', formats: '', subjects: '', tone: '', voices: '', callsToAction: '', lesson: '' }),
  })).max(8),
  finds: z.array(z.object({
    title: z.string(), // the post or page, in a few words
    url: z.string(), // its link, exactly as found; drop the find when there is none
    account: z.string(), // who published it
    platform: z.string(), // LinkedIn, Instagram, blog, newsletter, press…
    whatItIs: z.string(), // what the piece is and does, one sentence
    number: z.string(), // any visible figure as written ("140 likes", "2.3k views"), '' when none
    whyForYou: z.string(), // what this project could take from it, one concrete sentence
    format: z.string(), // carousel, reel, testimonial, event, case study…
  })).max(12),
  events: z.array(z.object({
    name: z.string(), when: z.string(),
    why: z.string(), // what the audience is doing at that moment, and why it matters to them
    post: z.string().default(''), // what this project should post about it and when (a week before, the day, after), one concrete sentence
  })).max(5), // dates the audience gathers around (salons, deadlines, seasons)
});

const AccountParse = z.object({
  posts: z.array(z.object({
    text: z.string(), format: z.string(), likes: z.number().int().min(0), comments: z.number().int().min(0), shares: z.number().int().min(0), saves: z.number().int().min(0), postedAt: z.string(),
  })).max(60),
});

// The Director's plan: a format mix for the coming weeks. The numbers next to each line are added by the server.
const PlanSchema = z.object({
  period: z.string(), // "the next 4 weeks"
  headline: z.string(),
  mix: z.array(z.object({ format: z.string(), count: z.number().int().min(0).max(30), lever: z.enum(['double-down', 'fill-gap', 'test', 'keep']), why: z.string() })).min(1).max(6),
  cadence: z.string(), // "two posts a week, Tuesday and Saturday"
  next: z.string(),
});

// "Behind-the-scenes" and "behind the scenes" are one format; "quick tutorial" matches "tutorial".
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function sameFormat(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const ys = y.split(' ');
  return x.split(' ').some(t => t.length > 3 && ys.includes(t));
}

// The numbers behind a piece or a plan line: how the format scores on this account, and the field figure for
// it. Computed from the stats, so the model can name a format but never write its score.
export function proofFor(format: string, text: string, stats: FormatStat[], audit?: Audit): Proof | undefined {
  if (!format.trim()) return text ? { format: '', text } : undefined;
  const i = stats.findIndex(s => sameFormat(s.format, format));
  const yours = i >= 0 ? { value: stats[i].avgEngagement, posts: stats[i].posts, rank: i + 1, of: stats.length } : undefined;
  const w = audit?.whatWorks.find(x => sameFormat(x.format, format));
  const field: Figure | undefined = w && hasFigure(w.figure) ? w.figure : undefined;
  if (!yours && !field && !text) return undefined;
  return { format, ...(yours ? { yours } : {}), ...(field ? { field } : {}), text };
}

export function formatStats(posts: AccountPost[]): FormatStat[] {
  const by = new Map<string, number[]>();
  for (const p of posts) by.set(p.format, [...(by.get(p.format) ?? []), engagement(p)]);
  return [...by].map(([format, xs]) => ({ format, posts: xs.length, avgEngagement: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) })).sort((a, b) => b.avgEngagement - a.avgEngagement);
}

// Fictional posts to try the team without an account. Always flagged `simulated`: never shown as real measures.
export function demoAccount(name: string, now: Date): AccountPost[] {
  const rows: Array<[string, string, number, number, number, number]> = [
    ['behind-the-scenes', `How we built ${name}'s first screen, mistakes included`, 410, 38, 52, 71],
    ['behind-the-scenes', `A week of building ${name}: what broke`, 360, 41, 33, 48],
    ['tutorial', `3 ways to get more from ${name} in 30 seconds`, 220, 14, 61, 130],
    ['tutorial', `Quick start: your first result with ${name}`, 190, 9, 44, 98],
    ['release', `${name} 0.2 is out: what's new`, 95, 6, 8, 12],
    ['release', `New in ${name}: small fixes, big relief`, 70, 3, 5, 6],
    ['announcement', `${name} is looking for its first testers`, 140, 22, 19, 9],
    ['meme', `Me, after fixing one bug and creating two`, 520, 27, 140, 12],
    ['behind-the-scenes', `The fridge photo that started it all: our planner was a whiteboard`, 280, 25, 30, 40],
    ['tutorial', `Sunday reset: plan 5 dinners in 12 minutes`, 310, 18, 80, 150],
    ['question', `What ruins your weeknight dinners? Mine is the 6pm fridge stare`, 150, 64, 12, 8],
    ['testimonial', `I stopped ordering takeout on Tuesdays`, 260, 20, 45, 60],
    ['release', `${name} 0.3 is out: recipe search is here`, 120, 10, 14, 20],
    ['meme', `POV: it's 6pm and the fridge is empty`, 610, 31, 170, 15],
  ];
  return rows.map(([format, text, likes, comments, shares, saves], i) => ({ text, format, likes, comments, shares, saves, postedAt: addDays(day(now), -4 - i * 5), simulated: true }));
}

const directives = (svc: ContentService, projectId: string) => {
  const p = svc.profile(projectId);
  return [p.directives && `Standing orders from the manager (follow them): ${p.directives}`, p.voice && `Voice: ${p.voice}`, p.audience && `Audience: ${p.audience}`, `Language: ${p.language}`].filter(Boolean).join('\n');
};

// What the manager told one agent to do differently. Added to that agent's prompts.
const behaviour = (svc: ContentService, projectId: string, agent: AgentId) => {
  const i = svc.store.agentConfig(projectId, agent).instructions.trim();
  return i ? `\nSpecific instructions from the manager for you (${agent}), follow them: ${i}` : '';
};

const Synthesis = z.object({ headline: z.string(), points: z.array(z.string()).min(1).max(4), next: z.string() });
export type Synthesis = z.infer<typeof Synthesis>;

// Every angle asks for measured figures with their source: the field page shows numbers, or says none were found.
const ANGLES = [
  'which formats and post types get the most engagement, with one concrete example each (its link if possible) and the measured figures behind them: average engagement rate, saves, views or reach, each with its source and date',
  'recurring hooks, topics and questions people respond to, and the benchmarks for this field: posting frequency, ideal length, typical engagement rate for accounts of this size, each with its source',
  'what falls flat or backfires (with a measured example), and what the leading accounts in this field do differently, with their numbers',
];
const LENSES = ['the dev roadmap: what is about to land and when', 'the project account: its strengths and gaps against the field', 'the trends found in the field research'];

// One session per subject: the bare agent thread, or `agent:item:<id>` /
// `agent:milestone:<id>`. Anything else falls back to the bare agent thread.
export function chatThread(agent: AgentId | 'team', about: string): string {
  return /^(item|milestone):[A-Za-z0-9_-]{1,60}$/.test(about) ? `${agent}:${about}` : agent;
}

// Pictures the manager may ask about: data URLs of the generated shots of one
// piece, so the chat model really sees them. Missing files just mean no vision.
function picturesFor(svc: ContentService, projectId: string, about: string): string[] {
  const m = /^item:([A-Za-z0-9_-]{1,60})$/.exec(about);
  if (!m) return [];
  const item = svc.store.item(m[1]);
  if (!item || item.projectId !== projectId || !item.media) return [];
  const urls: string[] = [];
  for (const s of item.media.slides) {
    if (!s.file || urls.length >= 3) continue;
    try {
      const path = svc.mediaPath(item.id, s.file);
      if (!path) continue;
      const mime = s.file.endsWith('.png') ? 'image/png' : 'image/jpeg';
      urls.push(`data:${mime};base64,${readFileSync(path).toString('base64')}`);
    } catch { /* answer from the brief instead */ }
  }
  return urls;
}

// The small communication team. Each agent reads what it needs, writes a report or proposals, and logs what it did.
export class Team {
  #svc: ContentService;
  #working = new Map<string, { agent: AgentId; since: string }>();
  // One controller per pass: Stop aborts the call in flight and the agents still to come are skipped.
  #runs = new Map<string, AbortController>();
  #stopping = new Set<string>();

  #instagram: () => InstagramConfig | null;
  #fetch?: Parameters<typeof readInstagram>[1];
  #web?: typeof fetch; // the Scout's page opener, replaceable in tests
  // instagram: where the API credentials come from (.env by default); fetch: replaced in tests.
  constructor(svc: ContentService, o: { instagram?: () => InstagramConfig | null; fetch?: Parameters<typeof readInstagram>[1]; web?: typeof fetch } = {}) { this.#svc = svc; this.#instagram = o.instagram ?? loadInstagram; this.#fetch = o.fetch; this.#web = o.web; }

  // --- the connected account: when .env names an Instagram account, the app reads it itself
  // (posts, likes, comments, saves, shares, reach, followers) instead of waiting for a paste.
  connected() { return { instagram: Boolean(this.#instagram()) }; }

  async syncInstagram(projectId: string): Promise<{ username: string; followers: number; posts: number }> {
    const cfg = this.#instagram();
    if (!cfg) throw new Error('no Instagram account connected: put INSTAGRAM_USER_ID and INSTAGRAM_ACCESS_TOKEN in .env (see the README), or paste the posts');
    const r = await readInstagram(cfg, this.#fetch);
    this.#store.setAccount(projectId, r.posts, 'instagram');
    this.#svc.autoMatch(projectId);
    this.#store.snapshot(projectId, { at: this.#svc.now.toISOString(), platform: 'instagram', followers: r.followers, posts: r.posts.length });
    this.#store.log(projectId, 'scout', `Read Instagram @${r.username}: ${r.posts.length} posts, ${r.followers} followers.`, true, this.#svc.now.toISOString());
    return { username: r.username, followers: r.followers, posts: r.posts.length };
  }

  working(projectId: string) { return this.#working.get(projectId); }

  // The manager presses Stop: the model call in flight is aborted, the rest of the pass is skipped, nothing already saved is lost.
  stop(projectId: string): boolean {
    const c = this.#runs.get(projectId);
    if (!c) return false;
    this.#stopping.add(projectId);
    c.abort();
    return true;
  }

  // The model, with the Stop signal of the pass in progress attached to every call (none outside a pass).
  #llm(projectId: string): LLM {
    const base = this.#svc.llm;
    const signal = this.#runs.get(projectId)?.signal;
    if (!signal) return base;
    return {
      json: (p, sc, n, o) => base.json(p, sc, n, { ...o, signal }),
      ...(base.search ? { search: (p: string, o?: { signal?: AbortSignal }) => base.search!(p, { ...o, signal }) } : {}),
      ...(base.agent ? { agent: <T extends z.ZodType>(p: string, t: Tool[], sc: T, n: string, o?: AgentOpts) => base.agent!(p, t, sc, n, { ...o, signal }) } : {}),
    };
  }

  get #store() { return this.#svc.store; }

  // --- the Scout: what works in the field, from the web
  async scout(projectId: string, projectName: string, brief = ''): Promise<Audit> {
    const llm = this.#llm(projectId);
    if (!llm.search) throw new Error('this model backend cannot search the web');
    const profile = this.#svc.profile(projectId);
    const field = profile.niche || profile.audience || projectName;
    const workers = Math.min(MAX_WORKERS, Math.max(1, this.#store.agentConfig(projectId, 'scout').workers));
    const ask = (focus: string) => llm.search!(
      `Research what content currently performs well on social media and developer/product blogs for a project in this field: "${field}"${profile.audience ? `, for ${profile.audience}` : ''}.
${focus}. Be specific and recent.${brief ? `\nThe manager asks: ${brief}` : ''}${behaviour(this.#svc, projectId, 'scout')}`);
    // One researcher covers everything; more researchers each take an angle, in parallel, and their findings are merged.
    const found = workers === 1
      ? [await ask('Find: the formats that get the most engagement (with a concrete example each, its link if possible, and the measured figures behind them: engagement rate, saves, views, with source and date), the benchmarks for this field (posting frequency, ideal length, typical engagement rate, with sources), recurring hooks, topics people ask about, and what falls flat (with a measured example)')]
      : await Promise.all(ANGLES.slice(0, workers).map(ask));
    const text = found.map(f => f.text).join('\n\n');
    const sources = [...new Set(found.flatMap(f => f.sources))];
    const a = await llm.json(`Condense this research into an audit. Keep only what is supported by the text. Short phrases. For each format, strength says how strongly it works (5 = the best of the lot).
figure is a number that appears in the text for that format: value, unit ("%", "saves", "views", "x", "per post"…), what it measures, the source URL and the period. If the text gives no number for a format, put value 0 and unit "": never invent one. exampleUrl is the link of the example when the text gives one, else "". exampleFigure is the example's own number as written ("12k saves"), else "".
benchmarks: up to 6 reference figures found in the text (posting frequency, ideal length, typical engagement rate…), each with its source URL; leave the list empty rather than guess.
Fill misses with the formats and angles that fall flat, each with a concrete example seen in the field.\n\n${text}`, Audit, 'audit');
    const audit: Audit = { ...a, sources: sources.slice(0, 6) };
    this.#store.addReport(projectId, 'audit', audit, false, this.#svc.now.toISOString());
    return audit;
  }

  // --- the Scout, second job: what comparable players actually post, with the links, and the market they draw.
  // With a backend that runs tools, the Scout works as an agent: it searches, opens the pages it names (a company
  // page, a LinkedIn page, a programme) and checks a figure or a rhythm before reporting it, as many steps as it
  // decides within a budget; every step is kept as its trail. Otherwise two searches and one condensation.
  async watch(projectId: string, projectName: string): Promise<Watch> {
    const llm = this.#llm(projectId);
    if (!llm.search) throw new Error('this model backend cannot search the web');
    const profile = this.#svc.profile(projectId);
    const field = profile.niche || projectName;
    const who = profile.audience ? ` whose audience is ${profile.audience}` : '';
    const country = /fran|mairie|commune/i.test(`${profile.niche} ${profile.audience} ${profile.language}`) ? ' (France, in French where the sources are French)' : '';
    const rules = `Today is ${day(this.#svc.now)}: an event or deadline before that date is past, say so in its "when" or drop it. Keep only what the pages support, with the URLs exactly as found; drop a find without a link. Short, concrete, no filler. Write everything in ${profile.language || 'English'} (names and figures as they are). "whyForYou" says what the project "${projectName}" (${field}) could take from each find, in one sentence a busy person acts on.
For each player fill place, size, audience, channels, publishes, strength, opening and the strategy block (rhythm, formats, subjects, tone, voices, callsToAction, lesson) from what you read (short, concrete, with the figures as written; '' when nothing was found). For each event, "post" says what "${projectName}" should post about it and when.`;
    const trail: string[] = [];
    let w: z.infer<typeof WatchSchema>;
    let sources: string[] = [];
    if (llm.agent) {
      const tools = scoutTools(llm, this.#web);
      w = await llm.agent(`You are the Scout of a small communication team working for the project "${projectName}" (${field}${who}${country}). Build a field watch: the comparable players and their communication strategy, 8 to 12 recent public posts seen at them (last 12 months, with the exact URL), and the upcoming events, salons or seasonal dates (next 6 months) where this audience gathers.
Work it out yourself with the tools: search to find the players and their pages, then open each player's website or LinkedIn page and read it for its real rhythm, formats, subjects, tone and calls to action, and open an event page to confirm its dates. Verify before you report: a figure, a date or a rhythm you give must come from a page or a result you read. When a page refuses you (LinkedIn often does), say so and rely on what the search gave. A find is a dated post, article, press piece or event page, not a home page: search "linkedin.com/posts" with the player's name, their news or blog pages, and the trade press when their own page refuses. Stop when you have 4 to 8 players and the posts and dates, or when you have nothing left to check.
${rules}${behaviour(this.#svc, projectId, 'scout')}`, tools, WatchSchema, 'watch', {
        maxSteps: 14,
        onStep: ({ tool, args, result }) => {
          const url = typeof args.url === 'string' && /^https?:/.test(args.url) ? args.url : '';
          const opened = tool === 'open' || (tool === 'web_search' && args.type === 'open_page') ? url : '';
          const query = tool === 'search' ? String(args.query) : tool === 'web_search' && args.type === 'search' ? String(args.query ?? args.queries ?? '') : '';
          const what = opened ? `Opened ${opened}` : query ? `Searched: ${query}` : tool === 'web_search' ? (args.type === 'open_page' ? 'Read a page from the results' : `Searched the web (${String(args.type ?? '')})`) : `${tool}(${JSON.stringify(args)})`;
          const err = /^Error:/.test(result) ? ` → ${result.slice(7, 90)}` : '';
          trail.push(what + err);
          for (const m of result.matchAll(/https?:\/\/[^\s,)]+/g)) sources.push(m[0]);
          if (opened && !err) sources.push(opened);
        },
      });
    } else {
      const [posts, market] = await Promise.all([
        llm.search(`Find 8 to 12 recent public posts (last 12 months) from companies, products or organisations comparable to "${field}"${who}${country}, on LinkedIn, Instagram, their blog or the press. For each: the account, the exact URL of the post or page, what it is (format: carousel, video, testimonial, event, case study, article…), its hook or subject, and any visible figure (likes, comments, views). Only real, visited pages with their URL; skip anything you cannot link.${behaviour(this.#svc, projectId, 'scout')}`),
        llm.search(`Who are the comparable players for a project like "${field}"${who}${country}? Name 4 to 8 and, for each: its website, what it sells, its place in the market (leader, historic publisher, challenger, media, association…) with a fact that shows it, its size in figures (customers, communes, followers, years, staff), who it talks to, where it publishes and how often, what it actually publishes (kinds of posts and subjects, with an example), what it does well, and what it leaves uncovered. Describe its communication strategy as seen on its pages: rhythm per network, the formats it leans on, its recurring subjects, its tone (quote a telling phrase), who speaks (the brand, founders, sales, customers), and what it asks readers to do (demo, guide, stand, comment). Also list the upcoming events, salons or seasonal dates (next 6 months) where this audience gathers, with dates and what the audience is doing then. Prefer sources you visited.`),
      ]);
      w = await llm.json(`${rules}\nCondense this research.\n\nPOSTS SEEN:\n${posts.text}\n\nMARKET AND EVENTS:\n${market.text}`, WatchSchema, 'watch');
      sources = [...posts.sources, ...market.sources];
    }
    const watch: Watch = { ...w, sources: [...new Set(sources)].slice(0, 12), ...(trail.length ? { trail } : {}) };
    this.#store.addReport(projectId, 'watch', watch, false, this.#svc.now.toISOString());
    return watch;
  }

  // --- on duty: when the manager switched the autopilot on, the team watches on its own, about once a day,
  // and proposes only when nothing waits for a decision. It never writes or posts without the manager.
  duty(projects: Array<{ id: string; name: string }>, every = 24 * 3_600_000): string[] {
    const started: string[] = [];
    for (const p of projects) {
      if (!this.#svc.profile(p.id).autopilot || this.#working.has(p.id)) continue;
      const last = this.#store.activity(p.id, 50).filter(a => a.agent === 'scout' || a.agent === 'analyst').map(a => Date.parse(a.at)).sort((a, b) => b - a)[0];
      if (last && this.#svc.now.getTime() - last < every) continue;
      const waiting = this.#store.items(p.id).some(i => i.status === 'idea');
      if (this.start(p.id, p.name, waiting ? ['scout', 'analyst'] : ['scout', 'analyst', 'strategist'], '')) started.push(p.id);
    }
    return started;
  }

  // --- the Analyst: your account against the field
  async analyse(projectId: string): Promise<AccountReport> {
    const posts = this.#store.account(projectId);
    if (!posts.length) throw new Error('give the team your account first: paste your recent posts with their numbers, or load the demo account');
    const stats = formatStats(posts);
    const audit = this.#store.latestReport<Audit>(projectId, 'audit')?.data;
    const a = await this.#llm(projectId).json(
      `Today is ${day(this.#svc.now)}: a date before it is past, never propose to prepare for it. You compare a project's social account with what works in its field. Be concrete and honest; if the data is thin, say so. When posts get a handful of likes each and no comments, say plainly that formats cannot be told apart on these numbers, name what can still be read (the best and worst posts, the pace, the silence), and do not rank formats.
Engagement = likes + 2*comments + 3*shares + 3*saves. Quote the post texts and engagement numbers below exactly as given: never invent or round them.

FACTS COMPUTED FROM THE POSTS (exact, use them):
${factsText(accountFacts(posts, day(this.#svc.now))!)}

Average engagement per format on this account:
${stats.map(s => `- ${s.format}: ${s.avgEngagement} over ${s.posts} post(s)`).join('\n')}
Recent posts:
${posts.slice(0, 15).map(p => `- [${p.format}] ${p.text} (${engagement(p)})${p.itemId ? ` — this one came from the studio piece "${this.#store.item(p.itemId)?.title ?? p.itemId}": weigh linked pieces as proven winners in strengths and gaps` : ''}`).join('\n')}

Name the 3 strongest posts in winners and the 3 weakest in losers (by the engagement numbers above), each with a one-line note on why it won or flopped.
For each block of the computed facts (pace, trend, question, length, weekday, words, reach when present, hooks), give one reading. The drawing already shows every number: do not repeat them in "meaning". Say in one sentence what the pattern means for this account (and "too few posts to trust" when a group is under eight), then in "action" the one concrete thing to change, said first and short: a kind of post, a day, a length, a line to open with.
Then turn the diagnosis into up to 3 fixes. Each names the problem with the number that shows it, the fix (a kind of post, a channel, a rhythm, a question to ask the audience, a thing to show), and the first step: the first post or action, described so the Writer could start from it. Never ask the manager what they want: decide, and say it.

What works in the field: ${audit ? JSON.stringify({ whatWorks: audit.whatWorks, hooks: audit.hooks, topics: audit.topics }) : '(the scout has not reported yet)'}
${directives(this.#svc, projectId)}${behaviour(this.#svc, projectId, 'analyst')}`,
      AccountAnalysis, 'account_analysis');
    const report: AccountReport = { ...a, stats, postCount: posts.length };
    this.#store.addReport(projectId, 'account', report, posts.every(p => p.simulated), this.#svc.now.toISOString());
    return report;
  }

  // The manager gives the numbers as they come: free text from the platform, or a copy of an export (CSV with a
  // text,likes header is read exactly, with no model call and no invented numbers). The model only structures free-form pastes.
  async importAccount(projectId: string, pasted: string, platform = 'instagram'): Promise<AccountPost[]> {
    const exact = parseAccountCsv(pasted, day(this.#svc.now));
    if (exact) {
      if (!exact.length) throw new Error('no post found in that text');
      this.#store.setAccount(projectId, exact.map(p => ({ ...p, platform })), platform);
      this.#svc.autoMatch(projectId);
      return exact;
    }
    const r = await this.#llm(projectId).json(
      `Extract the posts from this text, exactly as given. Do not invent posts or numbers: use 0 for a figure that is missing.
format is a short label for the kind of post (tutorial, behind-the-scenes, release, announcement, meme, tip, story…). postedAt is YYYY-MM-DD, or "${day(this.#svc.now)}" when unknown.

${pasted.slice(0, 12000)}`, AccountParse, 'account_import');
    const posts = r.posts.map(p => ({ ...p, platform, postedAt: /^\d{4}-\d{2}-\d{2}$/.test(p.postedAt) ? p.postedAt : day(this.#svc.now), simulated: false }));
    if (!posts.length) throw new Error('no post found in that text');
    this.#store.setAccount(projectId, posts, platform);
    this.#svc.autoMatch(projectId);
    return posts;
  }

  loadDemoAccount(projectId: string, name: string) {
    this.#store.setAccount(projectId, demoAccount(name, this.#svc.now));
  }

  // --- the Strategist: reads the audit, the account and the dev roadmap, proposes content
  async strategize(projectId: string, brief = ''): Promise<Item[]> {
    const svc = this.#svc;
    const today = day(svc.now);
    const milestones = svc.milestones(projectId).filter(m => m.status === 'open');
    const features = svc.projectFeatures(projectId);
    const commits = await svc.recentCommits(projectId).catch(() => []);
    const audit = this.#store.latestReport<Audit>(projectId, 'audit');
    const account = this.#store.latestReport<AccountReport>(projectId, 'account');
    const all = this.#store.items(projectId);
    const rejected = all.filter(i => i.status === 'rejected').slice(-8);
    const live = all.filter(i => i.status !== 'rejected');
    // What was posted and what it got, against what the pitch promised: the loop between proposing and measuring.
    const posted = svc.calendar(projectId).filter(i => i.status === 'published' && i.outcome).slice(-8)
      .map(i => `- ${i.kind} "${i.title}" (${i.outcome!.platform}, ${i.outcome!.postedAt}): ${i.outcome!.likes} likes, ${i.outcome!.comments} comments, ${i.outcome!.shares} shares${i.outcome!.views ? `, ${i.outcome!.views} views` : ''} after ${i.outcome!.daysSince} days${i.pitch?.measure ? `; we said we would count: ${i.pitch.measure}` : ''}`);

    const ask = (lens: string, count: string) => this.#llm(projectId).json(
      `You are the strategist of a small digital communication team working for a solo developer (the manager).
Today is ${today}. Propose ${count} pieces of content for the coming weeks.${lens ? ` Look at the situation mainly through ${lens}.` : ''} Every piece must be justified by evidence you can see below: a trend from the audit, a gap or strength in the account, or something in the dev roadmap (a feature about to land, a milestone date). Say which in "rationale", in plain words a busy person reads once, naming the one fact it rests on (a named post with its number and date, a feature, a date, an example from the field). Put the hard numbers behind it in "evidence" (formats with their scores, named winning or flopping posts, never invented figures). When the account's numbers are too small to tell formats apart (a few likes each, no comments), say so in the rationale instead of ranking formats, and rest the piece on something else: what is being built, who the audience really is, where they are, one concrete example from the field.
Write "hook" as the real first line of the post, in the project's language and voice. Name the "channel" where the audience actually is (the account's own network, or another one when the audience is elsewhere: say why in the rationale). In "measure", say what the manager will count a week later to know it worked, something concrete (sign-ups, replies, a specific kind of person reacting), not engagement in general. In "format", name the content format the piece uses with the same word as in the account stats or the field research (tutorial, meme, behind-the-scenes…), or leave it empty.
In "context", give the situation in two or three sentences, so that someone who has not read the research understands why now: what the audience is living at this moment (a season, a deadline, a habit), what the account has already said or not said about it, and what the project is building that relates. In "audience", name who exactly this one piece is for (a role, a size of commune, a moment in their week), not the whole audience.
Prefer the roadmap for timing: tie a piece to a milestone with offsetDays (negative = before it lands), or leave milestoneId empty and give a date.
Do not repeat existing pieces. Do not propose again what the manager refused, and apply the reasons they gave.

${directives(svc, projectId)}${behaviour(svc, projectId, 'strategist')}
${brief ? `The manager asks for this now: ${brief}` : ''}

WHAT WORKS IN THE FIELD:
${audit ? JSON.stringify({ whatWorks: audit.data.whatWorks, benchmarks: audit.data.benchmarks ?? [], misses: audit.data.misses ?? [], hooks: audit.data.hooks, topics: audit.data.topics, avoid: audit.data.avoid }) : '(no audit yet)'}

THIS PROJECT'S ACCOUNT${account?.simulated ? ' (fictional demo data)' : ''}:
${account ? JSON.stringify({ summary: account.data.summary, strengths: account.data.strengths, gaps: account.data.gaps, bestFormats: account.data.stats.slice(0, 3), winners: account.data.winners ?? [], losers: account.data.losers ?? [] }) : '(no account analysis yet)'}

DEV ROADMAP:
Milestones:
${milestones.map((m: Milestone & { forecast?: { predictedDate: string } }) => `- id=${m.id} "${m.title}": ${m.intent || 'no description'}; wanted ${m.targetDate}${m.forecast ? `, projected ${m.forecast.predictedDate}` : ''}`).join('\n') || '(none)'}
Features:
${features.map(f => `- ${f.title} [${f.state.toLowerCase().replace(/_/g, ' ')}]${f.summary ? `: ${f.summary}` : ''}`).join('\n') || '(none)'}
Recent commits:
${commits.slice(0, 15).map(c => `- ${c}`).join('\n') || '(none)'}

ALREADY PLANNED:
${live.map(i => `- ${i.kind}: ${i.title}`).join('\n') || '(nothing)'}
POSTED FROM THIS STUDIO, AND WHAT IT GOT (say in the rationale when a piece builds on one that kept its promise, or drops a line that did not):
${posted.join('\n') || '(nothing measured yet)'}
REFUSED BY THE MANAGER:
${rejected.map(i => `- ${i.title}: "${i.rejectedReason || 'no reason given'}"`).join('\n') || '(nothing)'}`,
      Proposals, 'proposals');
    // One strategist sees everything; more of them each take a lens, in parallel, and the proposals are merged.
    const workers = Math.min(MAX_WORKERS, Math.max(1, this.#store.agentConfig(projectId, 'strategist').workers));
    const batches = workers === 1 ? [await ask('', '3 to 6')] : await Promise.all(LENSES.slice(0, workers).map(l => ask(l, '2 to 3')));
    const proposals = batches.flatMap(b => b.proposals);

    const ids = new Set(milestones.map(m => m.id));
    const taken = new Set(all.map(i => i.title.toLowerCase())); // a refused title does not come back either
    // Proposing with no field research or account data is allowed, but the
    // manager must see it is an early sketch, not a grounded plan.
    const missing = [!audit && 'field research', !account && 'account data'].filter(Boolean);
    const mark = missing.length ? ` (Early sketch: no ${missing.join(' or ')} yet — check it against what you know.)` : '';
    const made: Item[] = [];
    const stats = account?.data.stats ?? [];
    for (const p of proposals) {
      if (taken.has(p.title.toLowerCase())) continue;
      taken.add(p.title.toLowerCase());
      const onMilestone = p.milestoneId && ids.has(p.milestoneId);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.date >= today ? p.date : addDays(today, 3);
      const proof = proofFor(p.format, p.evidence, stats, audit?.data);
      const item = this.#store.addItem({
        projectId, kind: p.kind, title: p.title, brief: p.brief,
        rationale: `${p.rationale}${p.evidence ? `\nEvidence: ${p.evidence}` : ''}${mark}`,
        ...(proof ? { proof } : {}),
        ...(p.hook || p.channel || p.measure ? { pitch: { hook: p.hook, channel: p.channel, measure: p.measure, context: p.context, audience: p.audience } } : {}),
        source: p.source, origin: 'ai', status: 'idea', createdAt: svc.now.toISOString(),
        ...(onMilestone ? { milestoneId: p.milestoneId, offsetDays: p.offsetDays } : { fixedDate: date }),
      });
      svc.step(item.id, 'proposed', 'strategist', p.rationale.trim().replace(/\s+/g, ' ').slice(0, 160));
      made.push(item);
    }
    return made;
  }

  // --- the Writer: drafts what the manager accepted and nobody wrote yet
  async write(projectId: string, max?: number): Promise<Item[]> {
    const workers = Math.min(MAX_WORKERS, Math.max(1, this.#store.agentConfig(projectId, 'writer').workers));
    const todo = this.#store.items(projectId).filter(i => i.status === 'briefed' && !i.draft).slice(0, max ?? workers * 2);
    const out: Item[] = [];
    const guidance = behaviour(this.#svc, projectId, 'writer').trim() || undefined;
    // `workers` writers work at the same time.
    for (let i = 0; i < todo.length; i += workers) out.push(...await Promise.all(todo.slice(i, i + workers).map(t => this.#svc.draft(t.id, guidance))));
    return out;
  }

  // --- one run of the whole team, or of one agent. Runs in the background: the console watches `working` and the activity log.
  start(projectId: string, projectName: string, agents: AgentId[], brief = ''): boolean {
    if (this.#working.has(projectId)) return false;
    this.#working.set(projectId, { agent: agents[0], since: this.#svc.now.toISOString() }); // the console sees the team busy from the first instant
    this.#runs.set(projectId, new AbortController());
    this.#stopping.delete(projectId);
    void this.#run(projectId, projectName, agents, brief);
    return true;
  }

  async #run(projectId: string, projectName: string, agents: AgentId[], brief: string) {
    const store = this.#store;
    const nowIso = () => this.#svc.now.toISOString();
    // Say the plan out loud first: who does what, in which order, and what the manager gets.
    const crew = agents.filter(a => a !== 'director');
    if (crew.length) {
      const job: Record<string, string> = { scout: 'researches what works in the field', analyst: 'compares your account with the field', strategist: 'proposes pieces for you to decide on', writer: 'drafts what you accepted' };
      const names: Record<string, string> = Object.fromEntries(AGENTS.map(a => [a.id, a.name]));
      store.addChat(projectId, 'director', 'agent',
        `Here's what I'm doing${brief ? ` for "${brief}"` : ''}: ${crew.map((a, n) => `${n + 1}. ${names[a]} ${job[a]}`).join(', ')}. You decide at each step; nothing is posted on its own.`, [], nowIso());
    }
    let ran = 0, failed = 0;
    const step = async (agent: AgentId, fn: () => Promise<string>) => {
      if (!agents.includes(agent)) return;
      if (!store.agentConfig(projectId, agent).enabled) { store.log(projectId, agent, 'Skipped: switched off by you.', true, nowIso()); return; }
      if (this.#stopping.has(projectId)) { store.log(projectId, agent, 'Skipped: you stopped the pass.', true, nowIso()); return; }
      this.#working.set(projectId, { agent, since: nowIso() });
      ran++;
      try { store.log(projectId, agent, await fn(), true, nowIso()); }
      catch (e) {
        if (this.#stopping.has(projectId) || isAbort(e)) { store.log(projectId, agent, 'Stopped by you before it finished; what was already saved stays.', true, nowIso()); return; }
        failed++; store.log(projectId, agent, (e as Error).message, false, nowIso());
      }
    };
    try {
      // A connected Instagram account is read first, so the Analyst works on today's numbers. Its failure is logged, not fatal.
      if (agents.includes('analyst') && this.#instagram()) {
        this.#working.set(projectId, { agent: 'scout', since: nowIso() });
        try { await this.syncInstagram(projectId); } catch (e) { store.log(projectId, 'scout', (e as Error).message, false, nowIso()); }
      }
      await step('scout', async () => {
        const a = await this.scout(projectId, projectName, brief);
        // Same pass, second job: what comparable players post. Its failure does not lose the audit.
        let watched = '';
        try { const w = await this.watch(projectId, projectName); watched = ` Watched the field${w.trail ? ` in ${w.trail.length} steps (${w.trail.filter(t => t.startsWith('Opened')).length} pages opened)` : ''}: ${w.finds.length} posts at ${w.players.length} comparable players, ${w.events.length} dates to know.`; }
        catch (e) { watched = ` (Could not watch the field: ${(e as Error).message})`; }
        return `Found ${a.whatWorks.length} formats that work and ${a.topics.length} topics. ${a.summary}${watched}`;
      });
      await step('analyst', async () => { const a = await this.analyse(projectId); return `Compared ${a.postCount} posts with the field. ${a.summary}`; });
      await step('strategist', async () => { const n = await this.strategize(projectId, brief); return `Proposed ${n.length} piece(s) of content.${n.length ? ' Waiting for your decision.' : ' Nothing new beyond what is planned.'}`; });
      await step('writer', async () => { const n = await this.write(projectId); return n.length ? `Drafted ${n.length} accepted piece(s).` : 'Nothing accepted is waiting for a draft.'; });
      const stopped = this.#stopping.has(projectId);
      const director = store.agentConfig(projectId, 'director').enabled && !stopped;
      if (stopped) store.log(projectId, 'director', 'Pass stopped by you. The team waits for your next brief.', true, nowIso());
      // New research, numbers or proposals change the plan: the director rewrites it. Asked alone, it only plans.
      const replan = agents.includes('director') || (['scout', 'analyst', 'strategist'] as AgentId[]).some(a => agents.includes(a) && store.agentConfig(projectId, a).enabled);
      if (director && replan && (ran > failed || agents.includes('director'))) {
        this.#working.set(projectId, { agent: 'director', since: nowIso() });
        try { await this.plan(projectId, brief); } catch (e) { store.log(projectId, 'director', `Could not plan: ${(e as Error).message}`, false, nowIso()); }
      }
      // The director sums the run up, once, for the manager. It is skipped when it is off or nothing worked.
      if (ran > failed && director) {
        this.#working.set(projectId, { agent: 'director', since: nowIso() });
        try { await this.synthesize(projectId, brief); } catch (e) { store.log(projectId, 'director', `Could not sum up: ${(e as Error).message}`, false, nowIso()); }
      }
    } finally {
      this.#working.delete(projectId);
      this.#runs.delete(projectId);
      this.#stopping.delete(projectId);
    }
  }

  // --- the Director's plan: the format mix for the coming weeks, every line with the numbers behind it
  async plan(projectId: string, brief = ''): Promise<Plan> {
    const svc = this.#svc;
    const audit = this.#store.latestReport<Audit>(projectId, 'audit');
    const account = this.#store.latestReport<AccountReport>(projectId, 'account');
    const stats = account?.data.stats ?? [];
    const ms = svc.milestones(projectId).filter(m => m.status === 'open') as Array<Milestone & { forecast?: { predictedDate: string } }>;
    const fig = (f: Figure) => hasFigure(f) ? `${f.value}${f.unit.startsWith('%') ? '' : ' '}${f.unit} ${f.what} (${f.source || 'no source'})` : 'no figure found';
    const p = await this.#llm(projectId).json(
      `You are the director of a small digital communication team working for a solo developer (the manager). Write the communication plan for the coming weeks: a format mix, each line with how many pieces and why, in plain words.
Ground every line in the numbers below: this account's average score per format, and the measured field figures. Use the format names exactly as they appear below. Levers: double-down = it scores high here, do more; fill-gap = the field shows it works and this account has little or none; test = try it with one or two pieces; keep = steady baseline. Respect the standing orders (cadence, forbidden topics). No jargon, no filler.
${directives(svc, projectId)}${behaviour(svc, projectId, 'director')}
${brief ? `The manager asks: ${brief}` : ''}

THIS ACCOUNT, average score per format (score = likes + 2*comments + 3*shares + 3*saves)${account?.simulated ? ' (fictional demo data)' : ''}:
${stats.map(s => `- ${s.format}: ${s.avgEngagement} over ${s.posts} post(s)`).join('\n') || '(no account data yet: say so in the headline and keep the plan light)'}
${account ? `Strengths: ${account.data.strengths.join('; ')}. Gaps: ${account.data.gaps.join('; ')}.` : ''}

THE FIELD, measured:
${audit ? audit.data.whatWorks.map(w => `- ${w.format}: ${fig(w.figure ?? NO_FIGURE)}; ${w.why}`).join('\n') : '(no field research yet)'}
${audit?.data.benchmarks?.length ? `Benchmarks: ${audit.data.benchmarks.map(b => `${b.name} ${b.value} ${b.unit}`).join('; ')}.` : ''}

ROADMAP:
${ms.map(m => `- ${m.title}: wanted ${m.targetDate}${m.forecast ? `, projected ${m.forecast.predictedDate}` : ''}`).join('\n') || '(no open goal)'}`,
      PlanSchema, 'plan');
    const plan: Plan = {
      ...p,
      mix: p.mix.map(l => { const pr = proofFor(l.format, '', stats, audit?.data); return { ...l, ...(pr?.yours ? { yours: pr.yours } : {}), ...(pr?.field ? { field: pr.field } : {}) }; }),
      basis: { posts: account?.data.postCount ?? 0, audited: Boolean(audit) },
    };
    const at = svc.now.toISOString();
    this.#store.addReport(projectId, 'plan', plan, account?.simulated ?? false, at);
    this.#store.log(projectId, 'director', `Plan for ${plan.period}: ${plan.headline}`, true, at);
    return plan;
  }

  // --- the Director: sums up what the team did, and is the manager's first point of contact
  async synthesize(projectId: string, brief = ''): Promise<Synthesis> {
    const recent = this.#store.activity(projectId, 8).reverse();
    const waiting = this.#store.items(projectId).filter(i => i.status === 'idea');
    const s = await this.#llm(projectId).json(
      `You are the director of a small digital communication team. You sum up for the manager what your team just did, in plain words.
A short headline, then 2 to 4 points (what was found or decided, what needs the manager), then the one thing they should do next. No jargon, no filler.
${directives(this.#svc, projectId)}${behaviour(this.#svc, projectId, 'director')}
${brief ? `The manager had asked: ${brief}` : ''}

What the agents reported:
${recent.map(a => `- ${a.agent}${a.ok ? '' : ' (failed)'}: ${a.summary}`).join('\n')}
Proposals waiting for the manager:
${waiting.map(i => `- ${i.kind}: ${i.title} (${i.source})`).join('\n') || '(none)'}`,
      Synthesis, 'synthesis');
    const at = this.#svc.now.toISOString();
    this.#store.addReport(projectId, 'synthesis', s, false, at);
    this.#store.log(projectId, 'director', s.headline, true, at);
    this.#store.addChat(projectId, 'director', 'agent', `${s.headline}\n\n${s.points.map(p => `- ${p}`).join('\n')}\n\nNext: ${s.next}`, [], at);
    return s;
  }

  // The manager talks to the team. The question goes to the agent whose job it is (`agent` forces one), that
  // agent answers from its own material, and may hand the question to a colleague: then the colleague answers
  // in the same thread, right after a one-line pass-on. `base` is the thread: 'team' (the studio's conversation)
  // or an agent's own; `about` narrows it to a piece or a goal. `hint` is the page the manager is on.
  async ask(projectId: string, o: { message: string; context?: string; about?: string; hint?: string; agent?: AgentId; base?: 'team' | AgentId }) {
    const base = o.base ?? 'team';
    const thread = chatThread(base, o.about ?? '');
    const subject = this.#subject(projectId, o.about ?? '');
    const at = () => this.#svc.now.toISOString();
    const history = this.#store.chat(projectId, thread, 10);
    this.#store.addChat(projectId, thread, 'user', o.message, [], at());
    let who: AgentId = o.agent ?? routeAgent(o.message, subject, o.hint ?? '');
    for (let hop = 0; ; hop++) {
      const r = await this.#answer(projectId, who, o.message, o.context ?? '', o.about ?? '', subject, history, Boolean(o.agent));
      const next = r.reply.handOff !== 'none' && r.reply.handOff !== who ? r.reply.handOff : undefined;
      if (next && hop === 0 && base === 'team' && !o.agent) {
        // The pass-on stays visible, then the colleague answers the same question.
        this.#store.addChat(projectId, thread, 'agent', r.reply.reply.trim() || `This is the ${AGENTS.find(a => a.id === next)!.name}'s call.`, [{ kind: 'talk', label: `Passed to the ${AGENTS.find(a => a.id === next)!.name}`, agent: next, by: who }], at(), { agent: who, basis: [] });
        who = next;
        continue;
      }
      const actions = actionsFrom(r.reply, who, projectId, subject, this.#svc);
      // On an agent's own thread the hand-off is a door, not a hop: the manager chooses to walk through it.
      if (next && (o.agent || base !== 'team')) actions.push({ kind: 'talk', label: `Ask the ${AGENTS.find(a => a.id === next)!.name}`, agent: next, by: who });
      this.#store.addChat(projectId, thread, 'agent', r.reply.reply, actions, at(), { agent: who, basis: r.basis });
      break;
    }
    return this.#store.chat(projectId, thread);
  }

  // The old doors: a conversation with one agent on its own thread.
  chatDirector(projectId: string, message: string, context = '') { return this.ask(projectId, { message, context, agent: 'director', base: 'director' }); }
  chatAgent(projectId: string, agent: AgentId, message: string, context = '', about = '') { return this.ask(projectId, { message, context, about, agent, base: agent }); }

  #subject(projectId: string, about: string): Subject {
    const m = /^(item|milestone):([A-Za-z0-9_-]{1,60})$/.exec(about);
    if (!m) return null;
    if (m[1] === 'item') {
      const item = this.#store.item(m[2]);
      return item && item.projectId === projectId ? { kind: 'item', item } : null;
    }
    const ms = this.#store.milestone(m[2]);
    return ms && ms.projectId === projectId ? { kind: 'milestone', id: ms.id, title: ms.title, intent: ms.intent, targetDate: ms.targetDate } : null;
  }

  // One agent answers one question, from its material. The Scout looks the question up on the live web first.
  async #answer(projectId: string, agent: AgentId, message: string, context: string, about: string, subject: Subject, history: ChatMessage[], locked: boolean) {
    const info = AGENTS.find(a => a.id === agent)!;
    const cfg = this.#store.agentConfig(projectId, agent);
    const ground = groundFor(this.#svc, projectId, agent, subject);
    const images = picturesFor(this.#svc, projectId, about);
    let research = '';
    const llm = this.#llm(projectId);
    if (agent === 'scout' && llm.search) {
      try {
        const r = await llm.search(message.slice(0, 500));
        research = `FRESH WEB RESULTS for this exact question (quote site names when you use them):\n${r.text}\nSources: ${r.sources.slice(0, 6).join(', ')}`;
        ground.basis.push('a fresh web search');
      } catch { /* answer from the audit instead */ }
    }
    const others = (['director', 'scout', 'analyst', 'strategist', 'writer'] as AgentId[]).filter(a => a !== agent).map(a => ROLE_OF[a]).join('; ');
    const names = (m: { role: string; agent?: AgentId }) => m.role === 'user' ? 'Manager' : m.agent === agent || !m.agent ? 'You' : AGENTS.find(a => a.id === m.agent)!.name;
    const r = await this.#llm(projectId).json(
      `You are the ${info.name} of a small digital communication team working for the manager, a solo developer. ${ROLE_OF[agent].replace(/^the \w+ /, 'You ')}.
${CHAT_IDENTITY}
${images.length > 0 ? SIGHTED : BLIND}
Answer fully but without filler: a direct answer first, then short sections or a list only when the question deserves more than a line. Quote the material below (titles, numbers, dates) instead of generalities. Never say "look at the X page": say what is there.
${locked ? `The manager chose to talk to you: answer even if a colleague knows more, and set handOff to that colleague only to point the manager to them.` : `Your colleagues: ${others}. If the question is really one of theirs, set handOff to that colleague and make reply ONE short sentence saying you pass it on (no answer). Otherwise handOff is "none" and you answer.`}
You can offer actions, at most 3, only when the manager's message calls for them (a request, a decision, a change). Nothing happens until the manager clicks: so describe the result in the reply, and put the exact content in the action. Each action: a short label (a verb phrase in the manager's language), a one-line why with the fact behind it. Every field of an action must be present: use "", "none", "unchanged", 0, -1 or [] for the parts that do not apply.
What you can offer:
${CAN[agent]}
${directives(this.#svc, projectId)}
Your standing instructions from the manager: ${cfg.instructions || '(none)'}
Your settings: ${cfg.enabled ? 'on' : 'off'}, ${cfg.workers} worker(s).

YOUR MATERIAL
${ground.text || '(nothing loaded yet: say what you would need)'}
${research ? `\n${research}\n` : ''}
Conversation so far:
${history.map(m => `${names(m)}: ${m.text}`).join('\n') || '(none)'}
${context ? `What the manager is looking at right now (they know it, do not repeat it back, just use it to answer):\n${context}\n` : ''}Manager: ${message}`,
      Reply, agent === 'director' ? 'director_reply' : 'agent_reply', images.length > 0 ? { images } : undefined);
    // The model may leave an action half filled: complete it with the empty shape before checking it.
    const reply = { ...r, actions: r.actions.map(a => ({ ...EMPTY_ACTION, ...a })) };
    return { reply, basis: ground.basis };
  }

  setConfig(projectId: string, agent: AgentId, patch: Partial<AgentConfig>): AgentConfig {
    if (agent === 'director' && patch.enabled === false) throw new Error('the director leads the team: it can be told to behave differently, not switched off');
    const workers = patch.workers === undefined ? undefined : Math.min(MAX_WORKERS, Math.max(1, Math.round(patch.workers)));
    return this.#store.setAgentConfig(projectId, agent, { ...patch, ...(workers === undefined ? {} : { workers }) });
  }

  // The manager confirmed a suggestion.
  async apply(projectId: string, projectName: string, a: SuggestedAction): Promise<{ started?: boolean; itemId?: string }> {
    const svc = this.#svc;
    const mine = (id?: string) => {
      const item = id ? this.#store.item(id) : undefined;
      if (!item || item.projectId !== projectId) throw new Error('unknown piece in this project');
      return item;
    };
    if (a.kind === 'run') {
      const agents = (a.agents ?? []).filter(x => (WORKERS as readonly string[]).includes(x) || x === 'director');
      if (!agents.length) throw new Error('no agent to run');
      return { started: this.start(projectId, projectName, agents, a.brief ?? '') };
    }
    if (a.kind === 'generate' && a.itemId) {
      mine(a.itemId);
      if (a.index === undefined) await svc.generateMissing(a.itemId);
      else await svc.generateSlide(a.itemId, a.index);
      return {};
    }
    if (a.kind === 'configure' && a.agent) {
      this.setConfig(projectId, a.agent, { ...(a.enabled === undefined ? {} : { enabled: a.enabled }), ...(a.workers === undefined ? {} : { workers: a.workers }), ...(a.instructions === undefined ? {} : { instructions: a.instructions }) });
      return {};
    }
    if (a.kind === 'revise' && a.itemId && a.instruction?.trim()) {
      const item = mine(a.itemId);
      if (!item.draft) throw new Error('nothing written yet to revise');
      await svc.revise(a.itemId, a.instruction.trim());
      return { itemId: a.itemId };
    }
    if (a.kind === 'rebrief' && a.itemId && a.brief?.trim()) {
      mine(a.itemId);
      svc.editItem(a.itemId, { brief: a.brief.trim() });
      svc.step(a.itemId, 'edited', a.by ?? 'you', `${a.by ? 'Changed the brief in the chat' : 'Changed what it should say'}: ${a.brief.trim().slice(0, 120)}`);
      return { itemId: a.itemId };
    }
    if (a.kind === 'date' && a.itemId && a.date) {
      mine(a.itemId);
      svc.editItem(a.itemId, { fixedDate: a.date });
      svc.step(a.itemId, 'edited', a.by ?? 'you', `Moved to ${a.date}${a.by ? ' from the chat' : ''}`);
      return { itemId: a.itemId };
    }
    if (a.kind === 'propose' && a.title?.trim() && a.brief?.trim()) {
      const by = a.by && a.by !== 'director' ? a.by : 'strategist';
      const source = by === 'scout' ? 'trend' : by === 'analyst' ? 'account' : 'roadmap';
      const item = this.#store.addItem({
        projectId, kind: a.pieceKind ?? 'social-post', title: a.title.trim(), brief: a.brief.trim(), origin: 'ai', status: 'idea', source,
        rationale: a.why ?? '', fixedDate: a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : addDays(day(svc.now), 7),
        ...(a.hook || a.channel ? { pitch: { hook: a.hook ?? '', channel: a.channel ?? '', measure: '' } } : {}),
        createdAt: svc.now.toISOString(),
      });
      svc.step(item.id, 'proposed', by, `Proposed in the chat${a.why ? `: ${a.why.slice(0, 140)}` : ''}`);
      return { itemId: item.id };
    }
    throw new Error('nothing to apply');
  }

  overview(projectId: string) {
    return {
      agents: AGENTS,
      working: this.working(projectId),
      config: Object.fromEntries(AGENTS.map(a => [a.id, this.#store.agentConfig(projectId, a.id)])),
      audit: this.#store.latestReport<Audit>(projectId, 'audit'),
      audits: this.#store.reports<Audit>(projectId, 'audit'),
      account: this.#store.latestReport<AccountReport>(projectId, 'account'),
      synthesis: this.#store.latestReport<Synthesis>(projectId, 'synthesis'),
      plan: this.#store.latestReport<Plan>(projectId, 'plan'),
      watch: this.#store.latestReport<Watch>(projectId, 'watch'),
      snapshots: this.#store.snapshots(projectId),
      connected: this.connected(),
      duty: { autopilot: this.#svc.profile(projectId).autopilot, lastPass: this.#store.activity(projectId, 50).filter(a => a.agent === 'scout' || a.agent === 'analyst').map(a => a.at).sort().at(-1) },
      accountPosts: this.#store.account(projectId).length,
      facts: accountFacts(this.#store.account(projectId), day(this.#svc.now)),
      posts: this.#store.account(projectId).map(p => ({ text: p.text, format: p.format, engagement: engagement(p), postedAt: p.postedAt })),
      activity: this.#store.activity(projectId),
    };
  }
}
