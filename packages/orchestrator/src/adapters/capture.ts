import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { cleanEnv, run } from '../exec.ts';
import type { CaptureAction } from '../visual/capture-plan.ts';

export interface CaptureRequest {
  worktree: string;
  viewport: { width: number; height: number };
  // Given the visible buttons and links of the home page, returns what to do to reach the screen under review.
  chooseActions: (labels: string[]) => Promise<CaptureAction[]>;
}

// Runs the app of a worktree and screenshots the screen under review (PNG).
export interface Capture {
  capture(req: CaptureRequest): Promise<Buffer>;
}

const freePort = () => new Promise<number>((resolve, reject) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)); });
  s.on('error', reject);
});

function packageManager(dir: string): 'pnpm' | 'yarn' | 'npm' {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

async function waitFor(url: string, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error(`the app did not answer on ${url} within ${ms / 1000}s`);
}

async function perform(page: Page, base: string, a: CaptureAction) {
  if (a.do === 'wait') await page.waitForTimeout(a.ms);
  else if (a.do === 'goto') await page.goto(base + a.path);
  else {
    const t = a.text;
    await page.getByRole('button', { name: t }).or(page.getByRole('link', { name: t })).or(page.getByText(t)).first().click({ timeout: 5000 });
  }
  await page.waitForTimeout(600); // transitions
}

// Convention: a `dev` script that starts a dev server accepting --host/--port (Vite and most others do).
export class PlaywrightCapture implements Capture {
  async capture({ worktree, viewport, chooseActions }: CaptureRequest): Promise<Buffer> {
    const pm = packageManager(worktree);
    if (!existsSync(join(worktree, 'node_modules'))) {
      // pnpm exits with an error when a dependency has a build script nobody approved. Those scripts stay unapproved
      // (never run), but the install must not fail: Vite and friends ship their binaries as separate packages.
      const r = await run(pm, pm === 'pnpm' ? ['install', '--config.strict-dep-builds=false'] : ['install'], { cwd: worktree, timeoutMs: 5 * 60_000 });
      if (r.code !== 0) throw new Error(`${pm} install failed: ${r.out.slice(-300)}`);
    }

    const port = await freePort();
    const flags = ['--host', '127.0.0.1', '--port', String(port), '--strictPort'];
    const args = pm === 'npm' ? ['run', 'dev', '--', ...flags] : ['run', 'dev', ...flags];
    // Own process group, so the dev server and its children can all be stopped.
    const server = spawn(pm, args, { cwd: worktree, detached: true, stdio: 'ignore', env: cleanEnv() });
    const base = `http://127.0.0.1:${port}`;
    const stop = () => { try { process.kill(-server.pid!, 'SIGTERM'); } catch { /* already gone */ } };

    try {
      await waitFor(base, 60_000);
      // The user's installed Chrome: no browser download. Falls back to Playwright's own if it was installed.
      const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ headless: true }));
      try {
        const page = await (await browser.newContext({ viewport, deviceScaleFactor: 1 })).newPage();
        await page.goto(base);
        await page.waitForLoadState('load');
        const labels = await page.locator('button, a, [role="button"]').evaluateAll(els =>
          els.map(e => (e.textContent || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ')).filter(t => t && t.length <= 80));
        for (const action of await chooseActions([...new Set(labels)])) await perform(page, base, action);
        return await page.screenshot({ type: 'png' });
      } finally {
        await browser.close();
      }
    } finally {
      stop();
    }
  }
}
