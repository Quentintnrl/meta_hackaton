import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
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
  assert.deepEqual(states, { 'notification-drawer': 'APPLIED', 'attachment-download': 'PR_READY' });
});

test('the roadmap shows one goal with a corrected projection', () => {
  const { svc } = demo();
  const [pilot] = svc.milestones(DEMO_PROJECT);
  assert.equal(pilot.delivered, 1, 'only the notification drawer is merged');
  assert.equal(pilot.atRisk, true);
  assert.equal(pilot.forecast!.calibration, 1.3);
  assert.equal(svc.store.forecasts(pilot.id).length, 2, 'the first projection and its correction');
});

test('the content covers every stage, and the account is labelled as fictional', () => {
  const { svc, content } = demo();
  const items = svc.calendar(DEMO_PROJECT);
  const by = (s: string) => items.filter(i => i.status === s).length;
  assert.equal(by('idea'), 1);
  assert.equal(by('briefed'), 1);
  assert.equal(by('drafted'), 1);
  assert.equal(by('approved'), 1);
  assert.equal(by('published'), 1);
  assert.deepEqual(new Set(items.filter(i => i.media).map(i => i.media!.format)), new Set(['carousel', 'image']));
  assert.ok(items.some(i => (i.shiftDays ?? 0) > 0), 'something is pushed back by the projection');
  assert.ok(items.filter(i => i.status === 'idea').every(i => i.rationale && i.source && i.proof?.yours && i.proof.field), 'every idea shows its numbers');
  assert.equal(content.latestReport(DEMO_PROJECT, 'account')!.simulated, true);
  assert.equal(content.latestReport(DEMO_PROJECT, 'audit')!.simulated, true, 'the seeded audit is fictional too');
  assert.ok(content.account(DEMO_PROJECT).every(p => p.simulated));
});

test('generated pictures exist on disk and the rest of the post can be generated later', () => {
  const { svc } = demo();
  const carousel = svc.calendar(DEMO_PROJECT).find(i => i.media?.format === 'carousel')!;
  assert.equal(carousel.media!.slides.filter(s => s.file).length, 2);
  for (const s of carousel.media!.slides.filter(x => x.file)) {
    const path = svc.mediaPath(carousel.id, s.file!);
    assert.ok(path);
    assert.ok(statSync(path!).size > 8000, 'a true picture, not a flat placeholder');
  }
});

test('the team overview works with no model at all', () => {
  const { svc } = demo();
  const o = new Team(svc).overview(DEMO_PROJECT);
  assert.ok(o.audit && o.account && o.accountPosts === 14);
  assert.equal(o.activity.length, 6);
  assert.equal(o.config.scout.workers, 2);
  assert.ok(o.synthesis);
  assert.ok(o.plan && o.plan.simulated, 'a plan built on the demo numbers, flagged as such');
  assert.equal(o.plan!.data.mix[0].yours!.value, o.account!.data.stats.find(s => s.format === 'demo video')!.avgEngagement, 'the plan quotes the real averages');
  assert.ok(o.audit!.data.whatWorks.every(w => w.figure.value > 0), 'every field format carries a measured figure');
  assert.equal(o.audit!.data.benchmarks.length, 3);
  assert.ok(o.audit!.simulated && o.account!.simulated, 'every figure in the demo is labelled as fictional');
});
