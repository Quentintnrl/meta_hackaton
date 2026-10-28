import { z } from 'zod';
import type { ContentService } from './service.ts';
import { ItemKind, MAX_WORKERS, WORKERS, addDays, day, engagement, type AccountPost, type AgentConfig, type AgentId, type Item, type Milestone, type SuggestedAction } from './types.ts';

export const AGENTS: Array<{ id: AgentId; name: string; role: string }> = [
  { id: 'director', name: 'Director', role: 'Leads the team and sums up its work' },
  { id: 'scout', name: 'Scout', role: 'Watches what works in your field' },
  { id: 'analyst', name: 'Analyst', role: 'Compares it with your account' },
  { id: 'strategist', name: 'Strategist', role: 'Reads your roadmap, proposes content' },
  { id: 'writer', name: 'Writer', role: 'Drafts what you accept' },
];

export const Audit = z.object({
  summary: z.string(),
  whatWorks: z.array(z.object({ format: z.string(), why: z.string(), example: z.string(), strength: z.number().int().min(1).max(5) })).max(5), // strength: how strongly it works, 5 = the best
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

// What the manager told one agent to do differently. Added to that agent's prompts.
const behaviour = (svc: ContentService, projectId: string, agent: AgentId) => {
  const i = svc.store.agentConfig(projectId, agent).instructions.trim();
  return i ? `\nSpecific instructions from the manager for you (${agent}), follow them: ${i}` : '';
};

const Synthesis = z.object({ headline: z.string(), points: z.array(z.string()).min(1).max(4), next: z.string() });
export type Synthesis = z.infer<typeof Synthesis>;

const AgentName = z.enum(['scout', 'analyst', 'strategist', 'writer']);
const DirectorReply = z.object({
  reply: z.string(),
  talkTo: z.enum(['none', 'scout', 'analyst', 'strategist', 'writer']), // when the manager should speak to an agent directly
  actions: z.array(z.object({
    label: z.string(),
    kind: z.enum(['run', 'configure']),
    agents: z.array(AgentName), // run: who works, in order
    brief: z.string(), // run: what they are asked
    agent: z.enum(['none', 'scout', 'analyst', 'strategist', 'writer']), // configure: whom
    enabled: z.enum(['on', 'off', 'unchanged']),
    workers: z.number().int().min(0).max(MAX_WORKERS), // 0 = unchanged
  })).max(3),
});
const AgentReply = z.object({ reply: z.string(), newInstructions: z.string() }); // '' when nothing should change

const ANGLES = [
  'which formats and post types get the most engagement, with one concrete example each',
  'recurring hooks, topics and questions people respond to',
  'what falls flat or backfires, and what the leading accounts in this field do differently',
];
const LENSES = ['the dev roadmap: what is about to land and when', 'the project account: its strengths and gaps against the field', 'the trends found in the field research'];

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
    const workers = Math.min(MAX_WORKERS, Math.max(1, this.#store.agentConfig(projectId, 'scout').workers));
    const ask = (focus: string) => llm.search!(
      `Research what content currently performs well on social media and developer/product blogs for a project in this field: "${field}"${profile.audience ? `, for ${profile.audience}` : ''}.
${focus}. Be specific and recent.${brief ? `\nThe manager asks: ${brief}` : ''}${behaviour(this.#svc, projectId, 'scout')}`);
    // One researcher covers everything; more researchers each take an angle, in parallel, and their findings are merged.
    const found = workers === 1
      ? [await ask('Find: the formats that get the most engagement (with a concrete example each), recurring hooks, topics people ask about, and what falls flat')]
      : await Promise.all(ANGLES.slice(0, workers).map(ask));
    const text = found.map(f => f.text).join('\n\n');
    const sources = [...new Set(found.flatMap(f => f.sources))];
    const a = await llm.json(`Condense this research into an audit. Keep only what is supported by the text. Short phrases. For each format, strength says how strongly it works (5 = the best of the lot).\n\n${text}`, Audit, 'audit');
    const audit: Audit = { ...a, sources: sources.slice(0, 6) };
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
${directives(this.#svc, projectId)}${behaviour(this.#svc, projectId, 'analyst')}`,
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

    const ask = (lens: string, count: string) => svc.llm.json(
      `You are the strategist of a small digital communication team working for a solo developer (the manager).
Today is ${today}. Propose ${count} pieces of content for the coming weeks.${lens ? ` Look at the situation mainly through ${lens}.` : ''} Every piece must be justified by evidence you can see below: a trend from the audit, a gap or strength in the account, or something in the dev roadmap (a feature about to land, a milestone date). Say which in "rationale", concretely.
Prefer the roadmap for timing: tie a piece to a milestone with offsetDays (negative = before it lands), or leave milestoneId empty and give a date.
Do not repeat existing pieces. Do not propose again what the manager refused, and apply the reasons they gave.

${directives(svc, projectId)}${behaviour(svc, projectId, 'strategist')}
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
    // One strategist sees everything; more of them each take a lens, in parallel, and the proposals are merged.
    const workers = Math.min(MAX_WORKERS, Math.max(1, this.#store.agentConfig(projectId, 'strategist').workers));
    const batches = workers === 1 ? [await ask('', '3 to 6')] : await Promise.all(LENSES.slice(0, workers).map(l => ask(l, '2 to 3')));
    const proposals = batches.flatMap(b => b.proposals);

    const ids = new Set(milestones.map(m => m.id));
    const taken = new Set(all.map(i => i.title.toLowerCase())); // a refused title does not come back either
    const made: Item[] = [];
    for (const p of proposals) {
      if (taken.has(p.title.toLowerCase())) continue;
      taken.add(p.title.toLowerCase());
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
    void this.#run(projectId, projectName, agents, brief);
    return true;
  }

  async #run(projectId: string, projectName: string, agents: AgentId[], brief: string) {
    const store = this.#store;
    const nowIso = () => this.#svc.now.toISOString();
    let ran = 0, failed = 0;
    const step = async (agent: AgentId, fn: () => Promise<string>) => {
      if (!agents.includes(agent)) return;
      if (!store.agentConfig(projectId, agent).enabled) { store.log(projectId, agent, 'Skipped: switched off by you.', true, nowIso()); return; }
      this.#working.set(projectId, { agent, since: nowIso() });
      ran++;
      try { store.log(projectId, agent, await fn(), true, nowIso()); }
      catch (e) { failed++; store.log(projectId, agent, (e as Error).message, false, nowIso()); }
    };
    try {
      await step('scout', async () => { const a = await this.scout(projectId, projectName, brief); return `Found ${a.whatWorks.length} formats that work and ${a.topics.length} topics. ${a.summary}`; });
      await step('analyst', async () => { const a = await this.analyse(projectId); return `Compared ${a.postCount} posts with the field. ${a.summary}`; });
      await step('strategist', async () => { const n = await this.strategize(projectId, brief); return `Proposed ${n.length} piece(s) of content.${n.length ? ' Waiting for your decision.' : ' Nothing new beyond what is planned.'}`; });
      await step('writer', async () => { const n = await this.write(projectId); return n.length ? `Drafted ${n.length} accepted piece(s).` : 'Nothing accepted is waiting for a draft.'; });
      // The director sums the run up, once, for the manager. It is skipped when it is off or nothing worked.
      if (ran > failed && store.agentConfig(projectId, 'director').enabled) {
        this.#working.set(projectId, { agent: 'director', since: nowIso() });
        try { await this.synthesize(projectId, brief); } catch (e) { store.log(projectId, 'director', `Could not sum up: ${(e as Error).message}`, false, nowIso()); }
      }
    } finally {
      this.#working.delete(projectId);
    }
  }

  // --- the Director: sums up what the team did, and is the manager's first point of contact
  async synthesize(projectId: string, brief = ''): Promise<Synthesis> {
    const recent = this.#store.activity(projectId, 8).reverse();
    const waiting = this.#store.items(projectId).filter(i => i.status === 'idea');
    const s = await this.#svc.llm.json(
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

  #teamState(projectId: string) {
    const svc = this.#svc;
    const lines = WORKERS.map(a => {
      const c = this.#store.agentConfig(projectId, a);
      const last = this.#store.activity(projectId, 40).find(x => x.agent === a);
      return `- ${a}: ${c.enabled ? `on, ${c.workers} worker(s)` : 'OFF'}${c.instructions ? `; instructions: "${c.instructions}"` : ''}; last: ${last ? `${last.ok ? '' : 'FAILED, '}${last.summary}` : 'has not worked yet'}`;
    });
    const items = this.#store.items(projectId);
    const ms = svc.milestones(projectId).filter(m => m.status === 'open');
    return `${lines.join('\n')}
Proposals waiting: ${items.filter(i => i.status === 'idea').length}. Drafts to review: ${items.filter(i => i.status === 'drafted').length}. Field research: ${this.#store.latestReport(projectId, 'audit') ? 'done' : 'not done'}. Posts loaded: ${this.#store.account(projectId).length}.
Milestones: ${ms.map(m => `${m.title} (${m.delivered}/${m.scope}${m.atRisk ? `, ${m.slipDays} days late` : ''})`).join('; ') || 'none'}.`;
  }

  // The manager talks to the director first. It answers, and may suggest actions; nothing runs until the manager confirms.
  async chatDirector(projectId: string, message: string) {
    const at = () => this.#svc.now.toISOString();
    const history = this.#store.chat(projectId, 'director', 8);
    this.#store.addChat(projectId, 'director', 'user', message, [], at());
    const r = await this.#svc.llm.json(
      `You are the director of a small digital communication team (scout, analyst, strategist, writer) working for a solo developer, the manager. You speak with the manager first.
Answer in 1 to 3 short sentences. You can suggest actions (the manager confirms each one):
- run: have some agents work, in this order, with a brief.
- configure: switch an agent on or off, or change how many of it work at once (1 to ${MAX_WORKERS}: more workers = wider research or more proposals, at more cost).
If the manager wants to talk to one agent, or change how an agent behaves, set talkTo to that agent and say so: they will speak to it directly.
Only suggest what the manager's message calls for.
${directives(this.#svc, projectId)}${behaviour(this.#svc, projectId, 'director')}

THE TEAM NOW
${this.#teamState(projectId)}

Conversation so far:
${history.map(m => `${m.role === 'user' ? 'Manager' : 'You'}: ${m.text}`).join('\n') || '(none)'}
Manager: ${message}`,
      DirectorReply, 'director_reply');
    const actions: SuggestedAction[] = r.actions.map(a => a.kind === 'run'
      ? { kind: 'run' as const, label: a.label, agents: a.agents, brief: a.brief }
      : { kind: 'configure' as const, label: a.label, agent: a.agent === 'none' ? undefined : a.agent, enabled: a.enabled === 'unchanged' ? undefined : a.enabled === 'on', workers: a.workers || undefined })
      .filter(a => a.kind === 'run' ? (a.agents?.length ?? 0) > 0 : Boolean(a.agent));
    if (r.talkTo !== 'none') actions.push({ kind: 'talk', label: `Talk to the ${r.talkTo[0].toUpperCase()}${r.talkTo.slice(1)}`, agent: r.talkTo });
    this.#store.addChat(projectId, 'director', 'agent', r.reply, actions, at());
    return this.#store.chat(projectId, 'director');
  }

  // The manager talks to one agent to understand its work or change how it behaves. A behaviour change is proposed, not applied.
  async chatAgent(projectId: string, agent: AgentId, message: string) {
    if (agent === 'director') return this.chatDirector(projectId, message);
    const at = () => this.#svc.now.toISOString();
    const info = AGENTS.find(a => a.id === agent)!;
    const history = this.#store.chat(projectId, agent, 8);
    this.#store.addChat(projectId, agent, 'user', message, [], at());
    const cfg = this.#store.agentConfig(projectId, agent);
    const last = this.#store.activity(projectId, 40).filter(a => a.agent === agent).slice(0, 3);
    const r = await this.#svc.llm.json(
      `You are the ${info.name} of a small digital communication team: "${info.role}". You are talking to the manager, who may ask about your work, or want to change how you work.
Answer in 1 to 3 short sentences, as yourself. If the manager asks you to behave differently, put the COMPLETE new standing instructions for you in newInstructions (merge the old ones and the new request, short and concrete) and say in the reply what will change. Otherwise newInstructions is an empty string.
${directives(this.#svc, projectId)}

Your current instructions from the manager: ${cfg.instructions || '(none)'}
Your settings: ${cfg.enabled ? 'on' : 'off'}, ${cfg.workers} worker(s).
Your latest work:
${last.map(a => `- ${a.summary}`).join('\n') || '(none yet)'}

Conversation so far:
${history.map(m => `${m.role === 'user' ? 'Manager' : 'You'}: ${m.text}`).join('\n') || '(none)'}
Manager: ${message}`,
      AgentReply, 'agent_reply');
    const actions: SuggestedAction[] = r.newInstructions.trim() && r.newInstructions.trim() !== cfg.instructions.trim()
      ? [{ kind: 'configure', label: 'Apply this new behaviour', agent, instructions: r.newInstructions.trim() }] : [];
    this.#store.addChat(projectId, agent, 'agent', r.reply, actions, at());
    return this.#store.chat(projectId, agent);
  }

  setConfig(projectId: string, agent: AgentId, patch: Partial<AgentConfig>): AgentConfig {
    if (agent === 'director' && patch.enabled === false) throw new Error('the director leads the team: it can be told to behave differently, not switched off');
    const workers = patch.workers === undefined ? undefined : Math.min(MAX_WORKERS, Math.max(1, Math.round(patch.workers)));
    return this.#store.setAgentConfig(projectId, agent, { ...patch, ...(workers === undefined ? {} : { workers }) });
  }

  // The manager confirmed a suggestion.
  apply(projectId: string, projectName: string, a: SuggestedAction): { started?: boolean } {
    if (a.kind === 'run') {
      const agents = (a.agents ?? []).filter(x => (WORKERS as readonly string[]).includes(x));
      if (!agents.length) throw new Error('no agent to run');
      return { started: this.start(projectId, projectName, agents, a.brief ?? '') };
    }
    if (a.kind === 'configure' && a.agent) {
      this.setConfig(projectId, a.agent, { ...(a.enabled === undefined ? {} : { enabled: a.enabled }), ...(a.workers === undefined ? {} : { workers: a.workers }), ...(a.instructions === undefined ? {} : { instructions: a.instructions }) });
      return {};
    }
    throw new Error('nothing to apply');
  }

  overview(projectId: string) {
    return {
      agents: AGENTS,
      working: this.working(projectId),
      config: Object.fromEntries(AGENTS.map(a => [a.id, this.#store.agentConfig(projectId, a.id)])),
      audit: this.#store.latestReport<Audit>(projectId, 'audit'),
      account: this.#store.latestReport<AccountReport>(projectId, 'account'),
      synthesis: this.#store.latestReport<Synthesis>(projectId, 'synthesis'),
      accountPosts: this.#store.account(projectId).length,
      posts: this.#store.account(projectId).map(p => ({ text: p.text, format: p.format, engagement: engagement(p), postedAt: p.postedAt })),
      activity: this.#store.activity(projectId),
    };
  }
}
