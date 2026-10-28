import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { git, run } from './exec.ts';

// Three ways to get a repository under Ripple_handoff. A source only provisions a repo on disk;
// what is done with it afterwards (features, builds) is the same for all of them.
export type ProjectSourceKind = 'link' | 'clone' | 'scratch';

export interface Provisioned {
  path: string;
  repoUrl: string; // empty when the repo only exists locally
}

export interface ProjectSources {
  // `id` is the project id: managed repos live in <workspace>/<id>.
  link(input: { path: string }): Promise<Provisioned>;
  clone(input: { id: string; repoUrl: string }): Promise<Provisioned>;
  scratch(input: { id: string; name: string; description?: string; github?: { visibility: 'private' | 'public' } }): Promise<Provisioned>;
}

// A remote we accept to clone: https or scp-style ssh. Never anything that could be read as a git option.
export const REPO_URL = /^(https:\/\/|git@)[^\s]+$/;

export const repoNameFromUrl = (url: string) => basename(url.replace(/\.git$/, '').replace(/\/+$/, '')).split(':').pop() ?? 'project';

async function originOf(path: string): Promise<string> {
  const r = await run('git', ['-C', path, 'remote', 'get-url', 'origin'], { cwd: path });
  return r.code === 0 ? r.out.trim() : '';
}

export function createSources(workspaceDir: string): ProjectSources {
  const dest = (id: string) => {
    const d = join(workspaceDir, id);
    if (existsSync(d)) throw new Error(`${d} already exists`);
    mkdirSync(workspaceDir, { recursive: true });
    return d;
  };

  return {
    // An existing checkout on this machine, used in place.
    async link({ path: input }) {
      const path = resolve(input.startsWith('~') ? homedir() + input.slice(1) : input);
      if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error(`not a directory: ${path}`);
      if ((await run('git', ['-C', path, 'rev-parse', '--git-dir'], { cwd: path })).code !== 0) throw new Error(`not a git repository: ${path}`);
      return { path, repoUrl: await originOf(path) };
    },

    // An existing repository by URL: cloned into the workspace, which Ripple_handoff then owns.
    async clone({ id, repoUrl }) {
      const path = dest(id);
      // GIT_TERMINAL_PROMPT=0: fail fast instead of waiting for a password nobody can type.
      const r = await run('git', ['clone', '--quiet', '--', repoUrl, path], { cwd: workspaceDir, timeoutMs: 5 * 60_000, env: { GIT_TERMINAL_PROMPT: '0' } });
      if (r.code !== 0) {
        rmSync(path, { recursive: true, force: true });
        throw new Error(`clone failed: ${r.out.trim().slice(0, 300)}`);
      }
      return { path, repoUrl };
    },

    // A new repository: git init plus a first commit. Publishing it to GitHub only happens when asked for.
    async scratch({ id, name, description, github }) {
      const path = dest(id);
      try {
        mkdirSync(path);
        await git(path, 'init', '-q', '-b', 'main');
        writeFileSync(join(path, 'README.md'), `# ${name}\n${description ? `\n${description}\n` : ''}`);
        writeFileSync(join(path, '.gitignore'), 'node_modules/\ndist/\n.env\n');
        await git(path, 'add', '-A');
        await git(path, '-c', 'user.name=Ripple_handoff', '-c', 'user.email=ripple@localhost', 'commit', '-q', '-m', 'Initial commit');
        if (github) {
          const r = await run('gh', ['repo', 'create', id, `--${github.visibility}`, '--source', '.', '--remote', 'origin', '--push'], { cwd: path, timeoutMs: 60_000 });
          if (r.code !== 0) throw new Error(`GitHub repository creation failed: ${r.out.trim().slice(0, 300)}`);
        }
        return { path, repoUrl: await originOf(path) };
      } catch (e) {
        rmSync(path, { recursive: true, force: true }); // we created it a moment ago: leave nothing half-made
        throw e;
      }
    },
  };
}
