import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { git, run } from '../exec.ts';
import type { Capture } from './capture.ts';

export interface BeforeRequest {
  projectId: string;
  repoPath: string;
  featureId: string;
  viewport: { width: number; height: number };
  outFile: string; // PNG
}

// Screenshots the app as it is on the base branch, before the feature: the "before" of a before and after.
export interface BeforeShooter {
  shoot(req: BeforeRequest): Promise<void>;
}

// `git worktree remove` can leave behind untracked folders such as node_modules: delete what is left, then forget the entry.
async function removeWorktree(repoPath: string, wt: string) {
  await run('git', ['worktree', 'remove', '--force', wt], { cwd: repoPath });
  rmSync(wt, { recursive: true, force: true });
  await run('git', ['worktree', 'prune'], { cwd: repoPath });
}

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,60}$/;

export class GitBeforeShooter implements BeforeShooter {
  #capture: Capture;
  #worktreesDir: string;
  #base: string;

  constructor(o: { capture: Capture; worktreesDir: string; base?: string }) {
    this.#capture = o.capture;
    this.#worktreesDir = o.worktreesDir;
    this.#base = o.base ?? 'main';
  }

  async shoot({ projectId, repoPath, featureId, viewport, outFile }: BeforeRequest): Promise<void> {
    for (const id of [projectId, featureId]) if (!SAFE_ID.test(id)) throw new Error(`unsafe id: ${id}`);
    // A detached checkout of the base commit: no branch is created, the user's checkout is not touched.
    const wt = join(this.#worktreesDir, projectId, `${featureId}-before`);
    mkdirSync(dirname(wt), { recursive: true });
    await removeWorktree(repoPath, wt); // left over from an interrupted run
    await git(repoPath, 'worktree', 'add', '--detach', wt, this.#base);
    try {
      // The home page as it is: the feature does not exist yet, so there is nothing to click.
      const png = await this.#capture.capture({ worktree: wt, viewport, chooseActions: async () => [] });
      mkdirSync(dirname(outFile), { recursive: true });
      writeFileSync(outFile, png);
    } finally {
      await removeWorktree(repoPath, wt);
    }
  }
}
