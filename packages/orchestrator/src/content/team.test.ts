import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
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
  const searches: string[] = [];
  const llm: LLM = {
    search: async p => { searches.push(p); return { text: 'Behind-the-scenes posts do well.', sources: ['https://example.com/a'] }; },
    json: async (prompt, schema, name) => {
      prompts[name] = prompt;
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
  const svc = new ContentService({
    llm, exportDir: mkdtempSync(join(tmpdir(), 'ripple-team-')), now: () => now, repoPath: () => '/r', git: async () => ['a1 add beta signup'],
    features: () => undefined, projectFeatures: () => [{ id: 'f', title: 'Signup', state: 'BUILDING', summary: 'beta signup' }],
  });
  return { svc, team: new Team(svc), prompts, searches };
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
  assert.equal(r.postCount, 8);
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
