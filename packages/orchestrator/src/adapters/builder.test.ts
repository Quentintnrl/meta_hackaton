import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MuseCodeBuilder } from './builder.ts';

const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' });

function setup(script: string) {
  const dir = mkdtempSync(join(tmpdir(), 'ripple-'));
  const repo = join(dir, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeFileSync(join(repo, 'a.txt'), 'hello\n');
  sh(repo, 'add', '-A');
  sh(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  // Fake `muse`: runs in the workspace, like the real one.
  const bin = join(dir, 'muse');
  writeFileSync(bin, `#!/bin/sh\ncat >/dev/null\n${script}\n`);
  chmodSync(bin, 0o755);
  const builder = new MuseCodeBuilder({ worktreesDir: join(dir, 'wt'), apiKey: 'k', museBin: bin });
  return { build: (featureId: string, prompt = 'x') => builder.build({ projectId: 'app', repoPath: repo, featureId, prompt }) };
}

test('builds on a feature branch and returns the diff, main untouched', async () => {
  const b = setup(`echo world >> "$PWD/a.txt"`);
  const r = await b.build('shopping-list');
  assert.equal(r.branch, 'feature/shopping-list');
  assert.match(r.diff, /\+world/);
  assert.match(r.stat, /a\.txt/);
});

test('a second attempt reuses the branch and adds a commit', async () => {
  const b = setup(`date +%N >> "$PWD/a.txt"`);
  const one = await b.build('f1');
  const two = await b.build('f1', 'retry');
  assert.equal(two.branch, one.branch);
  assert.ok(two.diff.length > one.diff.length);
});

test('no change is an error, and unsafe ids are refused', async () => {
  const b = setup(`true`);
  await assert.rejects(b.build('f1'), /no change/);
  await assert.rejects(b.build('../evil'), /unsafe id/);
});

test('a failing muse is reported', async () => {
  const b = setup(`exit 3`);
  await assert.rejects(b.build('f1'), /exited with 3/);
});
