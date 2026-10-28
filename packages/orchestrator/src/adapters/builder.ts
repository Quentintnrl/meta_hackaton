import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, run } from '../exec.ts';

export interface BuildRequest {
  projectId: string;
  repoPath: string;
  featureId: string;
  prompt: string;
}

export interface BuildResult {
  branch: string;
  worktree?: string; // where the branch is checked out; the visual check runs the app from here
  stat: string;
  diff: string;
}

// Implements a feature on a branch of the target repo and reports the diff. Muse Code, or a fallback.
export interface Builder {
  build(req: BuildRequest): Promise<BuildResult>;
}

interface MuseCodeOptions {
  worktreesDir: string;
  apiKey: string;
  base?: string;
  museBin?: string;
  timeoutMs?: number;
}

export class MuseCodeBuilder implements Builder {
  #o: Required<Omit<MuseCodeOptions, never>>;

  constructor(o: MuseCodeOptions) {
    this.#o = { base: 'main', museBin: 'muse', timeoutMs: 10 * 60_000, ...o };
  }

  async build({ projectId, repoPath, featureId, prompt }: BuildRequest): Promise<BuildResult> {
    // Ids end up in a branch name and a path: keep them to a safe alphabet.
    for (const id of [featureId, projectId]) if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(id)) throw new Error(`unsafe id: ${id}`);
    const { worktreesDir, apiKey, base, museBin, timeoutMs } = this.#o;
    const branch = `feature/${featureId}`;
    const wt = join(worktreesDir, projectId, featureId);

    mkdirSync(join(worktreesDir, projectId), { recursive: true });
    if (!existsSync(wt)) {
      const exists = (await run('git', ['rev-parse', '--verify', '--quiet', branch], { cwd: repoPath })).code === 0;
      await git(repoPath, 'worktree', 'add', ...(exists ? [wt, branch] : ['-b', branch, wt, base]));
    }

    const promptFile = join(wt, '..', `${featureId}.prompt.txt`);
    writeFileSync(promptFile, prompt);
    // Never contributor mode (Meta may train on it); approval and sandbox stay ON, nothing is auto-trusted.
    const r = await run(museBin, [
      'exec', '--api-key-stdin', '--workspace', wt, '--prompt-file', promptFile,
      '--contributor-mode', 'off', '--no-session-log', '--approval-mode', 'never',
    ], { cwd: wt, stdin: apiKey, timeoutMs });
    if (r.code !== 0) throw new Error(`muse exec exited with ${r.code}: ${r.out.slice(-300)}`);

    await git(wt, 'add', '-A');
    if ((await git(wt, 'status', '--porcelain')).trim()) {
      await git(wt, '-c', 'user.name=Ripple_handoff', '-c', 'user.email=ripple@localhost', 'commit', '-q', '-m', `feat(${featureId}): built by Muse Code`);
    }
    const stat = (await git(wt, 'diff', '--stat', `${base}...HEAD`)).trim();
    if (!stat) throw new Error('the builder produced no change');
    return { branch, worktree: wt, stat, diff: await git(wt, 'diff', `${base}...HEAD`) };
  }
}
