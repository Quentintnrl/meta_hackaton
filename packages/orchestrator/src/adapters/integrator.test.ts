import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitIntegrator } from './integrator.ts';

const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });

// A repo on main with a feature branch checked out in a worktree, laid out like the builder does.
function setup(change = (wt: string) => writeFileSync(join(wt, 'b.txt'), 'feature\n')) {
  const dir = mkdtempSync(join(tmpdir(), 'ripple-int-'));
  const repo = join(dir, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeFileSync(join(repo, 'a.txt'), 'base\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'init');
  const wt = join(dir, 'wt', 'app', 'f1');
  git(repo, 'worktree', 'add', '-q', '-b', 'feature/f1', wt, 'main');
  change(wt);
  git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', 'feat');
  return { dir, repo, wt, integrator: new GitIntegrator(join(dir, 'wt')), req: { projectId: 'app', repoPath: repo, featureId: 'f1', push: false } };
}

test('merges the feature into main, removes the worktree and the branch', async () => {
  const { repo, wt, integrator, req } = setup();
  const r = await integrator.apply(req);
  assert.equal(r.pushed, false);
  assert.ok(existsSync(join(repo, 'b.txt')));
  assert.equal(existsSync(wt), false);
  assert.equal(git(repo, 'branch', '--list', 'feature/f1').trim(), '');
  assert.match(git(repo, 'log', '--merges', '--oneline'), /Merge feature\/f1/);
});

test('refuses to touch a checkout that is not on main or is dirty', async () => {
  const a = setup();
  git(a.repo, 'checkout', '-q', '-b', 'other');
  await assert.rejects(a.integrator.apply(a.req), /not "main"/);
  const b = setup();
  writeFileSync(join(b.repo, 'a.txt'), 'edited\n');
  await assert.rejects(b.integrator.apply(b.req), /uncommitted changes/);
  assert.equal(readFileSync(join(b.repo, 'a.txt'), 'utf8'), 'edited\n'); // untouched
});

test('a conflict is aborted and leaves main exactly as it was', async () => {
  const { repo, integrator, req } = setup(wt => writeFileSync(join(wt, 'a.txt'), 'feature\n'));
  writeFileSync(join(repo, 'a.txt'), 'main side\n');
  git(repo, 'commit', '-qam', 'diverge');
  const before = git(repo, 'rev-parse', 'HEAD');
  await assert.rejects(integrator.apply(req), /conflict/);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), before);
  assert.equal(git(repo, 'status', '--porcelain').trim(), '');
});

test('running it again after a completed merge is a no-op', async () => {
  const { integrator, req } = setup();
  const first = await integrator.apply(req);
  const second = await integrator.apply(req);
  assert.equal(second.commit, first.commit);
});

test('pushes only when asked, and a push failure does not undo the merge', async () => {
  const ok = setup();
  const remote = join(ok.dir, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  git(ok.repo, 'remote', 'add', 'origin', remote);
  const pushed = await ok.integrator.apply({ ...ok.req, push: true });
  assert.equal(pushed.pushed, true);
  assert.equal(git(remote, 'rev-parse', 'main').trim(), pushed.commit);

  const bad = setup();
  git(bad.repo, 'remote', 'add', 'origin', join(bad.dir, 'nowhere.git'));
  const r = await bad.integrator.apply({ ...bad.req, push: true });
  assert.equal(r.pushed, false);
  assert.ok(r.pushError);
  assert.ok(existsSync(join(bad.repo, 'b.txt'))); // merged anyway
});
