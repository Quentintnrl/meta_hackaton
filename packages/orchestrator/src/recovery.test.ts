import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from './runtime.ts';
import { ProjectStore } from './projects.ts';
import { AutoFixStore, applyFix, diagnose } from './recovery.ts';
import type { LLM } from './adapters/llm.ts';
import type { Builder } from './adapters/builder.ts';
import type { Plan } from './planner.ts';

const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });

// A repo on main with a leftover feature branch (one unmerged commit) checked out in a worktree: what an earlier attempt leaves behind.
function leftover(id = 'f1') {
  const dir = mkdtempSync(join(tmpdir(), 'ripple-rec-'));
  const repo = join(dir, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeFileSync(join(repo, 'a.txt'), 'base\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'init');
  const wt = join(dir, 'old', id);
  git(repo, 'worktree', 'add', '-q', '-b', `feature/${id}`, wt, 'main');
  writeFileSync(join(wt, 'b.txt'), 'old\n');
  git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', 'old attempt');
  return { repo, wt };
}
const CLASH = (id = 'f1') => `git worktree add x feature/${id} failed: fatal: 'feature/${id}' is already used by worktree at '/somewhere'`;

test('a leftover branch is diagnosed, and the fix says what it throws away', async () => {
  const { repo } = leftover();
  const d = await diagnose({ agent: 'builder', message: CLASH(), repoPath: repo, featureId: 'f1' });
  assert.equal(d.fix.kind, 'reset-branch');
  assert.equal(d.fix.destructive, true);
  assert.match(d.fix.detail, /1 commit/);
  assert.match(d.fix.detail, /old attempt/);
});

test('reset-branch removes the working folder and the branch, and only those', async () => {
  const { repo, wt } = leftover();
  await applyFix('reset-branch', { repoPath: repo, featureId: 'f1' });
  assert.equal(existsSync(wt), false);
  assert.equal(git(repo, 'branch', '--list', 'feature/f1').trim(), '');
  assert.equal(git(repo, 'branch', '--show-current').trim(), 'main');
  await assert.rejects(applyFix('reset-branch', { repoPath: repo, featureId: '../evil' }), /unsafe id/);
});

test('an unknown error is explained by the model but can only be retried', async () => {
  const llm: LLM = { json: async (_p, schema) => schema.parse({ cause: 'The disk is full.', transient: false }) };
  const d = await diagnose({ agent: 'builder', message: 'ENOSPC: no space left', repoPath: tmpdir(), featureId: 'f1', llm });
  assert.equal(d.fix.kind, 'retry');
  assert.match(d.cause, /disk is full/);
});

const plan: Plan = { summary: 's', needsInput: false, reason: '', steps: [{ title: 't', detail: 'd' }], options: [] };
const llm: LLM = { json: async (_p, schema) => schema.parse(plan) };
const settle = () => new Promise(r => setTimeout(r, 60));

// Fails like the real builder until the leftovers are gone.
function flakyBuilder(repo: string): Builder & { calls: number } {
  const b = {
    calls: 0,
    async build({ featureId }: { featureId: string }) {
      b.calls++;
      if (git(repo, 'branch', '--list', `feature/${featureId}`).trim()) throw new Error(CLASH(featureId));
      return { branch: `feature/${featureId}`, stat: '1 file', diff: '' };
    },
  };
  return b as unknown as Builder & { calls: number };
}

function setup(auto?: AutoFixStore) {
  const { repo } = leftover('f1');
  const projects = new ProjectStore();
  projects.add({ name: 'App', path: repo, repoUrl: '', source: 'link' });
  const builder = flakyBuilder(repo);
  const rt = new Runtime({ llm, projects, builder, autoFix: auto });
  return { rt, repo, builder, projects };
}

test('a failed build waits for the user, and applying the fix reruns it', async () => {
  const { rt, builder } = setup();
  rt.create('f1', { title: 't', design: 'd', projectId: 'app' });
  await settle();
  rt.send('f1', { type: 'APPROVE', gate: 'plan' });
  await settle();
  const f = rt.get('f1')!;
  assert.equal(f.state, 'BUILDING');
  assert.equal(f.failure?.agent, 'builder');
  assert.equal(f.failure?.fix.kind, 'reset-branch');
  assert.equal(builder.calls, 1);

  await rt.resolveFailure('f1', { action: 'apply' });
  await settle();
  assert.equal(builder.calls, 2);
  assert.equal(rt.get('f1')!.failure, undefined);
  assert.equal(rt.get('f1')!.state, 'VISUAL_CHECK');
  assert.deepEqual(rt.autoFix.list(), []);
});

test('"always" is remembered, and the next failure of that kind is fixed without asking, once', async () => {
  const { rt, repo } = setup();
  rt.create('f1', { title: 't', design: 'd', projectId: 'app' });
  await settle();
  rt.send('f1', { type: 'APPROVE', gate: 'plan' });
  await settle();
  await rt.resolveFailure('f1', { action: 'apply', always: true });
  await settle();
  assert.deepEqual(rt.autoFix.list(), ['reset-branch']);

  // Same mess for another feature: no question this time.
  const wt = join(repo, '..', 'old', 'f2');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/f2', wt, 'main');
  rt.create('f2', { title: 't', design: 'd', projectId: 'app' });
  await settle();
  rt.send('f2', { type: 'APPROVE', gate: 'plan' });
  await settle(); await settle();
  assert.equal(rt.get('f2')!.failure, undefined);
  assert.equal(rt.get('f2')!.state, 'VISUAL_CHECK');
  assert.ok(rt.journal.list('f2').some(e => e.type === 'RECOVERY' && (e.payload as { auto: boolean }).auto));
});

test('a pending failure survives a restart and is not retried behind the user\'s back', async () => {
  const { rt, builder, projects } = setup();
  rt.create('f1', { title: 't', design: 'd', projectId: 'app' });
  await settle();
  rt.send('f1', { type: 'APPROVE', gate: 'plan' });
  await settle();
  const calls = builder.calls;
  const again = new Runtime({ llm, journal: rt.journal, builder, projects });
  await settle();
  assert.equal(builder.calls, calls);
  assert.equal(again.get('f1')?.failure?.agent, 'builder');
});
