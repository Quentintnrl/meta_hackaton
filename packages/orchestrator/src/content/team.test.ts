import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentService } from './service.ts';
import { Team, demoAccount, formatStats } from './team.ts';
import type { LLM } from '../adapters/llm.ts';

const now = new Date('2026-11-01T09:00:00Z');

let directorReply: unknown = { reply: 'On it.', talkTo: 'none', actions: [] };
let agentReply: unknown = { reply: 'Sure.', newInstructions: '' };

function setup(over: Partial<LLM> = {}) {
  const prompts: Record<string, string> = {};
  const shots: Record<string, number> = {};
  const searches: string[] = [];
  const llm: LLM = {
    search: async p => { searches.push(p); return { text: 'Behind-the-scenes posts do well.', sources: ['https://example.com/a'] }; },
    json: async (prompt, schema, name, opts) => {
      prompts[name] = prompt;
      shots[name] = opts?.images?.length ?? 0;
      if (name === 'audit') return schema.parse({ summary: 'Build in public wins', whatWorks: [{ format: 'behind-the-scenes', why: 'trust', example: 'a', strength: 5 }], hooks: ['mistakes included'], topics: ['solo dev'], avoid: ['release notes alone'] });
      if (name === 'synthesis') return schema.parse({ headline: 'The team found what works', points: ['Build in public wins', 'Two proposals wait'], next: 'Decide on the proposals' });
      if (name === 'director_reply') return schema.parse(directorReply);
      if (name === 'agent_reply') return schema.parse(agentReply);
      if (name === 'account_analysis') return schema.parse({ summary: 'Strong on BTS, weak on releases', strengths: ['bts'], gaps: ['no video'], opportunities: ['teasers'] });
      if (name === 'proposals') return schema.parse({ proposals: [
        { kind: 'teaser', title: 'Beta teaser', brief: 'tease', rationale: 'BTS wins and the beta lands soon', source: 'roadmap', milestoneId: 'beta', offsetDays: -5, date: '' },
        { kind: 'devlog', title: 'Week notes', brief: 'notes', rationale: 'account gap', source: 'account', milestoneId: 'ghost', offsetDays: 0, date: '2026-11-10' },
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
  svc.setProfile('app', { voice: '', audience: '', language: 'French', autoDraft: false, niche: 'meal planning', directives: 'never mention pricing' });
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
  assert.deepEqual(log.map(l => [l.agent, l.ok]), [['scout', false], ['analyst', true], ['strategist', true], ['director', true]], 'the director sums up when something worked');
  assert.match(log[0].summary, /offline/);
  const plan = svc.store.chat('app', 'director').find(m => m.role === 'agent' && m.text.startsWith("Here's what I'm doing"));
  assert.ok(plan, 'the director announces the plan first');
  assert.match(plan!.text, /Scout researches.*Strategist proposes/, 'who does what, in order');
});

test('tick does not draft a proposal that is still waiting for the manager', async () => {
  const { svc, team } = setup();
  svc.setProfile('app', { voice: '', audience: '', language: 'English', autoDraft: true, niche: '', directives: '' });
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
  directorReply = { reply: 'I would add two scouts.', talkTo: 'scout', actions: [
    { label: 'Use 2 scouts', kind: 'configure', agents: [], brief: '', agent: 'scout', enabled: 'unchanged', workers: 2 },
    { label: 'Run the research', kind: 'run', agents: ['scout'], brief: 'beta', agent: 'none', enabled: 'unchanged', workers: 0 },
    { label: 'Broken', kind: 'configure', agents: [], brief: '', agent: 'none', enabled: 'off', workers: 0 },
  ] };
  const chat = await team.chatDirector('app', 'Research more deeply');
  assert.deepEqual(chat.map(m => m.role), ['user', 'agent']);
  const a = chat[1].actions;
  assert.deepEqual(a.map(x => x.kind), ['configure', 'run', 'talk'], 'an action with no target is dropped, the handoff is added');
  assert.equal(a[2].agent, 'scout');
  assert.equal(svc.store.agentConfig('app', 'scout').workers, 1, 'nothing applied yet');
  team.apply('app', 'App', a[0]);
  assert.equal(svc.store.agentConfig('app', 'scout').workers, 2);
});

test('an agent proposes a new behaviour; it is only applied on confirmation', async () => {
  const { svc, team } = setup();
  agentReply = { reply: 'I will keep it short.', newInstructions: 'Keep every proposal under 10 words.' };
  const chat = await team.chatAgent('app', 'writer', 'Write shorter');
  assert.equal(chat.at(-1)!.actions[0].instructions, 'Keep every proposal under 10 words.');
  assert.equal(svc.store.agentConfig('app', 'writer').instructions, '');
  team.apply('app', 'App', chat.at(-1)!.actions[0]);
  assert.equal(svc.store.agentConfig('app', 'writer').instructions, 'Keep every proposal under 10 words.');
  agentReply = { reply: 'Sure.', newInstructions: '' };
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
