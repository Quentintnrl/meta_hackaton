// Fills out/demo/ with a fictional project in the middle of its life, to try the studio without any model call.
//   node scripts/seed-demo.ts      (or: pnpm dev:demo, which also starts the app on it)
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { Journal } from '../packages/orchestrator/src/journal.ts';
import { ProjectStore } from '../packages/orchestrator/src/projects.ts';
import { ContentStore } from '../packages/orchestrator/src/content/store.ts';
import { seedDemo } from '../packages/orchestrator/src/demo/seed.ts';

const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'out/demo');
rmSync(dir, { recursive: true, force: true }); // always a fresh, identical dataset
seedDemo({
  journal: new Journal(resolve(dir, 'journal.db')),
  projects: new ProjectStore(resolve(dir, 'projects.db')),
  content: new ContentStore(resolve(dir, 'content.db')),
  mediaDir: resolve(dir, 'content/media'),
  repoPath: root,
});
console.log('Demo data written to out/demo/. Start it with: pnpm dev:demo');
