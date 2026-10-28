import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitBeforeShooter } from './before.ts';
import { cleanEnv } from '../exec.ts';

const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'ripple-before-'));
  const r = join(dir, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', r]);
  writeFileSync(join(r, 'page.txt'), 'before the feature\n');
  git(r, 'add', '-A'); git(r, 'commit', '-q', '-m', 'init');
  return { dir, r };
}

test('shoots the base branch in a throwaway detached worktree, and cleans up', async () => {
  const { dir, r } = repo();
  const seen: { worktree?: string; content?: string; viewport?: unknown } = {};
  const capture = { capture: async (q: { worktree: string; viewport: unknown; chooseActions: (l: string[]) => Promise<unknown[]> }) => {
    seen.worktree = q.worktree; seen.viewport = q.viewport;
    seen.content = readFileSync(join(q.worktree, 'page.txt'), 'utf8');
    assert.deepEqual(await q.chooseActions(['Shopping list']), []); // nothing to click before the feature exists
    return Buffer.from('PNG');
  } };
  const out = join(dir, 'out', 'f1', 'before.png');
  await new GitBeforeShooter({ capture, worktreesDir: join(dir, 'wt') }).shoot({ projectId: 'app', repoPath: r, featureId: 'f1', viewport: { width: 1280, height: 800 }, outFile: out });
  assert.equal(seen.content, 'before the feature\n');
  assert.deepEqual(seen.viewport, { width: 1280, height: 800 });
  assert.equal(readFileSync(out, 'utf8'), 'PNG');
  assert.equal(existsSync(seen.worktree!), false);
  assert.equal(git(r, 'branch', '--list').trim(), '* main'); // no branch left behind
  assert.equal(git(r, 'worktree', 'list').trim().split('\n').length, 1);
});

test('the worktree is removed even when the capture fails; unsafe ids are refused', async () => {
  const { dir, r } = repo();
  const shooter = new GitBeforeShooter({ capture: { capture: async () => { throw new Error('app did not start'); } }, worktreesDir: join(dir, 'wt') });
  const req = { projectId: 'app', repoPath: r, featureId: 'f1', viewport: { width: 800, height: 600 }, outFile: join(dir, 'b.png') };
  await assert.rejects(shooter.shoot(req), /did not start/);
  assert.equal(git(r, 'worktree', 'list').trim().split('\n').length, 1);
  await assert.rejects(shooter.shoot({ ...req, featureId: '../x' }), /unsafe id/);
});

test('children do not inherit the settings of the pnpm that started the orchestrator', () => {
  const env = cleanEnv({ GIT_TERMINAL_PROMPT: '0' }, {
    PATH: '/bin', NODE_OPTIONS: '--dns-result-order=ipv4first', npm_config_filter: '@ripple/orchestrator', npm_package_name: 'x',
    pnpm_config_verify_deps_before_run: 'false', PNPM_PACKAGE_NAME: '@ripple/orchestrator', INIT_CWD: '/repo', HOME_KEPT: 'a',
  });
  assert.deepEqual(env, { PATH: '/bin', NODE_OPTIONS: '--dns-result-order=ipv4first', HOME_KEPT: 'a', GIT_TERMINAL_PROMPT: '0' });
});
