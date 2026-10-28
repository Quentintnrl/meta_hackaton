import { spawn } from 'node:child_process';

// The environment handed to child programs. The orchestrator itself is started by pnpm, which leaks its own
// settings into everything below it (npm_config_*, pnpm_config_*, PNPM_*, INIT_CWD). A nested `pnpm run dev` of the
// app under work would then obey the orchestrator's workspace and filters instead of its own project.
export function cleanEnv(extra: Record<string, string> = {}, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || /^(npm_|pnpm_)/i.test(k) || k === 'INIT_CWD') continue;
    out[k] = v;
  }
  return { ...out, ...extra };
}

export interface RunResult {
  code: number;
  out: string;
}

// Runs a program with an argument array (never through a shell). Output is stdout+stderr.
export function run(cmd: string, args: string[], opts: { cwd: string; stdin?: string; timeoutMs?: number; env?: Record<string, string> }): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'], env: cleanEnv(opts.env) });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs) : null;
    child.on('error', reject);
    child.on('close', code => { if (timer) clearTimeout(timer); resolve({ code: code ?? -1, out }); });
    child.stdin.on('error', () => {}); // the process may exit before reading its stdin (EPIPE): its exit code tells the story
    child.stdin.end(opts.stdin ?? '');
  });
}

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const r = await run('git', args, { cwd });
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.out.trim().slice(0, 300)}`);
  return r.out;
}
