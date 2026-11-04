import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentService } from './service.ts';
import { Team, demoAccount, formatStats, proofFor, sameFormat } from './team.ts';
import type { LLM } from '../adapters/llm.ts';

const now = new Date('2026-11-01T09:00:00Z');

// The fake model answers in the team's reply shape: words, a hand-off, actions. `act` fills an action's empty fields.
const act = (a: Record<string, unknown>) => ({ kind: 'run', label: '', why: '', agents: [], brief: '', agent: 'none', enabled: 'unchanged', workers: 0, instructions: '', instruction: '', newBrief: '', title: '', hook: '', channel: '', pieceKind: 'none', date: '', shot: -1, ...a });
let directorReply: unknown = { reply: 'On it.', handOff: 'none', actions: [] };
let agentReply: unknown = { reply: 'Sure.', handOff: 'none', actions: [] };

function setup(over: Partial<LLM> = {}) {
  const prompts: Record<string, string> = {};
  const shots: Record<string, number> = {};
  const searches: string[] = [];
  const llm: LLM = {
    search: async p => { searches.push(p); return { text: 'Behind-the-scenes posts do well.', sources: ['https://example.com/a'] }; },
    json: async (prompt, schema, name, opts) => {
      prompts[name] = prompt;
      shots[name] = opts?.images?.length ?? 0;
      if (name === 'audit') return schema.parse({ summary: 'Build in public wins', whatWorks: [{ format: 'behind-the-scenes', why: 'trust', example: 'a', strength: 5, figure: { what: 'average engagement rate', value: 4.2, unit: '%', source: 'https://example.com/a', period: '2026' }, exampleUrl: 'https://example.com/post/1', exampleFigure: '12k saves' }, { format: 'tutorial', why: 'saves', example: 'b', strength: 4 }], benchmarks: [{ name: 'posting frequency', value: 3, unit: 'per week', note: 'for accounts under 10k', source: 'https://example.com/a' }], hooks: ['mistakes included'], topics: ['solo dev'], avoid: ['release notes alone'], misses: [{ format: 'press release', why: 'nobody shares announcements with no story', example: 'a launch post stuck at 2 likes' }] });
      if (name === 'plan') return schema.parse({ period: 'the next 4 weeks', headline: 'Lean on behind-the-scenes, add tutorials', mix: [{ format: 'behind-the-scenes', count: 3, lever: 'double-down', why: 'top score here' }, { format: 'tutorial', count: 2, lever: 'fill-gap', why: 'the field saves them, you posted none' }], cadence: 'two a week', next: 'Accept the teaser' });
      if (name === 'synthesis') return schema.parse({ headline: 'The team found what works', points: ['Build in public wins', 'Two proposals wait'], next: 'Decide on the proposals' });
      if (name === 'director_reply') return schema.parse(directorReply);
      if (name === 'agent_reply') return schema.parse(agentReply);
      if (name === 'account_analysis') return schema.parse({ summary: 'Strong on BTS, weak on releases', strengths: ['bts'], gaps: ['no video'], opportunities: ['teasers'], winners: [{ text: "POV: it's 6pm and the fridge is empty", format: 'meme', engagement: 1227, note: 'shares carry it beyond followers' }], losers: [{ text: 'New in App: small fixes, big relief', format: 'release', engagement: 109, note: 'announcement with no story to save' }] });
      if (name === 'proposals') return schema.parse({ proposals: [
        { kind: 'teaser', title: 'Beta teaser', brief: 'tease', rationale: 'BTS wins and the beta lands soon', evidence: 'behind-the-scenes averages 742 here, top of the field', format: 'Behind the scenes', source: 'roadmap', milestoneId: 'beta', offsetDays: -5, date: '' },
        { kind: 'devlog', title: 'Week notes', brief: 'notes', rationale: 'account gap', evidence: '', source: 'account', milestoneId: 'ghost', offsetDays: 0, date: '2026-11-10' },
      ] });
      if (name === 'post' || name === 'post_revision') return schema.parse({ caption: `caption (${name})`, hashtags: ['#Meal Prep', 'mealprep', 'cooking'], format: 'carousel', slides: [
        { kind: 'image', visual: 'a plate, flat lay', text: 'Plan', seconds: 0 }, { kind: 'image', visual: 'a calendar', text: 'Shop', seconds: 0 } ] });
      if (name === 'account_import') return schema.parse({ posts: [{ text: 'hello', format: 'tip', likes: 10, comments: 1, shares: 0, saves: 2, postedAt: 'yesterday' }] });
      return schema.parse({ draft: 'drafted' });
    },
    ...over,
  };
  const dir = mkdtempSync(join(tmpdir(), 'ripple-team-'));
  const svc = new ContentService({
    llm, exportDir: dir, now: () => now, repoPath: () => '/r', git: async () => ['a1 add beta signup'],
    features: () => undefined, projectFeatures: () => [{ id: 'f', title: 'Signup', state: 'BUILDING', summary: 'beta signup' }],
    images: { generate: async () => Buffer.from('fake-image') },
  });
  return { svc, team: new Team(svc), prompts, shots, searches, dir };
}
const wait = async (team: Team, pid: string) => { while (team.working(pid)) await new Promise(r => setTimeout(r, 5)); };

