import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentService } from './service.ts';
import { Team, demoAccount, formatStats } from './team.ts';
import type { LLM } from '../adapters/llm.ts';

const now = new Date('2026-11-01T09:00:00Z');

function setup(over: Partial<LLM> = {}) {
  const prompts: Record<string, string> = {};
  const llm: LLM = {
    search: async () => ({ text: 'Behind-the-scenes posts do well.', sources: ['https://example.com/a'] }),
    json: async (prompt, schema, name) => {
      prompts[name] = prompt;
      if (name === 'audit') return schema.parse({ summary: 'Build in public wins', whatWorks: [{ format: 'behind-the-scenes', why: 'trust', example: 'a' }], hooks: ['mistakes included'], topics: ['solo dev'], avoid: ['release notes alone'] });
      if (name === 'account_analysis') return schema.parse({ summary: 'Strong on BTS, weak on releases', strengths: ['bts'], gaps: ['no video'], opportunities: ['teasers'] });
      if (name === 'proposals') return schema.parse({ proposals: [
        { kind: 'teaser', title: 'Beta teaser', brief: 'tease', rationale: 'BTS wins and the beta lands soon', source: 'roadmap', milestoneId: 'beta', offsetDays: -5, date: '' },
        { kind: 'devlog', title: 'Week notes', brief: 'notes', rationale: 'account gap', source: 'account', milestoneId: 'ghost', offsetDays: 0, date: '2026-11-10' },
      ] });
      if (name === 'account_import') return schema.parse({ posts: [{ text: 'hello', format: 'tip', likes: 10, comments: 1, shares: 0, saves: 2, postedAt: 'yesterday' }] });
      return schema.parse({ draft: 'drafted' });
    },
    ...over,
  };
  const svc = new ContentService({
    llm, exportDir: mkdtempSync(join(tmpdir(), 'ripple-team-')), now: () => now, repoPath: () => '/r', git: async () => ['a1 add beta signup'],
    features: () => undefined, projectFeatures: () => [{ id: 'f', title: 'Signup', state: 'BUILDING', summary: 'beta signup' }],
  });
  return { svc, team: new Team(svc), prompts };
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
  assert.deepEqual(log.map(l => [l.agent, l.ok]), [['scout', false], ['analyst', true], ['strategist', true]]);
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
