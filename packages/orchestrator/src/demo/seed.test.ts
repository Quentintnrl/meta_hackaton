import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Journal } from '../journal.ts';
import { ProjectStore } from '../projects.ts';
import { ContentStore } from '../content/store.ts';
import { ContentService } from '../content/service.ts';
import { Runtime } from '../runtime.ts';
import { Team } from '../content/team.ts';
import { DEMO_PROJECT, seedDemo } from './seed.ts';

const now = new Date('2026-11-01T09:00:00Z');

function demo() {
  const dir = mkdtempSync(join(tmpdir(), 'ripple-demo-'));
  const journal = new Journal();
  const projects = new ProjectStore();
  const content = new ContentStore();
  seedDemo({ journal, projects, content, mediaDir: join(dir, 'media'), repoPath: dir, now });
  // The runtime replays the journal: the demo features must come back in the states the seed claims.
  const rt = new Runtime({ llm: { json: async () => { throw new Error('no model in the demo'); } }, journal, projects });
  const svc = new ContentService({
    store: content, llm: { json: async () => { throw new Error('no model in the demo'); } }, exportDir: dir, repoPath: () => dir, now: () => now,
    features: id => { const f = rt.get(id); return f && { projectId: f.projectId, title: f.title, state: f.state }; },
    projectFeatures: pid => rt.list().filter(f => f.projectId === pid).map(f => ({ id: f.id, title: f.title, state: f.state })),
  });
  return { svc, rt, content, dir };
}

test('the demo features come back from the journal in the claimed states', () => {
  const { rt } = demo();
  const states = Object.fromEntries(rt.list().map(f => [f.id, f.state]));
  assert.deepEqual(states, { 'login-screen': 'APPLIED', 'meal-planner': 'APPLIED', 'dark-mode': 'APPLIED', 'recipe-search': 'PR_READY' });
});

test('the roadmap shows a finished milestone, one slipping, one far away', () => {
  const { svc } = demo();
  const [alpha, beta, list] = svc.milestones(DEMO_PROJECT);
  assert.equal(alpha.status, 'done');
  assert.equal(alpha.delivered, 2);
  assert.equal(beta.delivered, 1, 'only dark mode is merged');
  assert.equal(beta.atRisk, true);
  assert.equal(beta.forecast!.calibration, 1.3);
  assert.equal(svc.store.forecasts(beta.id).length, 3, 'the history of its projections is there');
  assert.equal(list.delivered, 0);
});

test('the content covers every stage, and the account is labelled as fictional', () => {
  const { svc, content } = demo();
  const items = svc.calendar(DEMO_PROJECT);
  const by = (s: string) => items.filter(i => i.status === s).length;
  assert.equal(by('idea'), 4);
  assert.equal(by('rejected'), 1);
  assert.ok(by('briefed') >= 3 && by('drafted') >= 3 && by('approved') === 1 && by('published') === 1);
  assert.deepEqual(new Set(items.filter(i => i.media).map(i => i.media!.format)), new Set(['carousel', 'video', 'image']));
  assert.ok(items.some(i => (i.shiftDays ?? 0) > 0), 'something is pushed back by the projection');
  assert.ok(items.filter(i => i.status === 'idea').every(i => i.rationale && i.source));
  assert.equal(content.latestReport(DEMO_PROJECT, 'account')!.simulated, true);
  assert.ok(content.account(DEMO_PROJECT).every(p => p.simulated));
});

test('generated pictures exist on disk and the rest of the post can be generated later', () => {
  const { svc } = demo();
  const carousel = svc.calendar(DEMO_PROJECT).find(i => i.media?.format === 'carousel')!;
  assert.equal(carousel.media!.slides.filter(s => s.file).length, 2);
  for (const s of carousel.media!.slides.filter(x => x.file)) assert.ok(svc.mediaPath(carousel.id, s.file!));
});

test('the team overview works with no model at all', () => {
  const { svc } = demo();
  const o = new Team(svc).overview(DEMO_PROJECT);
  assert.ok(o.audit && o.account && o.accountPosts === 8);
  assert.equal(o.activity.length, 5);
  assert.equal(o.config.scout.workers, 2);
  assert.ok(o.synthesis);
});
