import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { git, run } from '../exec.ts';

export interface ApplyRequest {
  projectId: string;
  repoPath: string;
  featureId: string;
  push: boolean;
}

export interface ApplyResult {
  commit: string;
  pushed: boolean;
  pushError?: string;
}

// Brings a built feature branch into the project's main branch.
export interface Integrator {
  apply(req: ApplyRequest): Promise<ApplyResult>;
}

const IDENTITY = ['-c', 'user.name=Ripple_handoff', '-c', 'user.email=ripple@localhost'];

export class GitIntegrator implements Integrator {
  #worktreesDir: string;
  #base: string;

  constructor(worktreesDir: string, base = 'main') {
    this.#worktreesDir = worktreesDir;
    this.#base = base;
  }

  async apply({ projectId, repoPath, featureId, push }: ApplyRequest): Promise<ApplyResult> {
    const base = this.#base;
    const branch = `feature/${featureId}`;
    const wt = join(this.#worktreesDir, projectId, featureId);

    // The checkout is the user's own for linked projects: never merge under their feet.
    const head = (await git(repoPath, 'rev-parse', '--abbrev-ref', 'HEAD')).trim();
    if (head !== base) throw new Error(`the repo is on "${head}", not "${base}". Check out ${base} and retry.`);
    if ((await git(repoPath, 'status', '--porcelain', '--untracked-files=no')).trim()) {
      throw new Error(`the repo has uncommitted changes on ${base}. Commit or stash them and retry.`);
    }

    const branchExists = (await run('git', ['rev-parse', '--verify', '--quiet', branch], { cwd: repoPath })).code === 0;
    // Already merged and cleaned up (a previous run was interrupted before it could report): nothing left to merge.
    if (branchExists) {
      const merged = (await run('git', ['merge-base', '--is-ancestor', branch, base], { cwd: repoPath })).code === 0;
      if (!merged) {
        const r = await run('git', [...IDENTITY, 'merge', '--no-ff', '-m', `Merge ${branch}`, branch], { cwd: repoPath });
        if (r.code !== 0) {
          await run('git', ['merge', '--abort'], { cwd: repoPath });
          throw new Error(`merge conflict with ${base}; nothing was changed. ${r.out.trim().slice(0, 200)}`);
        }
      }
      if (existsSync(wt)) await run('git', ['worktree', 'remove', '--force', wt], { cwd: repoPath });
      await run('git', ['branch', '-d', branch], { cwd: repoPath });
    }

    const commit = (await git(repoPath, 'rev-parse', 'HEAD')).trim();
    if (!push) return { commit, pushed: false };

    const r = await run('git', ['push', 'origin', base], { cwd: repoPath, timeoutMs: 120_000, env: { GIT_TERMINAL_PROMPT: '0' } });
    // The merge is done and stays done: a push problem is reported, not rolled back.
    return r.code === 0 ? { commit, pushed: true } : { commit, pushed: false, pushError: r.out.trim().slice(0, 300) };
  }
}
