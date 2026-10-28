import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { Runtime } from './runtime.ts';
import { MetaLLM } from './adapters/llm.ts';
import { MetaSam } from './adapters/vision.ts';
import { PlaywrightCapture } from './adapters/capture.ts';
import { SamVisualReviewer } from './visual/reviewer.ts';
import { GitBeforeShooter } from './adapters/before.ts';
import { Journal } from './journal.ts';
import { loadApiKey, loadFigmaToken } from './config.ts';
import { FigmaClient } from './adapters/figma.ts';
import { MuseCodeBuilder } from './adapters/builder.ts';
import { GitIntegrator } from './adapters/integrator.ts';
import { ProjectStore } from './projects.ts';
import { AutoFixStore } from './recovery.ts';
import { createSources } from './project-sources.ts';
import { ContentService } from './content/service.ts';
import { ContentStore } from './content/store.ts';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const key = loadApiKey();
if (!key) {
  console.error('No API key. Put MODEL_API_KEY="..." in .env at the repo root.');
  process.exit(1);
}

const root = resolve(import.meta.dirname, '../../..');
const projects = new ProjectStore(process.env.PROJECTS_PATH ?? resolve(root, 'out/projects.db'));

// First start: register the demo app if it sits next to this repo.
const demo = resolve(root, '../mealkinator');
if (projects.list().length === 0 && existsSync(resolve(demo, '.git'))) {
  let repoUrl = 'https://github.com/Quentintnrl/mealkinator';
  try { repoUrl = execFileSync('git', ['-C', demo, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim(); } catch { /* keep default */ }
  projects.add({ name: 'Mealkinator', path: demo, repoUrl, source: 'link' });
}

const worktreesDir = resolve(root, 'out/worktrees');
const builder = new MuseCodeBuilder({ worktreesDir, apiKey: key });
const integrator = new GitIntegrator(worktreesDir);
const journal = new Journal(process.env.JOURNAL_PATH ?? resolve(root, 'out/journal.db'));
const llm = new MetaLLM(key);
const visualDir = resolve(root, 'out/visual');
const capture = new PlaywrightCapture();
const reviewer = new SamVisualReviewer({ llm, vision: new MetaSam(key), capture });
const beforeShooter = new GitBeforeShooter({ capture, worktreesDir });
const runtime = new Runtime({ llm, journal, builder, integrator, reviewer, beforeShooter, visualDir, projects, autoFix: new AutoFixStore(resolve(root, 'out/autofix.json')) });
// Content: roadmap, calendar and the AI that helps write around it. Features come from the runtime, so merges feed it.
const content = new ContentService({
  store: new ContentStore(process.env.CONTENT_PATH ?? resolve(root, 'out/content.db')),
  llm,
  exportDir: resolve(root, 'out/content'),
  repoPath: id => projects.get(id)?.path,
  features: id => {
    const f = runtime.get(id);
    return f && { projectId: f.projectId, title: f.title, state: f.state, summary: f.plan?.summary, stat: f.build?.stat };
  },
});
runtime.subscribe(e => {
  if (e.type === 'STATE' && (e.payload as { state?: string }).state === 'APPLIED') void content.onFeatureApplied(e.featureId).catch(err => console.error('content:', err));
});
setInterval(() => void content.tick().catch(err => console.error('content tick:', err)), 15 * 60_000);
void content.tick().catch(() => {});
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: createApp(runtime, projects, createSources(resolve(root, 'out/projects')), { visualDir, figma: new FigmaClient(loadFigmaToken), content }).fetch, port }, () => console.log(`orchestrator on http://localhost:${port}`));
