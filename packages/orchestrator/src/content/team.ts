import { z } from 'zod';
import type { ContentService } from './service.ts';
import { ItemKind, addDays, day, engagement, type AccountPost, type AgentId, type Item, type Milestone } from './types.ts';

export const AGENTS: Array<{ id: AgentId; name: string; role: string }> = [
  { id: 'scout', name: 'Scout', role: 'Watches what works in your field' },
  { id: 'analyst', name: 'Analyst', role: 'Compares it with your account' },
  { id: 'strategist', name: 'Strategist', role: 'Reads your roadmap, proposes content' },
  { id: 'writer', name: 'Writer', role: 'Drafts what you accept' },
];

export const Audit = z.object({
  summary: z.string(),
  whatWorks: z.array(z.object({ format: z.string(), why: z.string(), example: z.string() })).max(5),
  hooks: z.array(z.string()).max(5),
  topics: z.array(z.string()).max(6),
  avoid: z.array(z.string()).max(4),
});
export type Audit = z.infer<typeof Audit> & { sources: string[] };

export const AccountAnalysis = z.object({
  summary: z.string(),
  strengths: z.array(z.string()).max(4),
  gaps: z.array(z.string()).max(4), // what the field does that this account does not
  opportunities: z.array(z.string()).max(4),
});
export interface FormatStat { format: string; posts: number; avgEngagement: number }
export type AccountReport = z.infer<typeof AccountAnalysis> & { stats: FormatStat[]; postCount: number };

const Proposals = z.object({
  proposals: z.array(z.object({
    kind: ItemKind,
    title: z.string(),
    brief: z.string(),
    rationale: z.string(), // the evidence, in one or two sentences: which trend, which gap in the account, which part of the roadmap
    source: z.enum(['trend', 'account', 'roadmap']),
    milestoneId: z.string(), // '' when it hangs on no milestone
    offsetDays: z.number().int().min(-60).max(30), // relative to the milestone landing
    date: z.string(), // YYYY-MM-DD, used when there is no milestone
  })).min(1).max(6),
});

const AccountParse = z.object({
  posts: z.array(z.object({
    text: z.string(), format: z.string(), likes: z.number().int().min(0), comments: z.number().int().min(0), shares: z.number().int().min(0), saves: z.number().int().min(0), postedAt: z.string(),
  })).max(60),
});

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
  ];
  return rows.map(([format, text, likes, comments, shares, saves], i) => ({ text, format, likes, comments, shares, saves, postedAt: addDays(day(now), -4 - i * 5), simulated: true }));
}

const directives = (svc: ContentService, projectId: string) => {
  const p = svc.profile(projectId);
  return [p.directives && `Standing orders from the manager (follow them): ${p.directives}`, p.voice && `Voice: ${p.voice}`, p.audience && `Audience: ${p.audience}`, `Language: ${p.language}`].filter(Boolean).join('\n');
};

// The small communication team. Each agent reads what it needs, writes a report or proposals, and logs what it did.
export class Team {
  #svc: ContentService;
  #working = new Map<string, { agent: AgentId; since: string }>();