test('format stats rank formats by engagement', () => {
  const s = formatStats(demoAccount('X', now));
  assert.equal(s[0].format, 'meme');
  assert.ok(s.every((x, i) => i === 0 || s[i - 1].avgEngagement >= x.avgEngagement));
  assert.ok(demoAccount('X', now).every(p => p.simulated));
});

test('the analyst needs an account, and flags demo data as simulated', async () => {
  const { svc, team } = setup();
  await assert.rejects(team.analyse('app'), /give the team your account/);
  team.loadDemoAccount('app', 'App');
  await team.scout('app', 'App');
  const r = await team.analyse('app');
  assert.equal(r.postCount, 14);
  assert.equal(svc.store.latestReport('app', 'account')!.simulated, true);
});

test('pasted posts are structured by the model, not invented', async () => {
  const { svc, team } = setup();
  const posts = await team.importAccount('app', 'hello 10 likes');
  assert.equal(posts[0].simulated, false);
  assert.equal(posts[0].postedAt, '2026-11-01', 'an unreadable date falls back to today');
  assert.equal(svc.store.account('app').length, 1);
});

test('a CSV export loads exact numbers without calling the model', async () => {
  const { svc, team } = setup({ json: async () => { throw new Error('the model must not be called for a CSV table'); } });
  const posts = await team.importAccount('app', 'text,likes,comments\nFirst post,12,3\nSecond,4,0');
  assert.deepEqual(posts.map(p => [p.text, p.likes, p.comments, p.simulated]), [['First post', 12, 3, false], ['Second', 4, 0, false]]);
  assert.equal(svc.store.account('app').length, 2);
});

test('the scout files flops with examples, kept as a watch log', async () => {
  const { svc, team } = setup();
  const audit = await team.scout('app', 'App');
  assert.equal(audit.misses.length, 1);
  assert.equal(audit.misses[0].format, 'press release');
  assert.ok(audit.misses[0].example, 'a concrete example, not a guess');
  await team.scout('app', 'App');
  const log = team.overview('app').audits!;
  assert.equal(log.length, 2, 'every round is kept, newest first');
  assert.ok(log[0].id > log[1].id);
});

