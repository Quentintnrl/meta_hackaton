import { z } from 'zod';
import type { ContentService } from './service.ts';
import type { AccountReport, Audit, Synthesis } from './team.ts';
import { accountFacts, factsText } from './facts.ts';
import { ItemKind, MAX_WORKERS, addDays, day, engagement, type AgentId, type Item, type Plan, type SuggestedAction, type Watch } from './types.ts';

// How the manager talks to the team. One question goes to the agent whose job it is (routed here, no model
// call), that agent answers from its real material (the account's numbers, the field research, the plan,
// the piece and its chain), and may offer concrete things to do: revise the draft, change the brief, add a
// piece to the board, fix a date, run a colleague. Nothing happens until the manager clicks.

export type Subject = { kind: 'item'; item: Item } | { kind: 'milestone'; title: string; intent: string; targetDate: string; id: string } | null;

const AGENT_IDS: AgentId[] = ['director', 'scout', 'analyst', 'strategist', 'writer'];
export const isAgent = (s: string): s is AgentId => (AGENT_IDS as string[]).includes(s);

// --- routing: who answers. Words first (both languages), then what is being looked at, then the page.
// Stems, not words: "competit" catches competitor and compétition. Short words carry their own boundary.
const RULES: Array<[AgentId, RegExp]> = [
  ['director', /\b(the team\b|l'équipe|l'equipe|everyone\b|tout le monde|this week\b|cette semaine|what should we\b|que fait-on|qu'est-ce qu'on fait|on fait quoi|priorit|plan for\b|run everything|lance tout|who should\b|qui doit\b|whole team|toute l'équipe)/i],
  ['writer', /\b(caption|hashtag|rewrite|réécri|reecri|rédige|redige|écris\b|ecris\b|write it\b|wording|first line\b|première ligne|premiere ligne|shorter\b|plus court|longer\b|plus long|tone\b|ton\b|funnier|drôle|drole|picture|image|photo|slide|visual|visuel|storyboard|draft|brouillon|the text\b|le texte|text of\b|voix off|voice ?over)/i],
  ['scout', /\b(competit|concurr|market\b|marché|marche\b|the field\b|le terrain|trend|tendance|search|cherch|recherch|the web\b|le web|salon|event\b|events\b|événement|evenement|out there\b|ailleurs|benchmark|other accounts|autres comptes|inspir)/i],
  ['analyst', /\b(likes?\b|réactions?\b|reactions?\b|abonné|abonne|followers?\b|my account|mon compte|our account|notre compte|my posts|mes posts|nos posts|stats?\b|chiffres?\b|numbers?\b|engagement|silence|reach\b|portée|portee|comments?\b|commentaires?\b|views?\b|vues\b|weekday|jour de la semaine|dropp?ed\b|baisse|went down|monte\b|hausse)/i],
  ['strategist', /\b(why this\b|pourquoi (ce|cette|celle|celui)\b|angle|ideas?\b|idées?\b|idees?\b|propos|strateg|stratég|calendar|calendrier|when should\b|quand (poster|publier)|dates?\b|schedule|planifi|roadmap|milestone|jalon|which (one|post) first|lequel en premier|next post\b|prochain post|what to post\b|quoi poster)/i],
];
const PAGE_DEFAULT: Record<string, AgentId> = { community: 'analyst', platforms: 'analyst', watch: 'scout', agenda: 'strategist', studio: 'strategist', next: 'strategist', create: 'strategist', idea: 'strategist', insights: 'director', team: 'director', settings: 'director', today: 'director', calendar: 'strategist' };

export function routeAgent(message: string, subject: Subject, hint = ''): AgentId {
  for (const [agent, re] of RULES) if (re.test(message)) return agent;
  if (hint.startsWith('agent:') && isAgent(hint.slice(6))) return hint.slice(6) as AgentId;
  if (subject?.kind === 'item') return subject.item.status === 'idea' || subject.item.status === 'rejected' ? 'strategist' : 'writer';
  if (subject?.kind === 'milestone') return 'strategist';
  return PAGE_DEFAULT[hint] ?? 'director';
}

// --- grounding: what each agent reads before it answers, and the labels the console shows for it.
const cut = (s: string, n = 140) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const when = (iso: string) => iso.slice(0, 10);
const list = (xs: string[], none = '(none)') => xs.length ? xs.map(x => `- ${x}`).join('\n') : none;

export function groundFor(svc: ContentService, projectId: string, agent: AgentId, subject: Subject): { text: string; basis: string[] } {
  const store = svc.store;
  const parts: string[] = [];
  const basis: string[] = [];
  const items = store.items(projectId);
  const posts = store.account(projectId);
  const facts = accountFacts(posts, day(svc.now));
  const audit = store.latestReport<Audit>(projectId, 'audit');
  const account = store.latestReport<AccountReport>(projectId, 'account');
  const watch = store.latestReport<Watch>(projectId, 'watch');
  const plan = store.latestReport<Plan>(projectId, 'plan');
  const synthesis = store.latestReport<Synthesis>(projectId, 'synthesis');
  const ms = svc.milestones(projectId).filter(m => m.status === 'open');
  const profile = svc.profile(projectId);
  const waiting = items.filter(i => i.status === 'idea');
  const refused = items.filter(i => i.status === 'rejected').slice(-6);
  const demo = (r: { simulated: boolean } | undefined) => (r?.simulated ? ' (demo data)' : '');

  // The studio as it stands: every agent knows what is on the board.
  const counts = (['idea', 'briefed', 'drafted', 'approved', 'published'] as const).map(s => `${items.filter(i => i.status === s).length} ${s}`).join(', ');
  parts.push(`THE BOARD\n${counts}.${waiting.length ? `\nProposals waiting for the manager:\n${list(waiting.map(i => `"${i.title}" (${i.kind}, from ${i.source || 'the manager'}${i.pitch?.channel ? `, ${i.pitch.channel}` : ''}${i.pitch?.hook ? `, opens "${cut(i.pitch.hook, 80)}"` : ''})`))}` : ''}`);
  if (items.length) basis.push(`${items.length} piece${items.length === 1 ? '' : 's'} on the board`);
  if (ms.length) {
    parts.push(`THE ROADMAP\n${list(ms.map(m => `${m.title}: wanted ${m.targetDate}${m.forecast ? `, projected ${m.forecast.predictedDate}` : ''}, ${m.delivered}/${m.scope} delivered${m.atRisk ? `, ${m.slipDays} days late` : ''}${m.intent ? `. ${cut(m.intent, 120)}` : ''}`))}`);
    basis.push('the roadmap');
  }
  if (profile.voice || profile.audience || profile.niche || profile.directives) basis.push('your voice and orders');

  // The subject: the piece or the goal in full, with the chain of who did what.
  if (subject?.kind === 'item') {
    const i = subject.item;
    const chain = svc.chain(i).slice(-8);
    const media = i.media ? `\nMedia: ${i.media.format}, ${i.media.slides.length} shot(s): ${i.media.slides.map((s, n) => `${n + 1}. ${cut(s.visual, 90)}${s.text ? ` [on it: "${cut(s.text, 60)}"]` : ''} (${s.file ? 'picture made' : 'no picture yet'})`).join('; ')}\nHashtags: ${i.media.hashtags.join(' ') || '(none)'}` : '';
    parts.push(`THE PIECE (id ${i.id})\n"${i.title}", ${i.kind}, status ${i.status}${i.pitch?.channel ? `, for ${i.pitch.channel}` : ''}, date ${i.fixedDate ?? '(follows the roadmap)'}.\nBrief (what the manager wants it to say): ${i.brief || '(none)'}${i.pitch?.hook ? `\nPlanned first line: "${i.pitch.hook}"` : ''}${i.pitch?.context ? `\nSituation it answers: ${i.pitch.context}` : ''}${i.pitch?.audience ? `\nWho reads it: ${i.pitch.audience}` : ''}${i.pitch?.measure ? `\nSuccess looks like: ${i.pitch.measure}` : ''}${i.rationale ? `\nWhy it was proposed: ${cut(i.rationale, 400)}` : ''}${i.rejectedReason ? `\nRefused because: ${i.rejectedReason}` : ''}${i.draft ? `\nCurrent text (version ${i.revisions}):\n${i.draft.slice(0, 1500)}` : '\nNo text written yet.'}${media}\nHow it got here:\n${list(chain.map(s => `${s.who === 'you' ? 'the manager' : `the ${s.who}`}, ${when(s.at)}: ${cut(s.text, 120)}`), '(no step yet)')}`);
    basis.push(`the piece "${cut(i.title, 40)}"`);
  } else if (subject?.kind === 'milestone') {
    parts.push(`THE GOAL\n"${subject.title}": ${subject.intent || '(no description)'}. Wanted by ${subject.targetDate}. Pieces tied to it: ${list(items.filter(i => i.milestoneId === subject.id).map(i => `${i.title} (${i.status})`), '(none)')}`);
    basis.push(`the goal "${cut(subject.title, 40)}"`);
  }

  const accountText = () => {
    if (!facts) return '';
    basis.push(`your ${posts.length} posts`);
    const top = [...posts].sort((a, b) => engagement(b) - engagement(a)).slice(0, 3);
    return `THE ACCOUNT (${posts.length} posts${posts.some(p => p.simulated) ? ', demo data' : ''})\n${factsText(facts)}\nBest three by engagement:\n${list(top.map(p => `"${cut(p.text, 100)}" (${p.platform ?? 'instagram'}, ${when(p.postedAt)}): ${p.likes} likes, ${p.comments} comments, ${p.shares} shares, ${p.saves} saves${p.views ? `, ${p.views} views` : ''}`))}`;
  };
  const readingText = () => {
    if (!account) return '';
    basis.push(`the Analyst's reading of ${when(account.at)}`);
    const d = account.data;
    return `THE ANALYST'S READING${demo(account)} (${when(account.at)})\n${d.summary}\nStrengths: ${d.strengths.join('; ') || '(none)'}\nGaps: ${d.gaps.join('; ') || '(none)'}\nOpportunities: ${d.opportunities.join('; ') || '(none)'}\nFormats by engagement: ${d.stats.map((s, n) => `${n + 1}. ${s.format} ${s.avgEngagement} avg over ${s.posts}`).join('; ') || '(none)'}${d.winners?.length ? `\nWinners: ${d.winners.map(w => `"${cut(w.text, 60)}" (${w.engagement}): ${w.note}`).join('; ')}` : ''}${d.losers?.length ? `\nFlops: ${d.losers.map(w => `"${cut(w.text, 60)}" (${w.engagement}): ${w.note}`).join('; ')}` : ''}${d.fixes?.length ? `\nFixes proposed: ${d.fixes.map(f => `${f.problem} → ${f.fix} (first step: ${f.firstStep})`).join(' | ')}` : ''}${d.readings?.length ? `\nReadings: ${d.readings.map(r => `${r.fact}: ${r.meaning} → ${r.action}`).join(' | ')}` : ''}`;
  };
  const auditText = (full: boolean) => {
    if (!audit) return '';
    basis.push(`the field research of ${when(audit.at)}`);
    const a = audit.data;
    const works = a.whatWorks.map(w => `${w.format} (${w.strength}/5): ${w.why}${w.figure && (w.figure.value > 0 || w.figure.unit) ? ` [${w.figure.what}: ${w.figure.value} ${w.figure.unit}, ${w.figure.source}, ${w.figure.period}]` : ' [no figure found]'}${full && w.example ? `; e.g. ${cut(w.example, 100)}${w.exampleFigure ? ` (${w.exampleFigure})` : ''}${w.exampleUrl ? ` ${w.exampleUrl}` : ''}` : ''}`);
    return `THE FIELD RESEARCH${demo(audit)} (${when(audit.at)})\n${a.summary}\nWhat works:\n${list(works)}\nHooks: ${a.hooks.join('; ') || '(none)'}\nTopics: ${a.topics.join('; ') || '(none)'}\nAvoid: ${a.avoid.join('; ') || '(none)'}${a.misses?.length ? `\nWhat flops: ${a.misses.map(m => `${m.format}: ${m.why}${full ? ` (${cut(m.example, 80)})` : ''}`).join('; ')}` : ''}${a.benchmarks?.length ? `\nBenchmarks: ${a.benchmarks.map(b => `${b.name} ${b.value} ${b.unit} (${b.note}; ${b.source})`).join('; ')}` : ''}${full ? `\nSources: ${a.sources.slice(0, 8).join(', ')}` : ''}`;
  };
  const watchText = (full: boolean) => {
    if (!watch) return '';
    basis.push(`the competitor watch of ${when(watch.at)}`);
    const w = watch.data;
    return `THE COMPETITOR WATCH${demo(watch)} (${when(watch.at)})\n${w.market}\nPlayers:\n${list(w.players.map(p => `${p.name}${p.place ? `, ${cut(p.place, 80)}` : ''}${p.size ? ` (${cut(p.size, 60)})` : ''}${full && p.strategy?.rhythm ? `; rhythm: ${cut(p.strategy.rhythm, 80)}` : ''}${full && p.strategy?.formats ? `; formats: ${cut(p.strategy.formats, 80)}` : ''}${full && p.strategy?.tone ? `; tone: ${cut(p.strategy.tone, 60)}` : ''}${p.opening ? `; leaves open: ${cut(p.opening, 100)}` : ''}${p.strategy?.lesson ? `; lesson: ${cut(p.strategy.lesson, 100)}` : ''}`))}\nDates the audience lives by:\n${list(w.events.map(e => `${e.name}, ${e.when}: ${cut(e.why, 100)}${e.post ? ` → ${cut(e.post, 100)}` : ''}`))}${full ? `\nPosts seen:\n${list(w.finds.slice(0, 8).map(f => `${f.account} on ${f.platform}, ${f.format}: "${cut(f.title, 60)}"${f.number ? ` (${f.number})` : ''} → ${cut(f.whyForYou, 100)} ${f.url}`))}` : ''}`;
  };
  const planText = () => {
    if (!plan) return '';
    basis.push(`the Director's plan of ${when(plan.at)}`);
    return `THE DIRECTOR'S PLAN${demo(plan)} (${when(plan.at)}, ${plan.data.period})\n${plan.data.headline}\nMix: ${plan.data.mix.map(l => `${l.count} ${l.format} (${l.lever}: ${l.why})`).join('; ')}\nCadence: ${plan.data.cadence}\nNext: ${plan.data.next}`;
  };
  const refusedText = () => {
    if (!refused.length) return '';
    basis.push(`${refused.length} refusal${refused.length === 1 ? '' : 's'}`);
    return `WHAT THE MANAGER REFUSED (do not propose it again)\n${list(refused.map(i => `"${i.title}": ${i.rejectedReason || 'no reason given'}`))}`;
  };
  const styleText = () => {
    if (!posts.length) return '';
    const top = [...posts].sort((a, b) => engagement(b) - engagement(a)).slice(0, 3);
    basis.push(`your ${posts.length} posts`);
    return `HOW THE ACCOUNT ALREADY SPEAKS (its three best posts, as style references)\n${list(top.map(p => `"${cut(p.text, 220)}" (${p.likes} likes)`))}${facts?.words.length ? `\nWords more present in the best third of posts: ${facts.words.map(w => w.word).join(', ')}` : ''}${audit ? `\nHooks that work in the field: ${audit.data.hooks.join('; ')}` : ''}`;
  };
  const teamText = () => {
    const lines = (['scout', 'analyst', 'strategist', 'writer'] as AgentId[]).map(a => {
      const c = store.agentConfig(projectId, a);
      const last = store.activity(projectId, 40).find(x => x.agent === a);
      return `${a}: ${c.enabled ? `on, ${c.workers} worker(s)` : 'OFF'}${c.instructions ? `; told: "${cut(c.instructions, 80)}"` : ''}; last: ${last ? `${last.ok ? '' : 'FAILED, '}${cut(last.summary, 100)}` : 'has not worked yet'}`;
    });
    basis.push('the team\'s state');
    return `THE TEAM\n${list(lines)}${synthesis ? `\nLast summary (${when(synthesis.at)}): ${synthesis.data.headline} Next: ${synthesis.data.next}` : ''}`;
  };

  switch (agent) {
    case 'director': parts.push(teamText(), planText(), facts ? `THE ACCOUNT IN ONE LINE\n${factsText(facts).split('\n')[0]}` : '', audit ? `FIELD RESEARCH, IN ONE LINE\n${audit.data.summary}` : '', refusedText()); if (facts) basis.push(`your ${posts.length} posts`); if (audit) basis.push(`the field research of ${when(audit.at)}`); break;
    case 'scout': parts.push(auditText(true), watchText(true)); break;
    case 'analyst': parts.push(accountText(), readingText(), audit ? `THE FIELD, FOR COMPARISON\n${audit.data.summary}\nBenchmarks: ${audit.data.benchmarks?.map(b => `${b.name} ${b.value} ${b.unit}`).join('; ') || '(none)'}` : ''); if (audit) basis.push(`the field research of ${when(audit.at)}`); break;
    case 'strategist': parts.push(planText(), readingText(), auditText(false), watchText(false), facts ? `THE ACCOUNT IN TWO LINES\n${factsText(facts).split('\n').slice(0, 2).join('\n')}` : '', refusedText()); if (facts) basis.push(`your ${posts.length} posts`); break;
    case 'writer': parts.push(styleText(), refusedText()); break;
  }
  return { text: parts.filter(Boolean).join('\n\n'), basis: [...new Set(basis)] };
}

// --- the reply: words, a possible hand-off, and up to three things to do. Flat and total, as the strict JSON mode likes it.
const Who = z.enum(['none', 'director', 'scout', 'analyst', 'strategist', 'writer']);
const Worker = z.enum(['scout', 'analyst', 'strategist', 'writer', 'director']);
const PieceKind = z.enum([...ItemKind.options, 'none']);
const Action = z.object({
  kind: z.enum(['run', 'configure', 'revise', 'rebrief', 'propose', 'date', 'generate']),
  label: z.string(), // the verb phrase on the button, under 8 words, in the manager's language
  why: z.string(), // one line: what it changes and why, with the number or fact behind it
  agents: z.array(Worker), // run: who works, in order
  brief: z.string(), // run: what they are asked, concrete
  agent: Who, // configure: whom ('none' otherwise)
  enabled: z.enum(['on', 'off', 'unchanged']), // configure
  workers: z.number().int().min(0).max(MAX_WORKERS), // configure: 0 = unchanged
  instructions: z.string(), // configure: the COMPLETE new standing instructions for that agent ('' = unchanged)
  instruction: z.string(), // revise: the exact change to make to the piece's text
  newBrief: z.string(), // rebrief: the new brief, complete, one to three sentences
  title: z.string(), // propose: the piece's title
  hook: z.string(), // propose: its first line, as it would be published
  channel: z.string(), // propose: where it goes (Instagram, LinkedIn, newsletter…)
  pieceKind: PieceKind, // propose: what kind of piece ('none' otherwise)
  date: z.string(), // propose or date: YYYY-MM-DD, '' when none
  shot: z.number().int().min(-1).max(20), // generate: -1 = every missing picture, else the shot (0-based)
});
export const Reply = z.object({
  reply: z.string(),
  handOff: Who, // the colleague whose job this question really is, 'none' when it is yours
  actions: z.array(Action).max(3),
});
export type ReplyT = z.infer<typeof Reply>;
export const EMPTY_ACTION: z.infer<typeof Action> = { kind: 'run', label: '', why: '', agents: [], brief: '', agent: 'none', enabled: 'unchanged', workers: 0, instructions: '', instruction: '', newBrief: '', title: '', hook: '', channel: '', pieceKind: 'none', date: '', shot: -1 };

// What each agent may offer, said to the model in its own words.
export const CAN: Record<AgentId, string> = {
  director: `- run: have some agents work, in this order, with a brief (say who does what and what the manager gets at the end).
- configure: switch an agent on or off, change how many of it work at once (1 to ${MAX_WORKERS}: more = wider, costlier), or give it new standing instructions (put the COMPLETE instructions in "instructions").
- propose: put a piece on the board for the manager to judge (title, hook, channel, pieceKind, brief in "newBrief", date).`,
  scout: `- run: search the field again on a focused angle now (agents ["scout"], the angle in "brief").
- propose: turn something seen in the field (a post, a date) into a piece for the board (title, hook, channel, pieceKind, brief in "newBrief", date).
- configure: change your own standing instructions when the manager asks you to work differently (agent "scout", the COMPLETE new instructions in "instructions").`,
  analyst: `- run: read the account again now (agents ["analyst"]).
- propose: turn a fix into a first piece for the board (title, hook, channel, pieceKind, brief in "newBrief").
- rebrief: change what the piece being discussed should say (the complete new brief in "newBrief").
- configure: change your own standing instructions when the manager asks you to read differently (agent "analyst", the COMPLETE new instructions in "instructions").`,
  strategist: `- propose: a new piece for the board (title, hook as it would be published, channel, pieceKind, the brief in "newBrief", a date), when the manager asks for another angle or idea.
- rebrief: change what the piece being discussed should say (the complete new brief in "newBrief").
- date: move the piece being discussed to a date (YYYY-MM-DD in "date").
- run: send the Scout to research a precise angle (agents ["scout"], the angle in "brief"), or propose a new round yourself (agents ["strategist"], the brief).
- configure: change your own standing instructions when the manager asks you to propose differently (agent "strategist", the COMPLETE new instructions in "instructions").`,
  writer: `- revise: apply a change to the piece's text (the exact instruction in "instruction": you will make the change when the manager clicks). Offer it whenever the manager asks for a change or you suggest one: say what the new line would be in the reply.
- rebrief: change what the piece should say before writing it (the complete new brief in "newBrief").
- generate: make the pictures of the piece (shot -1 for every missing one, or the shot number). One paid call per picture: only when the manager wants pictures.
- configure: change your own standing instructions when the manager asks you to write differently (agent "writer", the COMPLETE new instructions in "instructions").`,
};

export const ROLE_OF: Record<AgentId, string> = {
  director: 'the Director leads the team: what to do this week, who runs, the plan',
  scout: 'the Scout knows the field: competitors, what works out there, dates the audience lives by, fresh web searches',
  analyst: 'the Analyst knows the account: every post and its numbers, silences, what the followers react to',
  strategist: 'the Strategist knows the board and the roadmap: why each piece, which angle, which date, what to post next',
  writer: 'the Writer knows the text: captions, first lines, hashtags, pictures, the draft of a piece',
};

// From the model's reply to actions the console can show and the team can apply: everything is checked here.
// A forged piece id, an action outside the agent's remit, an empty instruction: dropped, never offered.
export function actionsFrom(r: ReplyT, agent: AgentId, projectId: string, subject: Subject, svc: ContentService): SuggestedAction[] {
  const out: SuggestedAction[] = [];
  const item = subject?.kind === 'item' ? subject.item : undefined;
  const today = day(svc.now);
  const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= today;
  for (const a of r.actions.slice(0, 3)) {
    const label = cut(a.label, 60) || defaultLabel(a.kind);
    const why = cut(a.why, 200);
    if (a.kind === 'run') {
      const agents = a.agents.filter(x => agent === 'director' || x === agent || (agent === 'strategist' && x === 'scout'));
      if (!agents.length) continue;
      out.push({ kind: 'run', label, why, by: agent, agents: [...new Set(agents)], brief: cut(a.brief, 600) });
    } else if (a.kind === 'configure') {
      const target = a.agent === 'none' ? agent : a.agent;
      if (agent !== 'director' && target !== agent) continue;
      if (target === 'director' && a.enabled === 'off') continue;
      const instructions = a.instructions.trim();
      const cfg = svc.store.agentConfig(projectId, target);
      const patch = { ...(a.enabled === 'unchanged' ? {} : { enabled: a.enabled === 'on' }), ...(a.workers > 0 && a.workers !== cfg.workers ? { workers: a.workers } : {}), ...(instructions && instructions !== cfg.instructions.trim() ? { instructions } : {}) };
      if (!Object.keys(patch).length) continue;
      out.push({ kind: 'configure', label, why, by: agent, agent: target, ...patch });
    } else if (a.kind === 'revise') {
      if (agent !== 'writer' || !item || !item.draft || item.status === 'published' || !a.instruction.trim()) continue;
      out.push({ kind: 'revise', label, why, by: agent, itemId: item.id, instruction: cut(a.instruction, 600) });
    } else if (a.kind === 'rebrief') {
      if (!item || item.status === 'published' || agent === 'scout' || agent === 'director' || !a.newBrief.trim()) continue;
      out.push({ kind: 'rebrief', label, why, by: agent, itemId: item.id, brief: cut(a.newBrief, 1200) });
    } else if (a.kind === 'propose') {
      if (agent === 'writer' || !a.title.trim() || !a.newBrief.trim()) continue;
      out.push({ kind: 'propose', label, why, by: agent, title: cut(a.title, 120), brief: cut(a.newBrief, 1200), hook: cut(a.hook, 300), channel: cut(a.channel, 60), pieceKind: a.pieceKind === 'none' ? 'social-post' : a.pieceKind, date: validDate(a.date) ? a.date : addDays(today, 7) });
    } else if (a.kind === 'date') {
      if (!item || item.status === 'published' || (agent !== 'strategist' && agent !== 'director') || !validDate(a.date)) continue;
      out.push({ kind: 'date', label, why, by: agent, itemId: item.id, date: a.date });
    } else if (a.kind === 'generate') {
      if (agent !== 'writer' || !item?.media) continue;
      const index = a.shot < 0 ? undefined : a.shot;
      if (index !== undefined && !item.media.slides[index]) continue;
      const missing = item.media.slides.filter(s => !s.file).length;
      if (index === undefined && missing === 0) continue;
      out.push({ kind: 'generate', label: index === undefined ? `Generate ${missing} missing picture${missing === 1 ? '' : 's'}` : `Generate shot ${index + 1}`, why: why || 'One paid image call per picture.', by: agent, itemId: item.id, ...(index === undefined ? {} : { index }) });
    }
  }
  return out;
}

const defaultLabel = (k: string) => ({ run: 'Run it', configure: 'Apply', revise: 'Make the change', rebrief: 'Change the brief', propose: 'Add it to the board', date: 'Move the date', generate: 'Generate' } as Record<string, string>)[k] ?? 'Do it';
