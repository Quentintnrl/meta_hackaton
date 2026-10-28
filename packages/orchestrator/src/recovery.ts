import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LLM } from './adapters/llm.ts';
import { git, run } from './exec.ts';

// What can be done about a failed agent. A closed set: a diagnosis never carries a command of its own,
// so a model's guess can only ever pick one of these.
export type FixKind = 'retry' | 'prune-worktrees' | 'reset-branch';

export interface Fix {
  kind: FixKind;
  label: string; // the button
  detail: string; // exactly what will be done
  destructive: boolean;
}

export interface Diagnosis {
  cause: string; // plain words: what went wrong and where
  fix: Fix;
}

export interface FailureContext {
  agent: string;
  message: string;
  repoPath: string;
  featureId: string;
  llm?: LLM;
}

const retry = (label = 'Try again', detail = 'Runs the same step again, without changing anything.'): Fix => ({ kind: 'retry', label, detail, destructive: false });

const Guess = z.object({ cause: z.string(), transient: z.boolean() });

const AGENT_NAMES: Record<string, string> = {
  planner: 'The planner', builder: 'The builder (Muse Code)', before: 'The capture of the app before the feature',
  visual: 'The visual check', integrator: 'The merge',
};

// Worktrees of the target repo that have `feature/<id>` checked out, other than the repo's own folder.
async function worktreesOnBranch(repoPath: string, branch: string): Promise<string[]> {
  const out = await git(repoPath, 'worktree', 'list', '--porcelain');
  const found: string[] = [];
  for (const block of out.split('\n\n')) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    if (path && new RegExp(`^branch refs/heads/${branch}$`, 'm').test(block) && path !== repoPath) found.push(path);
  }
  return found;
}

// Unmerged work on the branch, so the person can see what the reset throws away before saying yes.
async function unmerged(repoPath: string, branch: string): Promise<{ commits: number; subjects: string[] } | null> {
  if ((await run('git', ['rev-parse', '--verify', '--quiet', branch], { cwd: repoPath })).code !== 0) return null;
  const log = (await run('git', ['log', '--format=%s', branch, '--not', 'HEAD'], { cwd: repoPath })).out.trim();
  const subjects = log ? log.split('\n') : [];
  return { commits: subjects.length, subjects: subjects.slice(0, 3) };
}

export async function diagnose(c: FailureContext): Promise<Diagnosis> {
  const who = AGENT_NAMES[c.agent] ?? `The ${c.agent} step`;
  const m = c.message;

  // The branch or the folder of an earlier attempt is still there.
  if (c.agent === 'builder' && /already used by worktree|already checked out|already exists/i.test(m)) {
    const branch = `feature/${c.featureId}`;
    const trees = await worktreesOnBranch(c.repoPath, branch).catch(() => []);
    const old = await unmerged(c.repoPath, branch).catch(() => null);
    const lost = old && old.commits > 0
      ? ` It holds ${old.commits} commit${old.commits > 1 ? 's' : ''} that never reached the main branch (${old.subjects.map(s => `"${s}"`).join(', ')}), which will be lost.`
      : ' It holds nothing that is not already in the main branch.';
    return {
      cause: `${who} could not start: an earlier attempt at this feature left its branch ${branch}${trees.length ? ' and its working folder' : ''} behind, and git will not create them twice.`,
      fix: {
        kind: 'reset-branch', label: 'Remove the leftovers and rebuild',
        detail: `Removes ${trees.length ? `the working folder ${trees.join(', ')} and ` : ''}the branch ${branch}.${lost} The feature is then rebuilt from the main branch.`,
        destructive: true,
      },
    };
  }

  // A working folder git still lists although it is gone.
  if (/already registered|missing but locked|missing but already registered|is a missing/i.test(m)) {
    return {
      cause: `${who} found a working folder that git still lists but that no longer exists.`,
      fix: { kind: 'prune-worktrees', label: 'Clean git\'s list and retry', detail: 'Runs `git worktree prune` on the project, which only forgets folders that are already gone, then retries.', destructive: false },
    };
  }

  if (/did not answer on/i.test(m)) {
    return { cause: `${who} could not get the app to start: it did not answer within 60 seconds. Its dev script may be broken, or a dependency may be missing.`, fix: retry() };
  }
  if (/install failed/i.test(m)) {
    return { cause: `${who} could not install the app's dependencies. Check the network, then try again.`, fix: retry() };
  }
  if (/ENETUNREACH|ETIMEDOUT|ECONNRESET|fetch failed|Meta API (429|5\d\d)/i.test(m)) {
    return { cause: `${who} lost the connection to the Meta API, or the API is busy. This usually passes.`, fix: retry() };
  }
  if (/produced no change/i.test(m)) {
    return { cause: 'Muse Code ran but changed no file, so there is nothing to review.', fix: retry('Rebuild', 'Runs the builder again on the same plan.') };
  }

  // Unknown: ask the model for an explanation. It can explain, not act: the only fix on offer is a retry.
  if (c.llm) {
    try {
      const g = await c.llm.json(
        `A step of a software pipeline failed. Explain the cause in one or two plain sentences for a non-expert, and say whether trying again could help (a network glitch, a timeout) or not.
Step: ${c.agent}
Error:
${m.slice(0, 800)}`,
        Guess, 'failure_guess',
      );
      return { cause: `${who} failed. ${g.cause}`, fix: retry(g.transient ? 'Try again' : 'Try again anyway') };
    } catch { /* fall through to the raw error */ }
  }
  return { cause: `${who} failed: ${m.slice(0, 300)}`, fix: retry() };
}

// Applies a fix. Everything here is bounded to the project's repo and to this feature's own branch.
export async function applyFix(kind: FixKind, c: { repoPath: string; featureId: string }): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(c.featureId)) throw new Error(`unsafe id: ${c.featureId}`);
  switch (kind) {
    case 'retry': return 'retrying';
    case 'prune-worktrees':
      await git(c.repoPath, 'worktree', 'prune');
      return 'pruned git\'s list of working folders';
    case 'reset-branch': {
      const branch = `feature/${c.featureId}`;
      for (const path of await worktreesOnBranch(c.repoPath, branch)) await git(c.repoPath, 'worktree', 'remove', '--force', path);
      await git(c.repoPath, 'worktree', 'prune');
      if ((await run('git', ['rev-parse', '--verify', '--quiet', branch], { cwd: c.repoPath })).code === 0) await git(c.repoPath, 'branch', '-D', branch);
      return `removed ${branch} and its working folder`;
    }
  }
}

// The fixes the user chose to apply without asking again. Kept in a small JSON file, outside the journal,
// because it is a setting and not an event.
export class AutoFixStore {
  #path?: string;
  #kinds: Set<FixKind>;

  constructor(path?: string) {
    this.#path = path;
    this.#kinds = new Set();
    if (path && existsSync(path)) {
      try {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
        if (Array.isArray(raw)) for (const k of raw) if (k === 'retry' || k === 'prune-worktrees' || k === 'reset-branch') this.#kinds.add(k);
      } catch { /* unreadable: start empty */ }
    }
  }

  has(kind: FixKind) { return this.#kinds.has(kind); }
  list(): FixKind[] { return [...this.#kinds]; }
  enable(kind: FixKind) { this.#kinds.add(kind); this.#save(); }
  disable(kind: FixKind) { this.#kinds.delete(kind); this.#save(); }

  #save() {
    if (!this.#path) return;
    mkdirSync(dirname(this.#path), { recursive: true });
    writeFileSync(this.#path, JSON.stringify([...this.#kinds]));
  }
}