  constructor(svc: ContentService) { this.#svc = svc; }

  working(projectId: string) { return this.#working.get(projectId); }

  get #store() { return this.#svc.store; }

  // --- the Scout: what works in the field, from the web
  async scout(projectId: string, projectName: string, brief = ''): Promise<Audit> {
    const llm = this.#svc.llm;
    if (!llm.search) throw new Error('this model backend cannot search the web');
    const profile = this.#svc.profile(projectId);
    const field = profile.niche || profile.audience || projectName;
    const found = await llm.search(
      `Research what content currently performs well on social media and developer/product blogs for a project in this field: "${field}"${profile.audience ? `, for ${profile.audience}` : ''}.
Find: the formats that get the most engagement (with a concrete example each), recurring hooks, topics people ask about, and what falls flat. Be specific and recent.${brief ? `\nThe manager asks: ${brief}` : ''}`);
    const a = await llm.json(`Condense this research into an audit. Keep only what is supported by the text. Short phrases.\n\n${found.text}`, Audit, 'audit');
    const audit: Audit = { ...a, sources: found.sources.slice(0, 6) };
    this.#store.addReport(projectId, 'audit', audit, false, this.#svc.now.toISOString());
    return audit;
  }

  // --- the Analyst: your account against the field
  async analyse(projectId: string): Promise<AccountReport> {
    const posts = this.#store.account(projectId);
    if (!posts.length) throw new Error('give the team your account first: paste your recent posts with their numbers, or load the demo account');
    const stats = formatStats(posts);
    const audit = this.#store.latestReport<Audit>(projectId, 'audit')?.data;
    const a = await this.#svc.llm.json(
      `You compare a project's social account with what works in its field. Be concrete and honest; if the data is thin, say so.
Engagement = likes + 2*comments + 3*shares + 3*saves.

Average engagement per format on this account:
${stats.map(s => `- ${s.format}: ${s.avgEngagement} over ${s.posts} post(s)`).join('\n')}
Recent posts:
${posts.slice(0, 15).map(p => `- [${p.format}] ${p.text} (${engagement(p)})`).join('\n')}

What works in the field: ${audit ? JSON.stringify({ whatWorks: audit.whatWorks, hooks: audit.hooks, topics: audit.topics }) : '(the scout has not reported yet)'}
${directives(this.#svc, projectId)}`,
      AccountAnalysis, 'account_analysis');
    const report: AccountReport = { ...a, stats, postCount: posts.length };
    this.#store.addReport(projectId, 'account', report, posts.every(p => p.simulated), this.#svc.now.toISOString());
    return report;
  }

  // The manager gives the numbers as they come: free text from the platform, or a copy of an export. The model structures it.
  async importAccount(projectId: string, pasted: string): Promise<AccountPost[]> {
    const r = await this.#svc.llm.json(
      `Extract the posts from this text, exactly as given. Do not invent posts or numbers: use 0 for a figure that is missing.
format is a short label for the kind of post (tutorial, behind-the-scenes, release, announcement, meme, tip, story…). postedAt is YYYY-MM-DD, or "${day(this.#svc.now)}" when unknown.

${pasted.slice(0, 12000)}`, AccountParse, 'account_import');
    const posts = r.posts.map(p => ({ ...p, postedAt: /^\d{4}-\d{2}-\d{2}$/.test(p.postedAt) ? p.postedAt : day(this.#svc.now), simulated: false }));
    if (!posts.length) throw new Error('no post found in that text');
    this.#store.setAccount(projectId, posts);
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

    const r = await svc.llm.json(
      `You are the strategist of a small digital communication team working for a solo developer (the manager).
Today is ${today}. Propose 3 to 6 pieces of content for the coming weeks. Every piece must be justified by evidence you can see below: a trend from the audit, a gap or strength in the account, or something in the dev roadmap (a feature about to land, a milestone date). Say which in "rationale", concretely.
Prefer the roadmap for timing: tie a piece to a milestone with offsetDays (negative = before it lands), or leave milestoneId empty and give a date.
Do not repeat existing pieces. Do not propose again what the manager refused, and apply the reasons they gave.

${directives(svc, projectId)}
${brief ? `The manager asks for this now: ${brief}` : ''}

WHAT WORKS IN THE FIELD:
${audit ? JSON.stringify({ whatWorks: audit.data.whatWorks, hooks: audit.data.hooks, topics: audit.data.topics, avoid: audit.data.avoid }) : '(no audit yet)'}

THIS PROJECT'S ACCOUNT${account?.simulated ? ' (fictional demo data)' : ''}:
${account ? JSON.stringify({ summary: account.data.summary, strengths: account.data.strengths, gaps: account.data.gaps, bestFormats: account.data.stats.slice(0, 3) }) : '(no account analysis yet)'}

DEV ROADMAP:
Milestones:
${milestones.map((m: Milestone & { forecast?: { predictedDate: string } }) => `- id=${m.id} "${m.title}": ${m.intent || 'no description'}; wanted ${m.targetDate}${m.forecast ? `, projected ${m.forecast.predictedDate}` : ''}`).join('\n') || '(none)'}
Features:
${features.map(f => `- ${f.title} [${f.state.toLowerCase().replace(/_/g, ' ')}]${f.summary ? `: ${f.summary}` : ''}`).join('\n') || '(none)'}
Recent commits:
${commits.slice(0, 15).map(c => `- ${c}`).join('\n') || '(none)'}

ALREADY PLANNED:
${live.map(i => `- ${i.kind}: ${i.title}`).join('\n') || '(nothing)'}
REFUSED BY THE MANAGER:
${rejected.map(i => `- ${i.title}: "${i.rejectedReason || 'no reason given'}"`).join('\n') || '(nothing)'}`,
      Proposals, 'proposals');

    const ids = new Set(milestones.map(m => m.id));
    const taken = new Set(all.map(i => i.title.toLowerCase())); // a refused title does not come back either
    const made: Item[] = [];
    for (const p of r.proposals) {
      if (taken.has(p.title.toLowerCase())) continue;
      const onMilestone = p.milestoneId && ids.has(p.milestoneId);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.date >= today ? p.date : addDays(today, 3);
      made.push(this.#store.addItem({
        projectId, kind: p.kind, title: p.title, brief: p.brief, rationale: p.rationale, source: p.source, origin: 'ai', status: 'idea', createdAt: svc.now.toISOString(),
        ...(onMilestone ? { milestoneId: p.milestoneId, offsetDays: p.offsetDays } : { fixedDate: date }),
      }));
    }
    return made;
  }

  // --- the Writer: drafts what the manager accepted and nobody wrote yet
  async write(projectId: string, max = 4): Promise<Item[]> {
    const todo = this.#store.items(projectId).filter(i => i.status === 'briefed' && !i.draft).slice(0, max);
    const out: Item[] = [];
    for (const i of todo) out.push(await this.#svc.draft(i.id));
    return out;
  }

  // --- one run of the whole team, or of one agent. Runs in the background: the console watches `working` and the activity log.
  start(projectId: string, projectName: string, agents: AgentId[], brief = ''): boolean {
    if (this.#working.has(projectId)) return false;
    void this.#run(projectId, projectName, agents, brief);
    return true;
  }

  async #run(projectId: string, projectName: string, agents: AgentId[], brief: string) {
    const step = async (agent: AgentId, fn: () => Promise<string>) => {
      this.#working.set(projectId, { agent, since: this.#svc.now.toISOString() });
      try { this.#store.log(projectId, agent, await fn(), true, this.#svc.now.toISOString()); }
      catch (e) { this.#store.log(projectId, agent, (e as Error).message, false, this.#svc.now.toISOString()); }
    };
    try {
      if (agents.includes('scout')) await step('scout', async () => { const a = await this.scout(projectId, projectName, brief); return `Found ${a.whatWorks.length} formats that work and ${a.topics.length} topics. ${a.summary}`; });
      if (agents.includes('analyst')) await step('analyst', async () => { const a = await this.analyse(projectId); return `Compared ${a.postCount} posts with the field. ${a.summary}`; });
      if (agents.includes('strategist')) await step('strategist', async () => { const n = await this.strategize(projectId, brief); return `Proposed ${n.length} piece(s) of content.${n.length ? ' Waiting for your decision.' : ' Nothing new beyond what is planned.'}`; });
      if (agents.includes('writer')) await step('writer', async () => { const n = await this.write(projectId); return n.length ? `Drafted ${n.length} accepted piece(s).` : 'Nothing accepted is waiting for a draft.'; });
    } finally {
      this.#working.delete(projectId);
    }
  }

  overview(projectId: string) {
    return {
      agents: AGENTS,
      working: this.working(projectId),
      audit: this.#store.latestReport<Audit>(projectId, 'audit'),
      account: this.#store.latestReport<AccountReport>(projectId, 'account'),
      accountPosts: this.#store.account(projectId).length,
      activity: this.#store.activity(projectId),
    };
  }
}
