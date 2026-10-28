import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActor } from 'xstate';
import { defaultAutonomy } from '@ripple/shared';
import { featureMachine } from './machine.ts';
import { Journal } from './journal.ts';
import { SimulatedPublisher } from './adapters/simulated-publisher.ts';

const start = (autonomy = defaultAutonomy) => {
  const a = createActor(featureMachine, { input: { featureId: 'f1', autonomy } });
  a.start();
  return a;
};
const state = (a: ReturnType<typeof start>) => a.getSnapshot().value;

test('low autonomy parks at the plan gate until approved', () => {
  const a = start();
  a.send({ type: 'PLAN_READY' });
  assert.equal(state(a), 'PLANNED');
  a.send({ type: 'APPROVE', gate: 'merge' }); // wrong gate is ignored
  assert.equal(state(a), 'PLANNED');
  a.send({ type: 'APPROVE', gate: 'plan' });
  assert.equal(state(a), 'BUILDING');
});

test('high autonomy goes through every gate on its own', () => {
  const a = start({ plan: 'high', visual: 'high', merge: 'high', publish: 'high', teaser: 'high' });
  for (const type of ['PLAN_READY', 'BUILD_DONE', 'VISUAL_OK', 'MERGE_DONE', 'FEEDBACK_READY', 'ANNOUNCE_READY', 'PUBLISHED'] as const) {
    a.send({ type });
  }
  assert.equal(state(a), 'PUBLISHED');
});

test('visual diff retries the build once more, then hands over to the user', () => {
  const a = start();
  a.send({ type: 'PLAN_READY' });
  a.send({ type: 'APPROVE', gate: 'plan' });
  for (let i = 0; i < 2; i++) {
    a.send({ type: 'BUILD_DONE' });
    a.send({ type: 'VISUAL_DIFF' });
    assert.equal(state(a), 'BUILDING');
  }
  a.send({ type: 'BUILD_DONE' });
  a.send({ type: 'VISUAL_DIFF' });
  assert.equal(state(a), 'PR_READY');
});

test('journal keeps events in order per feature', () => {
  const j = new Journal();
  j.append('f1', 'PLANNED');
  j.append('f2', 'PLANNED');
  j.append('f1', 'BUILDING', { attempt: 1 });
  assert.deepEqual(j.list('f1').map(e => e.type), ['PLANNED', 'BUILDING']);
  assert.equal(j.list().length, 3);
});

test('simulated publisher is flagged as simulated', async () => {
  const p = new SimulatedPublisher();
  const r = await p.publish({ caption: 'hi', imagePath: 'x.jpeg' });
  assert.equal(r.simulated, true);
  assert.equal(p.posts.length, 1);
});

test('a failed merge waits for the user and can be retried, even at high autonomy', () => {
  const a = start({ plan: 'high', visual: 'high', merge: 'high', publish: 'high', teaser: 'high' });
  for (const type of ['PLAN_READY', 'BUILD_DONE', 'VISUAL_OK'] as const) a.send({ type });
  assert.equal(state(a), 'MERGING');
  a.send({ type: 'MERGE_FAILED' });
  assert.equal(state(a), 'MERGE_FAILED'); // no automatic loop
  a.send({ type: 'APPROVE', gate: 'merge' });
  assert.equal(state(a), 'MERGING');
});