test('with a backend that runs tools, the Scout watches the field as an agent and keeps its trail', async () => {
  const opened: string[] = [];
  const web = (async (u: string | URL) => { opened.push(String(u)); return { ok: true, status: 200, url: String(u), headers: new Headers({ 'content-type': 'text/html' }), text: async () => '<p>Berger-Levrault publie 3 posts par semaine</p>' }; }) as unknown as typeof fetch;
  const agentPrompts: string[] = [];
  const { svc, team, searches } = setup({
    agent: async (prompt, tools, schema, _name, opts) => {
      agentPrompts.push(prompt);
      const t = Object.fromEntries(tools.map(x => [x.name, x]));
      const r1 = await t.search.run({ query: 'acteurs comparables' });
      opts?.onStep?.({ tool: 'search', args: { query: 'acteurs comparables' }, result: r1 });
      const r2 = await t.open.run({ url: 'https://www.berger-levrault.com/' });
      opts?.onStep?.({ tool: 'open', args: { url: 'https://www.berger-levrault.com/' }, result: r2 });
      const r3 = await t.open.run({ url: 'http://localhost:9/private' });
      opts?.onStep?.({ tool: 'open', args: { url: 'http://localhost:9/private' }, result: r3 });
      return schema.parse({ market: 'm', players: [{ name: 'Berger-Levrault', url: 'https://www.berger-levrault.com/', what: 'éditeur', strategy: { rhythm: '3 posts par semaine' } }], finds: [], events: [] });
    },
  });
  const w = await new Team(svc, { web }).watch('app', 'App');
  assert.deepEqual(opened, ['https://www.berger-levrault.com/']);
  assert.equal(searches.length, 1, 'the search went through the Scout tool');
  assert.deepEqual(w.trail, ['Searched: acteurs comparables', 'Opened https://www.berger-levrault.com/', 'Opened http://localhost:9/private → only public http(s) pages can be opened.']);
  assert.deepEqual(w.sources, ['https://example.com/a', 'https://www.berger-levrault.com/'], 'sources are the pages it read, the refused one left out');
  assert.match(agentPrompts[0], /open each player's website or LinkedIn page/);
  assert.equal(svc.store.latestReport<{ trail?: string[] }>('app', 'watch')!.data.trail!.length, 3);
  void team;
});

test('the analyst names the best and worst posts with their real scores', async () => {
  const { svc, team, prompts } = setup();
  team.loadDemoAccount('app', 'App');
  const r = await team.analyse('app');
  assert.match(prompts.account_analysis, /winners/, 'the model is asked to pick them');
  assert.equal(r.winners[0].engagement, 1227);
  assert.equal(r.losers[0].engagement, 109);
  for (const w of [...r.winners, ...r.losers]) {
    const post = svc.store.account('app').find(p => p.text === w.text)!;
    assert.ok(post, `"${w.text}" is a real post`);
    assert.equal(post.likes + post.comments * 2 + post.shares * 3 + post.saves * 3, w.engagement, 'the score is the real one');
  }
});

test('a proposal carries its proof, shown apart from its reason', async () => {
  const { team } = setup();
  const [first, second] = await team.strategize('app');
  assert.match(first.rationale, /Evidence: behind-the-scenes averages 742/);
  assert.doesNotMatch(second.rationale, /Evidence:/, 'no proof, no line');
});

test('the strategist reads audit, account and roadmap, and cites them', async () => {
  const { svc, team, prompts } = setup();
  await svc.createMilestone({ projectId: 'app', title: 'beta', intent: 'open the beta', targetDate: '2026-11-20', scope: 2 });
  team.loadDemoAccount('app', 'App');
  await team.scout('app', 'App');
  await team.analyse('app');
  const made = await team.strategize('app', 'push the beta');
  assert.match(prompts.proposals, /Build in public wins|behind-the-scenes/);
  assert.match(prompts.proposals, /Strong on BTS/);
  assert.match(prompts.proposals, /id=beta/);
  assert.match(prompts.proposals, /Signup \[building\]/);
  assert.match(prompts.proposals, /add beta signup/);
  assert.match(prompts.proposals, /push the beta/);
  assert.equal(made.length, 2);
  assert.ok(made.every(i => i.status === 'idea' && i.origin === 'ai' && i.rationale));
  assert.equal(made[0].milestoneId, 'beta');
  assert.equal(made[1].milestoneId, undefined, 'an unknown milestone becomes a plain date');
  assert.equal(made[1].fixedDate, '2026-11-10');
});

test('proposals without research are marked as early sketches', async () => {
  const bare = await setup().team.strategize('app');
  assert.ok(bare.length > 0);
  assert.ok(bare.every(i => i.rationale.includes('Early sketch')), 'no audit and no account: marked');
  const full = setup();
  full.team.loadDemoAccount('app', 'App');
  await full.team.scout('app', 'App');
  await full.team.analyse('app');
  const grounded = await full.team.strategize('app');
  assert.ok(grounded.length > 0);
  assert.ok(grounded.every(i => !i.rationale.includes('Early sketch')), 'audit and account present: unmarked');
});

test('the scout looks the question up instead of bouncing it back', async () => {
  const { team, prompts, searches } = setup();
  await team.chatAgent('app', 'scout', 'what angle do meal prep apps take?');
  assert.ok(searches.some(s => s.includes('meal prep')), 'the question went to web search');
  assert.match(prompts.agent_reply, /Behind-the-scenes posts do well/, 'fresh results reached the prompt');
  const before = searches.length;
  await team.chatAgent('app', 'writer', 'is this too long?');
  assert.equal(searches.length, before, 'other agents answer from memory');
});

test('chatting about a piece sends its context invisibly', async () => {
  const { svc, team, prompts } = setup();
  await team.chatAgent('app', 'writer', 'is this too long?', 'Piece "Beta teaser" (teaser, idea). Brief: tease.');
  assert.match(prompts.agent_reply, /Beta teaser/, 'the agent sees the piece');
  assert.match(prompts.agent_reply, /never speak as them/i, 'the agent stays an advisor, not the creator');
  assert.match(prompts.agent_reply, /same language as the manager/i);
  assert.match(prompts.agent_reply, /cannot see pictures/i, 'the agent admits it cannot look at images');
  const thread = svc.store.chat('app', 'writer');
  assert.ok(thread.some(m => m.role === 'user' && m.text === 'is this too long?'));
  assert.ok(!thread.some(m => m.text.includes('Beta teaser')), 'stored messages show no context');
});

test('each subject gets its own chat session', async () => {
  const { svc, team, prompts } = setup();
  await team.chatAgent('app', 'writer', 'is this too long?', 'Piece A (teaser, idea).', 'item:aaa');
  await team.chatAgent('app', 'writer', 'and this one?', 'Piece B (teaser, idea).', 'item:bbb');
  assert.equal(svc.store.chat('app', 'writer:item:aaa').length, 2);
  assert.equal(svc.store.chat('app', 'writer:item:bbb').length, 2);
  assert.equal(svc.store.chat('app', 'writer').length, 0, 'the general thread stays empty');
  assert.match(prompts.agent_reply, /Piece B/, 'the second session sees its own piece');
  assert.ok(!prompts.agent_reply.includes('Piece A'), '...and nothing from the other session');
  await team.chatAgent('app', 'writer', 'hi', '', 'writer:item:aaa');
  assert.equal(svc.store.chat('app', 'writer').length, 2, 'a forged subject falls back to the bare thread');
});

test('asking about a post shows its pictures to the model', async () => {
  const { svc, team, prompts, shots, dir } = setup();
  const item = svc.store.addItem({ projectId: 'app', origin: 'ai', createdAt: now.toISOString(), kind: 'social-post', title: 'Testers', brief: 'call', status: 'drafted' });
  svc.store.updateItem(item.id, { media: { format: 'carousel', hashtags: [], slides: [{ kind: 'image', visual: 'a plate', text: 'Plan', seconds: 0, file: '1.jpg' }] } });
  mkdirSync(join(dir, 'media', item.id), { recursive: true });
  writeFileSync(join(dir, 'media', item.id, '1.jpg'), Buffer.from('fakejpeg'));
  await team.chatAgent('app', 'writer', 'What does my post show?', 'Piece "Testers" (social-post, drafted).', `item:${item.id}`);
  assert.equal(shots.agent_reply, 1, 'the generated picture went to the model');
  assert.match(prompts.agent_reply, /really see them/, 'the agent knows it can look');
  await team.chatAgent('app', 'writer', 'What does my post show?', 'Piece "Testers" (social-post, drafted).', 'item:ghost');
  assert.equal(shots.agent_reply, 0, 'an unknown piece sends no pictures');
  assert.match(prompts.agent_reply, /cannot see pictures/, '...and the agent stays honest');
});

test('the writer offers to generate the missing pictures, and one click does it', async () => {
  const { svc, team } = setup();
  const item = svc.store.addItem({ projectId: 'app', origin: 'ai', createdAt: now.toISOString(), kind: 'social-post', title: 'Posters', brief: 'call', status: 'drafted' });
  svc.store.updateItem(item.id, { media: { format: 'image', hashtags: [], slides: [{ kind: 'image', visual: 'a poster', text: 'Hi', seconds: 0 }] } });
  agentReply = { reply: 'I can generate it.', handOff: 'none', actions: [act({ kind: 'generate', label: 'Make it', shot: -1 })] };
  const msgs = await team.chatAgent('app', 'writer', 'generate the image of the post', 'Piece "Posters" (social-post, drafted).', `item:${item.id}`);
  const offer = msgs.at(-1)!.actions.find(a => a.kind === 'generate');
  assert.ok(offer, 'a generate button is proposed, nothing generated yet');
  assert.ok(!svc.store.item(item.id)!.media!.slides[0].file);
  await team.apply('app', 'App', offer!);
  assert.ok(svc.store.item(item.id)!.media!.slides[0].file, 'the picture was generated on confirmation');
  agentReply = { reply: 'Nope.', handOff: 'none', actions: [act({ kind: 'generate', label: 'Make it', shot: 7 })] };
  const again = await team.chatAgent('app', 'writer', 'generate it', 'Piece "Posters" (social-post, drafted).', `item:${item.id}`);
  assert.ok(!again.at(-1)!.actions.some(a => a.kind === 'generate'), 'a shot that does not exist is ignored');
  agentReply = { reply: 'Sure.', handOff: 'none', actions: [] };
});

test('a refused proposal teaches the next round', async () => {
  const { svc, team, prompts } = setup();
  const [a] = await team.strategize('app');
  svc.reject(a.id, 'too salesy');
  const again = await team.strategize('app');
  assert.match(prompts.proposals, /too salesy/);
  assert.equal(again.filter(i => i.title === a.title).length, 0, 'a refused title does not come back');
});

test('standing orders reach every agent', async () => {
  const { svc, team, prompts } = setup();
  svc.setProfile('app', { voice: '', audience: '', language: 'French', autoDraft: false, niche: 'meal planning', directives: 'never mention pricing', publishMode: 'local' });
  team.loadDemoAccount('app', 'App');
  await team.scout('app', 'App');
  await team.analyse('app');
  await team.strategize('app');
  assert.match(prompts.account_analysis, /never mention pricing/);
  assert.match(prompts.proposals, /never mention pricing/);
});

test('accepted pieces are drafted by the writer; proposals waiting are not', async () => {
  const { svc, team } = setup();
  const [a, b] = await team.strategize('app');
  svc.accept(a.id);
  const done = await team.write('app');
  assert.deepEqual(done.map(i => i.id), [a.id]);
  assert.equal(svc.store.item(b.id)!.draft, '');
});

test('a run goes through the agents in order, logs each, and survives a failing one', async () => {
  const { svc, team } = setup({ search: async () => { throw new Error('offline'); } });
  team.loadDemoAccount('app', 'App');
  assert.equal(team.start('app', 'App', ['scout', 'analyst', 'strategist']), true);
  assert.equal(team.start('app', 'App', ['scout']), false, 'one run at a time');
  await wait(team, 'app');
  const log = svc.store.activity('app').reverse();
  assert.deepEqual(log.map(l => [l.agent, l.ok]), [['scout', false], ['analyst', true], ['strategist', true], ['director', true], ['director', true]], 'the director plans, then sums up, when something worked');
  assert.match(log[0].summary, /offline/);
  const plan = svc.store.chat('app', 'director').find(m => m.role === 'agent' && m.text.startsWith("Here's what I'm doing"));
  assert.ok(plan, 'the director announces the plan first');
  assert.match(plan!.text, /Scout researches.*Strategist proposes/, 'who does what, in order');
});

test('tick does not draft a proposal that is still waiting for the manager', async () => {
  const { svc, team } = setup();
  svc.setProfile('app', { voice: '', audience: '', language: 'English', autoDraft: true, niche: '', directives: '', publishMode: 'local' });
  const [a] = await team.strategize('app');
  const item = svc.store.updateItem(a.id, { fixedDate: '2026-11-02' });
  assert.equal((await svc.tick()).drafted, 0);
  svc.accept(item.id);
  assert.equal((await svc.tick()).drafted, 1);
});

test('more scouts take different angles in parallel, and their findings are merged', async () => {
  const { team, searches } = setup();
  await team.scout('app', 'App');
  assert.equal(searches.length, 1);
  team.setConfig('app', 'scout', { workers: 3 });
  searches.length = 0;
  await team.scout('app', 'App');
  assert.equal(searches.length, 3);
  assert.equal(new Set(searches).size, 3, 'each one has its own angle');
});

test('workers are bounded, and the director cannot be switched off', () => {
  const { team } = setup();
  assert.equal(team.setConfig('app', 'writer', { workers: 99 }).workers, 3);
  assert.equal(team.setConfig('app', 'writer', { workers: 0 }).workers, 1);
  assert.throws(() => team.setConfig('app', 'director', { enabled: false }), /leads the team/);
});

test('an agent switched off is skipped, and says so', async () => {
  const { svc, team } = setup();
  team.setConfig('app', 'strategist', { enabled: false });
  team.start('app', 'App', ['strategist']);
  await wait(team, 'app');
  assert.equal(svc.store.items('app').length, 0);
  assert.match(svc.store.activity('app')[0].summary, /switched off/);
});

test('instructions given to an agent reach its prompt, and only its prompt', async () => {
  const { team, prompts } = setup();
  team.setConfig('app', 'strategist', { instructions: 'always propose one video' });
  team.loadDemoAccount('app', 'App');
  await team.scout('app', 'App');
  await team.analyse('app');
  await team.strategize('app');
  assert.match(prompts.proposals, /always propose one video/);
  assert.doesNotMatch(prompts.account_analysis, /always propose one video/);
});

test('the director answers first, suggests actions, and nothing runs until they are confirmed', async () => {
  const { svc, team } = setup();
  directorReply = { reply: 'I would add two scouts.', handOff: 'scout', actions: [
    act({ label: 'Use 2 scouts', kind: 'configure', agent: 'scout', workers: 2, why: 'two angles at once' }),
    act({ label: 'Run the research', kind: 'run', agents: ['scout'], brief: 'beta' }),
    act({ label: 'Broken', kind: 'configure', agent: 'director', enabled: 'off' }),
  ] };
  const chat = await team.chatDirector('app', 'Research more deeply');
  assert.deepEqual(chat.map(m => m.role), ['user', 'agent']);
  assert.equal(chat[1].agent, 'director', 'the message says who answered');
  const a = chat[1].actions;
  assert.deepEqual(a.map(x => x.kind), ['configure', 'run', 'talk'], 'switching the director off is dropped; on its own thread the hand-off is a door');
  assert.equal(a[2].agent, 'scout');
  assert.equal(a[0].why, 'two angles at once');
  assert.equal(svc.store.agentConfig('app', 'scout').workers, 1, 'nothing applied yet');
  team.apply('app', 'App', a[0]);
  assert.equal(svc.store.agentConfig('app', 'scout').workers, 2);
  directorReply = { reply: 'On it.', handOff: 'none', actions: [] };
});

test('an agent proposes a new behaviour; it is only applied on confirmation', async () => {
  const { svc, team } = setup();
  agentReply = { reply: 'I will keep it short.', handOff: 'none', actions: [act({ kind: 'configure', label: 'Apply', agent: 'writer', instructions: 'Keep every proposal under 10 words.' }), act({ kind: 'configure', label: 'Sneaky', agent: 'scout', instructions: 'Stop searching.' })] };
  const chat = await team.chatAgent('app', 'writer', 'Write shorter');
  assert.equal(chat.at(-1)!.actions.length, 1, 'an agent only changes its own behaviour');
  assert.equal(chat.at(-1)!.actions[0].instructions, 'Keep every proposal under 10 words.');
  assert.equal(svc.store.agentConfig('app', 'writer').instructions, '');
  team.apply('app', 'App', chat.at(-1)!.actions[0]);
  assert.equal(svc.store.agentConfig('app', 'writer').instructions, 'Keep every proposal under 10 words.');
  agentReply = { reply: 'Sure.', handOff: 'none', actions: [] };
  assert.deepEqual((await team.chatAgent('app', 'writer', 'thanks')).at(-1)!.actions, []);
  assert.equal(svc.store.chat('app', 'scout').length, 0, 'each agent has its own conversation');
});

test('after a run the director leaves a note', async () => {
  const { svc, team } = setup();
  team.loadDemoAccount('app', 'App');
  team.start('app', 'App', ['scout', 'analyst', 'strategist']);
  await wait(team, 'app');
  const o = team.overview('app');
  assert.equal(o.synthesis!.data.headline, 'The team found what works');
  assert.match(svc.store.chat('app', 'director').at(-1)!.text, /Next: Decide/);
});

test('the scout keeps measured figures with their source, and says when there is none', async () => {
  const { team, searches } = setup();
  const audit = await team.scout('app', 'App');
  assert.match(searches[0], /measured figures|benchmarks/, 'the research asks for numbers');
  const [bts, tuto] = audit.whatWorks;
  assert.equal(bts.figure.value, 4.2);
  assert.equal(bts.figure.source, 'https://example.com/a');
  assert.equal(bts.exampleUrl, 'https://example.com/post/1');
  assert.equal(tuto.figure.value, 0, 'no number in the text: none, not a guess');
  assert.equal(tuto.figure.unit, '');
  assert.equal(audit.benchmarks[0].name, 'posting frequency');
});

test('a proposal carries a numeric proof computed from the stats, never written by the model', async () => {
  const { svc, team } = setup();
  team.loadDemoAccount('app', 'App');
  await team.scout('app', 'App');
  await team.analyse('app');
  const [first, second] = await team.strategize('app');
  const stats = formatStats(svc.store.account('app'));
  const bts = stats.find(s => s.format === 'behind-the-scenes')!;
  assert.ok(first.proof, 'the format is named, so the numbers follow');
  assert.equal(first.proof!.yours!.value, bts.avgEngagement, 'the account score is the real average');
  assert.equal(first.proof!.yours!.rank, stats.indexOf(bts) + 1);
  assert.equal(first.proof!.field!.value, 4.2, 'the field figure comes from the audit');
  assert.equal(first.proof!.text, 'behind-the-scenes averages 742 here, top of the field');
  assert.equal(second.proof, undefined, 'no format, no evidence: nothing to show');
  assert.equal(svc.store.item(first.id)!.proof!.yours!.value, bts.avgEngagement, 'kept with the item');
});

test('the director writes a plan whose numbers come from the stats', async () => {
  const { svc, team, prompts } = setup();
  team.loadDemoAccount('app', 'App');
  team.start('app', 'App', ['scout', 'analyst', 'strategist']);
  await wait(team, 'app');
  const plan = team.overview('app').plan!;
  assert.ok(plan, 'a run with new research or numbers ends with a plan');
  assert.match(prompts.plan, /behind-the-scenes: \d+ over \d+ post/, 'the director reads the real scores');
  assert.match(prompts.plan, /4\.2% average engagement rate/, 'and the field figures');
  const stats = formatStats(svc.store.account('app'));
  assert.equal(plan.data.mix[0].yours!.value, stats.find(s => s.format === 'behind-the-scenes')!.avgEngagement);
  assert.equal(plan.data.mix[0].field!.value, 4.2);
  assert.equal(plan.data.mix[1].yours!.value, stats.find(s => s.format === 'tutorial')!.avgEngagement);
  assert.equal(plan.data.mix[1].field, undefined, 'no field figure for tutorials in this research');
  assert.equal(plan.data.basis.posts, 14);
  assert.equal(plan.simulated, true, 'built on demo numbers, flagged as such');
});

test('asked alone, the director only plans', async () => {
  const { team } = setup();
  team.loadDemoAccount('app', 'App');
  await team.analyse('app');
  team.start('app', 'App', ['director']);
  await wait(team, 'app');
  const o = team.overview('app');
  assert.ok(o.plan);
  assert.equal(o.synthesis, undefined, 'nothing ran, nothing to sum up');
  assert.deepEqual(o.activity.map(a => [a.agent, a.summary.startsWith('Plan for')]), [['director', true]]);
});

test('format names match loosely, so "quick tutorial" finds "tutorial"', () => {
  assert.ok(sameFormat('quick tutorial', 'tutorial'));
  assert.ok(sameFormat('Behind the scenes', 'behind-the-scenes'));
  assert.ok(!sameFormat('meme', 'release'));
  assert.ok(!sameFormat('', 'release'));
  const stats = [{ format: 'tutorial', posts: 3, avgEngagement: 830 }, { format: 'meme', posts: 2, avgEngagement: 1129 }];
  assert.equal(proofFor('Quick tutorials', '', stats)!.yours!.rank, 1, 'rank follows the given order');
  assert.equal(proofFor('podcast', '', stats), undefined);
  assert.deepEqual(proofFor('', 'some proof', stats), { format: '', text: 'some proof' });
});

test('a connected Instagram account is read by the app before the Analyst works, and the console knows it', async () => {
  const { svc } = setup();
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  const fetchFn = async (url: string) => url.includes('/media?') ? ok({ data: [{ id: 'm1', caption: 'Lundi en mairie', media_type: 'IMAGE', timestamp: '2026-10-29T08:00:00+0000', like_count: 5, comments_count: 0 }] })
    : url.includes('/insights') ? ok({ data: [{ name: 'reach', values: [{ value: 120 }] }] })
    : ok({ username: 'mairie360', followers_count: 44 });
  const team = new Team(svc, { instagram: () => ({ userId: '1', token: 't' }), fetch: fetchFn });
  assert.equal(team.connected().instagram, true);
  assert.equal(new Team(svc).connected().instagram, Boolean(process.env.INSTAGRAM_ACCESS_TOKEN), 'without credentials nothing is connected');
  team.start('app', 'App', ['analyst'], '');
  while (team.working('app')) await new Promise(r => setTimeout(r, 10));
  const posts = svc.store.account('app');
  assert.deepEqual(posts.map(p => [p.platform, p.text, p.likes, p.views, p.simulated]), [['instagram', 'Lundi en mairie', 5, 120, false]]);
  assert.deepEqual(svc.store.snapshots('app').map(s => [s.platform, s.followers]), [['instagram', 44]]);
  assert.ok(svc.store.activity('app').some(a => a.agent === 'scout' && /Read Instagram @mairie360: 1 posts, 44 followers/.test(a.summary)));
  assert.ok(svc.store.latestReport('app', 'account'), 'the Analyst then read the fresh posts');
});

test('a question goes to the agent whose job it is, with no model call for the routing', async () => {
  const { svc, team, prompts } = setup();
  team.loadDemoAccount('app', 'App');
  await team.ask('app', { message: 'Why did my likes drop in October?', hint: 'studio' });
  const t = svc.store.chat('app', 'team');
  assert.equal(t.at(-1)!.agent, 'analyst', 'numbers are the Analyst\'s');
  assert.match(prompts.agent_reply, /THE ACCOUNT \(14 posts, demo data\)/, 'the Analyst reads the real facts');
  assert.match(prompts.agent_reply, /Best three by engagement/);
  assert.ok(t.at(-1)!.basis!.includes('your 14 posts'), 'the console can say what it leaned on');
  await team.ask('app', { message: 'What are the competitors posting about?', hint: 'studio' });
  assert.equal(svc.store.chat('app', 'team').at(-1)!.agent, 'scout');
  await team.ask('app', { message: 'Make the first line shorter', hint: 'studio' });
  assert.equal(svc.store.chat('app', 'team').at(-1)!.agent, 'writer');
  await team.ask('app', { message: 'Bonjour', hint: 'community' });
  assert.equal(svc.store.chat('app', 'team').at(-1)!.agent, 'analyst', 'no word: the page decides');
  await team.ask('app', { message: 'Bonjour', hint: 'watch' });
  assert.equal(svc.store.chat('app', 'team').at(-1)!.agent, 'scout');
  await team.ask('app', { message: 'Bonjour' });
  assert.equal(svc.store.chat('app', 'team').at(-1)!.agent, 'director', 'nothing to go on: the Director');
});

test('an agent passes a question to a colleague, who answers in the same thread', async () => {
  const { svc, team } = setup();
  let n = 0;
  agentReply = { reply: 'Passing to the Writer.', handOff: 'writer', actions: [] };
  const llmJson = svc.llm.json.bind(svc.llm);
  svc.llm.json = async (prompt, schema, name, opts) => {
    if (name === 'agent_reply' && ++n === 2) return schema.parse({ reply: 'Shorter it is.', handOff: 'strategist', actions: [] });
    return llmJson(prompt, schema, name, opts);
  };
  const t = await team.ask('app', { message: 'Hello', hint: 'community' });
  assert.deepEqual(t.map(m => [m.role, m.agent ?? '']), [['user', ''], ['agent', 'analyst'], ['agent', 'writer']], 'the Analyst passes, the Writer answers');
  assert.equal(t[1].actions[0].kind, 'talk', 'the pass-on is written down');
  assert.deepEqual(t[2].actions, [], 'one hop only: the Writer\'s own hand-off is not followed');
  agentReply = { reply: 'Sure.', handOff: 'none', actions: [] };
});

test('the strategist can put a piece on the board from the chat, the writer can revise one; both wait for a click', async () => {
  const { svc, team } = setup();
  agentReply = { reply: 'Here is another angle.', handOff: 'none', actions: [
    act({ kind: 'propose', label: 'Add it', why: 'tutorials save best', title: 'Sunday reset in 12 minutes', newBrief: 'Show the five-dinner plan.', hook: 'Five dinners, twelve minutes.', channel: 'Instagram', pieceKind: 'social-post', date: '2026-11-20' }),
    act({ kind: 'propose', label: 'Empty', title: '', newBrief: '' }),
    act({ kind: 'date', label: 'Move', date: '2026-11-20' }),
  ] };
  const t = await team.ask('app', { message: 'Give me another angle', hint: 'studio' });
  const a = t.at(-1)!.actions;
  assert.deepEqual(a.map(x => x.kind), ['propose'], 'an empty proposal and a date with no piece are dropped');
  assert.equal(a[0].by, 'strategist');
  assert.equal(svc.store.items('app').length, 0, 'nothing on the board yet');
  const r = await team.apply('app', 'App', a[0]);
  const item = svc.store.item(r.itemId!)!;
  assert.equal(item.status, 'idea'); assert.equal(item.origin, 'ai'); assert.equal(item.source, 'roadmap'); assert.equal(item.fixedDate, '2026-11-20');
  assert.equal(item.pitch!.hook, 'Five dinners, twelve minutes.');
  assert.match(svc.chain(item)[0].text, /Proposed in the chat/);

  svc.store.updateItem(item.id, { status: 'drafted', draft: 'A long first line that goes on.' });
  agentReply = { reply: 'I would cut the first line.', handOff: 'none', actions: [act({ kind: 'revise', label: 'Cut it', why: 'hooks under 8 words win', instruction: 'Cut the first line to five words.' }), act({ kind: 'rebrief', label: 'Brief', newBrief: 'Lead with the number.' })] };
  const t2 = await team.ask('app', { message: 'Make the first line shorter', about: `item:${item.id}`, hint: 'studio' });
  const w = t2.at(-1)!;
  assert.equal(w.agent, 'writer');
  assert.deepEqual(w.actions.map(x => x.kind), ['revise', 'rebrief']);
  assert.equal(svc.store.item(item.id)!.draft, 'A long first line that goes on.', 'nothing changed yet');
  await team.apply('app', 'App', w.actions[0]);
  assert.equal(svc.store.item(item.id)!.draft, 'caption (post_revision)', 'the Writer revised on the click');
  await team.apply('app', 'App', w.actions[1]);
  assert.equal(svc.store.item(item.id)!.brief, 'Lead with the number.');
  assert.ok(svc.chain(svc.store.item(item.id)!).some(s => s.kind === 'asked' && s.text.startsWith('To the team')), 'the chat about the piece is in its chain');
  agentReply = { reply: 'Sure.', handOff: 'none', actions: [] };
});

test('Stop aborts the call in flight, skips the agents still to come, and says so in the log', async () => {
  // A model that never answers until the Stop signal aborts it.
  const { svc, team } = setup({ json: (_p, _s, _n, o) => new Promise((_, rej) => o?.signal?.addEventListener('abort', () => rej(new DOMException('stopped', 'AbortError')))) });
  svc.store.setAccount('app', [{ platform: 'instagram', text: 'hello', format: 'tip', likes: 3, comments: 0, shares: 0, saves: 0, postedAt: '2026-10-20', simulated: false }]);
  assert.equal(team.stop('app'), false, 'nothing to stop yet');
  assert.ok(team.start('app', 'App', ['analyst', 'strategist'], ''));
  await new Promise(r => setTimeout(r, 20));
  assert.equal(team.working('app')?.agent, 'analyst');
  assert.equal(team.stop('app'), true);
  for (let i = 0; i < 50 && team.working('app'); i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(team.working('app'), undefined, 'the pass is over');
  const log = svc.store.activity('app', 10).map(a => `${a.agent}:${a.summary}`);
  assert.ok(log.some(l => l.startsWith('analyst:Stopped by you')), log.join(' | '));
  assert.ok(log.some(l => l.startsWith('strategist:Skipped: you stopped')), log.join(' | '));
  assert.ok(log.some(l => l.startsWith('director:Pass stopped by you')), log.join(' | '));
  assert.ok(log.every(l => !l.includes('Could not')), 'no failure logged for a stop');
});

test('a pass the team starts on duty says so first, a pass you ask for does not', async () => {
  const { svc, team } = setup();
  svc.store.setAccount('app', [{ platform: 'instagram', text: 'hello', format: 'tip', likes: 3, comments: 0, shares: 0, saves: 0, postedAt: '2026-10-20', simulated: false }]);
  svc.setProfile('app', { ...svc.profile('app'), autopilot: true });
  assert.deepEqual(team.duty([{ id: 'app', name: 'App' }]), ['app'], 'on duty, never passed: it starts');
  await wait(team, 'app');
  const log = svc.store.activity('app', 20).reverse().map(a => `${a.agent}:${a.summary}`);
  assert.ok(log[0].startsWith('director:On duty: started this pass on its own'), log.join(' | '));
  assert.deepEqual(team.duty([{ id: 'app', name: 'App' }]), [], 'passed less than a day ago: it waits');
  assert.ok(team.start('app', 'App', ['analyst'], ''));
  await wait(team, 'app');
  const mine = svc.store.activity('app', 3).map(a => a.summary);
  assert.ok(mine.every(s => !s.startsWith('On duty')), 'a pass you asked for is not marked on duty');
});

test('the Analyst and the Strategist leave a trace of what they read, counted by the server', async () => {
  const { svc, team } = setup();
  svc.store.setAccount('app', [{ platform: 'instagram', text: 'hello', format: 'tip', likes: 3, comments: 0, shares: 0, saves: 0, postedAt: '2026-10-20', simulated: false }]);
  svc.setProfile('app', { ...svc.profile('app'), directives: 'Never publish a price.' });
  assert.ok(team.start('app', 'App', ['scout', 'analyst', 'strategist'], 'more testers'));
  await wait(team, 'app');
  const a = svc.store.latestReport<{ trail: string[] }>('app', 'account')!.data.trail;
  assert.equal(a[0], 'Read 1 posts on instagram, from 2026-10-20 to 2026-10-20, with their likes, comments, shares and saves as given');
  assert.ok(a.some(l => l.startsWith("Took the Scout's field research of 2026-11-01: 2 formats")), a.join(' | '));
  assert.ok(a.includes('Read your standing orders'));
  const p = svc.store.latestReport<{ trail: string[]; made: number }>('app', 'proposals')!.data;
  assert.equal(p.made, 2);
  assert.ok(p.trail.some(l => l.startsWith("Took the Analyst's reading of 2026-11-01: 1 posts compared")), p.trail.join(' | '));
  assert.ok(p.trail.includes('Read your brief: "more testers"'));
  assert.equal(p.trail.at(-1), 'Proposed 2 piece(s)');
  assert.ok(new Team(svc).overview('app').proposals, 'the console gets it');
});
