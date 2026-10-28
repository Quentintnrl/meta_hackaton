import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.ts';
import { ProjectStore } from './projects.ts';
import { createSources } from './project-sources.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from './runtime.ts';
import type { LLM } from './adapters/llm.ts';
import type { Plan } from './planner.ts';

const plan: Plan = {
  summary: 'Add a shopping list drawer',
  needsInput: false,
  reason: '',
  steps: [{ title: 'Drawer', detail: 'Slide-in panel' }],
  options: [{ question: 'State', choices: ['local', 'server'], recommended: 'local' }],
};
const fakeLLM: LLM = { json: async (_p, schema) => schema.parse(plan) };

const visualDir = mkdtempSync(join(tmpdir(), 'ripple-visual-'));
const sources = () => createSources(mkdtempSync(join(tmpdir(), 'ripple-ws-')));
const repoHere = import.meta.dirname; // inside this git repository
const store = () => { const s = new ProjectStore(); s.add({ name: 'App', path: repoHere, repoUrl: 'https://github.com/x/app', source: 'link' }); return s; };
const mk = (o: Partial<ConstructorParameters<typeof Runtime>[0]> = {}, projects = store()) => ({ projects, rt: new Runtime({ llm: fakeLLM, projects, ...o }) });
const feature = (id = 'f1', extra = {}) => ({ id, title: 'Shopping list', design: 'new drawer', ...extra });

const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const settle = () => new Promise(r => setTimeout(r, 20));

test('create -> plan -> approve moves the feature to BUILDING', async () => {
  const { rt, projects } = mk();
  const app = createApp(rt, projects, sources(), { visualDir });
  assert.equal((await post(app, '/projects/app/features', feature())).status, 201);
  await settle();
  let f = await (await app.request('/features/f1')).json();
  assert.equal(f.state, 'PLANNED');
  assert.equal(f.plan.summary, plan.summary);
  await post(app, '/features/f1/approve', { gate: 'plan' });
  f = await (await app.request('/features/f1')).json();
  assert.equal(f.state, 'BUILDING');
  assert.ok(f.events.some((e: { type: string }) => e.type === 'PLAN'));
});

test('rejects bad input and duplicate ids', async () => {
  const { rt, projects } = mk();
  const app = createApp(rt, projects, sources(), { visualDir });
  assert.equal((await post(app, '/projects/app/features', { id: 'x' })).status, 400);
  assert.equal((await post(app, '/projects/nope/features', feature())).status, 404);
  await post(app, '/projects/app/features', feature());
  assert.equal((await post(app, '/projects/app/features', feature())).status, 409);
  assert.equal((await app.request('/features/nope')).status, 404);
});

test('a failing planner is journaled, not thrown', async () => {
  const { rt } = mk({ llm: { json: async () => { throw new Error('boom'); } } });
  rt.create('f1', { title: 't', design: 'd', projectId: 'app' });
  await settle();
  assert.equal(rt.get('f1')!.state, 'DESIGN_DEFINED');
  assert.ok(rt.journal.list('f1').some(e => e.type === 'ERROR'));
});

test('plan approval triggers the builder, then the feature waits for the visual check', async () => {
  const seen: string[] = [];
  const repos: string[] = [];
  const builder = { build: async (r: { featureId: string; prompt: string; repoPath: string }) => { seen.push(r.prompt); repos.push(r.repoPath); return { branch: 'feature/f1', stat: '1 file', diff: '+x' }; } };
  const { rt, projects } = mk({ builder });
  const app = createApp(rt, projects, sources(), { visualDir });
  await post(app, '/projects/app/features', feature());
  await settle();
  await post(app, '/features/f1/approve', { gate: 'plan' });
  await settle();
  const f = await (await app.request('/features/f1')).json();
  assert.equal(f.state, 'VISUAL_CHECK');
  assert.equal(f.build.branch, 'feature/f1');
  assert.match(seen[0], /Add a shopping list drawer|Drawer/);
  assert.match(seen[0], /State -> local/);
  assert.equal(repos[0], repoHere);
  await post(app, '/features/f1/events', { type: 'VISUAL_OK' });
  assert.equal(rt.get('f1')!.state, 'PR_READY');
});

test('features are rebuilt from the journal after a restart, and interrupted builds resume', async () => {
  const { Journal } = await import('./journal.ts');
  const journal = new Journal();
  const projects = store();
  const first = new Runtime({ llm: fakeLLM, journal, projects });
  first.create('f1', { title: 'Shopping list', design: 'drawer', projectId: 'app' });
  await settle();
  first.send('f1', { type: 'APPROVE', gate: 'plan' }); // no builder: stays BUILDING

  let built = 0;
  const builder = { build: async () => { built++; return { branch: 'feature/f1', stat: 's', diff: '+x' }; } };
  const second = new Runtime({ llm: fakeLLM, journal, builder, projects });
  assert.equal(second.get('f1')!.title, 'Shopping list');
  assert.equal(second.get('f1')!.plan?.summary, plan.summary);
  await settle();
  assert.equal(built, 1);
  assert.equal(second.get('f1')!.state, 'VISUAL_CHECK');
});

test('visual feedback goes back to the builder prompt', async () => {
  const prompts: string[] = [];
  const builder = { build: async (r: { prompt: string }) => { prompts.push(r.prompt); return { branch: 'b', stat: 's', diff: 'd' }; } };
  const { rt } = mk({ builder });
  rt.create('f1', { title: 't', design: 'd', projectId: 'app' });
  await settle();
  rt.send('f1', { type: 'APPROVE', gate: 'plan' });
  await settle();
  rt.send('f1', { type: 'VISUAL_DIFF', feedback: 'the drawer is too narrow' });
  await settle();
  assert.match(prompts[1], /too narrow/);
});

test('projects: validated, unique by path, protected while they have features', async () => {
  const { rt, projects } = mk({}, new ProjectStore());
  const app = createApp(rt, projects, sources(), { visualDir });
  const body = { source: 'link', name: 'Mealkinator', path: repoHere };
  const created = await post(app, '/projects', body);
  assert.equal(created.status, 201);
  assert.equal((await created.json()).id, 'mealkinator');
  assert.equal((await post(app, '/projects', body)).status, 409); // same path
  assert.equal((await post(app, '/projects', { ...body, path: '/definitely/not/here' })).status, 400);
  assert.equal((await post(app, '/projects', { ...body, path: '/tmp', name: 'Tmp' })).status, 400); // not a git repo
  await post(app, '/projects/mealkinator/features', feature());
  assert.equal((await app.request('/projects/mealkinator', { method: 'DELETE' })).status, 409);
  assert.equal((await app.request('/projects/ghost', { method: 'DELETE' })).status, 404);
});

test('a project lists only its own features', async () => {
  const projects = store();
  projects.add({ name: 'Other', path: '/tmp', repoUrl: 'https://github.com/x/other', source: 'link' });
  const { rt } = mk({}, projects);
  const app = createApp(rt, projects, sources(), { visualDir });
  await post(app, '/projects/app/features', feature('a'));
  await post(app, '/projects/other/features', feature('b'));
  const ids = async (p: string) => (await (await app.request(`/projects/${p}/features`)).json()).map((f: { id: string }) => f.id);
  assert.deepEqual(await ids('app'), ['a']);
  assert.deepEqual(await ids('other'), ['b']);
});

test('create a project from scratch: a local git repo with a first commit, no GitHub unless asked', async () => {
  const { rt, projects } = mk({}, new ProjectStore());
  const app = createApp(rt, projects, sources(), { visualDir });
  const res = await post(app, '/projects', { source: 'scratch', name: 'Fresh App', description: 'A tiny app' });
  assert.equal(res.status, 201);
  const p = await res.json();
  assert.equal(p.id, 'fresh-app');
  assert.equal(p.source, 'scratch');
  assert.equal(p.repoUrl, ''); // local only
  const { execFileSync } = await import('node:child_process');
  assert.match(execFileSync('git', ['-C', p.path, 'log', '--oneline'], { encoding: 'utf8' }), /Initial commit/);
  assert.match((await import('node:fs')).readFileSync(join(p.path, 'README.md'), 'utf8'), /A tiny app/);
  // a second project with the same name gets its own id and folder
  assert.equal((await (await post(app, '/projects', { source: 'scratch', name: 'Fresh App' })).json()).id, 'fresh-app-2');
});

test('clone: only https and ssh URLs are accepted, and a failing clone leaves nothing behind', async () => {
  const { rt, projects } = mk({}, new ProjectStore());
  const ws = mkdtempSync(join(tmpdir(), 'ripple-ws-'));
  const app = createApp(rt, projects, createSources(ws), { visualDir });
  for (const repoUrl of ['--upload-pack=evil', 'file:///etc', 'ext::sh -c id', '/home/x/repo']) {
    assert.equal((await post(app, '/projects', { source: 'clone', repoUrl })).status, 400, repoUrl);
  }
  const bad = await post(app, '/projects', { source: 'clone', repoUrl: 'https://127.0.0.1:9/none/none.git' });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /clone failed/);
  assert.deepEqual((await import('node:fs')).readdirSync(ws), []);
  assert.equal(projects.list().length, 0);
});

test('clone source clones a repository into the workspace', async () => {
  const { execFileSync } = await import('node:child_process');
  const { writeFileSync, existsSync } = await import('node:fs');
  const origin = mkdtempSync(join(tmpdir(), 'ripple-origin-'));
  execFileSync('git', ['init', '-q', '-b', 'main', origin]);
  writeFileSync(join(origin, 'a.txt'), 'x');
  execFileSync('git', ['-C', origin, 'add', '-A']);
  execFileSync('git', ['-C', origin, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init']);
  const ws = mkdtempSync(join(tmpdir(), 'ripple-ws-'));
  const r = await createSources(ws).clone({ id: 'cloned', repoUrl: origin });
  assert.equal(r.path, join(ws, 'cloned'));
  assert.ok(existsSync(join(r.path, 'a.txt')));
});

test('merge gate: approval runs the integrator, push only if asked; a failure waits for a retry', async () => {
  const calls: Array<{ push: boolean }> = [];
  let fail = true;
  const integrator = { apply: async (r: { push: boolean }) => { calls.push({ push: r.push }); if (fail) throw new Error('repo is on develop'); return { commit: 'abc', pushed: r.push }; } };
  const builder = { build: async () => ({ branch: 'feature/f1', stat: 's', diff: 'd' }) };
  const projects = store(); // repoUrl set -> push allowed
  const { rt } = mk({ builder, integrator }, projects);
  const app = createApp(rt, projects, sources(), { visualDir });
  await post(app, '/projects/app/features', feature());
  await settle();
  await post(app, '/features/f1/approve', { gate: 'plan' });
  await settle();
  await post(app, '/features/f1/events', { type: 'VISUAL_OK' });
  await post(app, '/features/f1/approve', { gate: 'merge', push: true });
  await settle();
  assert.equal(rt.get('f1')!.state, 'MERGE_FAILED');
  assert.ok(rt.journal.list('f1').some(e => e.type === 'ERROR' && /develop/.test(String((e.payload as { message: string }).message))));
  fail = false;
  await post(app, '/features/f1/approve', { gate: 'merge' }); // retry without push
  await settle();
  assert.equal(rt.get('f1')!.state, 'APPLIED');
  assert.deepEqual(calls, [{ push: true }, { push: false }]);
  assert.equal(rt.get('f1')!.merge?.commit, 'abc');
});

test('no push for a project without a remote even if asked', async () => {
  const calls: boolean[] = [];
  const integrator = { apply: async (r: { push: boolean }) => { calls.push(r.push); return { commit: 'c', pushed: false }; } };
  const projects = new ProjectStore();
  projects.add({ name: 'App', path: repoHere, repoUrl: '', source: 'scratch' });
  const { rt } = mk({ builder: { build: async () => ({ branch: 'b', stat: 's', diff: 'd' }) }, integrator }, projects);
  rt.create('f1', { title: 't', design: 'd', projectId: 'app' });
  await settle();
  rt.send('f1', { type: 'APPROVE', gate: 'plan' });
  await settle();
  rt.send('f1', { type: 'VISUAL_OK' });
  rt.send('f1', { type: 'APPROVE', gate: 'merge', push: true });
  await settle();
  assert.deepEqual(calls, [false]);
});

import { png } from './visual/visual.test.ts';
import type { VisualReport } from './visual/types.ts';

const report = (verdict: VisualReport['verdict']): VisualReport => ({ verdict, feedback: 'the drawer is missing', elements: [], mockupFile: 'mockup.png', appFile: 'app.png', at: '' });
const figmaLink = 'https://www.figma.com/design/abc123/Mealkinator?node-id=3-102';
const fakeFigma = (w = 1280, h = 800) => ({ fetchFrame: async () => ({ png: png(w, h), outline: 'frame "Week"\n  text "Shopping list"' }) });

async function visualFlow(level: 'low' | 'medium' | 'high', verdict: VisualReport['verdict']) {
  const builds: string[] = [];
  const builder = { build: async (r: { prompt: string }) => { builds.push(r.prompt); return { branch: 'b', worktree: '/tmp/wt', stat: 's', diff: 'd' }; } };
  const reviewer = { review: async () => report(verdict) };
  const projects = store();
  const { rt } = mk({ builder, reviewer, visualDir }, projects);
  const app = createApp(rt, projects, sources(), { visualDir, figma: fakeFigma() });
  const res = await post(app, '/projects/app/features', { ...feature(), figma: figmaLink, autonomy: { visual: level } });
  assert.equal(res.status, 201);
  await settle();
  await post(app, '/features/f1/approve', { gate: 'plan' });
  await new Promise(r => setTimeout(r, 60));
  return { rt, app, builds };
}

test('visual autonomy: low waits for the user whatever the verdict', async () => {
  const { rt } = await visualFlow('low', 'pass');
  assert.equal(rt.get('f1')!.state, 'VISUAL_CHECK');
  assert.equal(rt.get('f1')!.visual?.verdict, 'pass');
});

test('visual autonomy: medium accepts a pass by itself but asks on a difference', async () => {
  assert.equal((await visualFlow('medium', 'pass')).rt.get('f1')!.state, 'PR_READY');
  assert.equal((await visualFlow('medium', 'fail')).rt.get('f1')!.state, 'VISUAL_CHECK');
});

test('visual autonomy: high sends a difference back to the builder with the feedback', async () => {
  const { builds } = await visualFlow('high', 'fail');
  assert.ok(builds.length >= 2);
  assert.match(builds[1], /the drawer is missing/);
});

test('without a mockup the visual check is skipped and left to the user', async () => {
  let reviews = 0;
  const projects = store();
  const { rt } = mk({ builder: { build: async () => ({ branch: 'b', worktree: '/tmp/wt', stat: 's', diff: 'd' }) }, reviewer: { review: async () => { reviews++; return report('pass'); } } }, projects);
  rt.create('f1', { title: 't', design: 'd', projectId: 'app' });
  await settle();
  rt.send('f1', { type: 'APPROVE', gate: 'plan' });
  await settle();
  assert.equal(reviews, 0);
  assert.equal(rt.get('f1')!.state, 'VISUAL_CHECK');
  assert.ok(rt.journal.list('f1').some(e => e.type === 'VISUAL_SKIPPED'));
});

test('a Figma link gives the mockup image and the frame outline; errors are explained', async () => {
  const projects = store();
  const { rt } = mk({}, projects);
  const noToken = createApp(rt, projects, sources(), { visualDir });
  const r0 = await post(noToken, '/projects/app/features', { id: 'a', title: 't', figma: figmaLink });
  assert.equal(r0.status, 400);
  assert.match((await r0.json()).error, /FIGMA_TOKEN/);

  const app = createApp(rt, projects, sources(), { visualDir, figma: fakeFigma() });
  assert.equal((await post(app, '/projects/app/features', { id: 'b', title: 't' })).status, 400); // neither notes nor a frame
  const tiny = createApp(rt, projects, sources(), { visualDir, figma: fakeFigma(50, 50) });
  assert.equal((await post(tiny, '/projects/app/features', { id: 'c', title: 't', figma: figmaLink })).status, 400);
  const broken = createApp(rt, projects, sources(), { visualDir, figma: { fetchFrame: async () => { throw new Error('Figma could not find this file'); } } });
  assert.match((await (await post(broken, '/projects/app/features', { id: 'd', title: 't', figma: figmaLink })).json()).error, /could not find/);

  assert.equal((await post(app, '/projects/app/features', { id: 'm1', title: 't', figma: figmaLink })).status, 201);
  assert.match(rt.get('m1')!.design, /text "Shopping list"/); // the planner sees the frame's content
  assert.equal(rt.get('m1')!.figma, figmaLink);
  const img = await app.request('/features/m1/visual/mockup.png');
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await app.request('/features/m1/visual/report.json')).status, 404); // only the images
  assert.equal((await app.request('/features/m1/visual/..%2F..%2Fetc')).status, 404);
  assert.equal((await post(app, '/features/m1/visual/run', {})).status, 409); // not at the visual check
});

test('medium autonomy: the plan goes ahead only when the planner sees nothing ambiguous', async () => {
  const run = async (needsInput: boolean) => {
    const llm = { json: async (_p: string, schema: { parse: (v: unknown) => unknown }) => schema.parse({ ...plan, needsInput, reason: needsInput ? 'a paid service is involved' : '' }) };
    const { rt } = mk({ llm: llm as never });
    rt.create('f1', { title: 't', design: 'd', projectId: 'app' }, { plan: 'medium', visual: 'low', merge: 'low', publish: 'low', teaser: 'low' });
    await settle();
    return rt.get('f1')!.state;
  };
  assert.equal(await run(false), 'BUILDING');
  assert.equal(await run(true), 'PLANNED');
});

test('medium autonomy: the merge goes ahead only after a passing visual check, and never pushes', async () => {
  const calls: boolean[] = [];
  const integrator = { apply: async (r: { push: boolean }) => { calls.push(r.push); return { commit: 'c', pushed: false }; } };
  const flow = async (verdict: VisualReport['verdict']) => {
    const projects = store();
    const { rt } = mk({ builder: { build: async () => ({ branch: 'b', worktree: '/tmp/wt', stat: 's', diff: 'd' }) }, reviewer: { review: async () => report(verdict) }, integrator }, projects);
    const app = createApp(rt, projects, sources(), { visualDir, figma: fakeFigma() });
    await post(app, '/projects/app/features', { ...feature(), figma: figmaLink, autonomy: { visual: 'high', merge: 'medium' } });
    await settle();
    await post(app, '/features/f1/approve', { gate: 'plan' });
    await new Promise(r => setTimeout(r, 80));
    return rt.get('f1')!.state;
  };
  assert.equal(await flow('pass'), 'APPLIED');
  assert.deepEqual(calls, [false]);
  assert.notEqual(await flow('inconclusive'), 'APPLIED');
});

test('the journal can be read in pieces, for clients that poll', async () => {
  const { rt, projects } = mk();
  const app = createApp(rt, projects, sources(), { visualDir });
  await post(app, '/projects/app/features', feature());
  await settle();
  const all = await (await app.request('/journal')).json();
  assert.ok(all.length >= 4);
  const rest = await (await app.request(`/journal?after=${all[1].id}`)).json();
  assert.deepEqual(rest.map((e: { id: number }) => e.id), all.slice(2).map((e: { id: number }) => e.id));
  assert.deepEqual(await (await app.request(`/journal?after=${all.at(-1).id}`)).json(), []);
  assert.equal((await app.request('/journal?after=junk')).status, 200);
});

test('Figma preview: shows what a link points at without storing anything', async () => {
  const { rt, projects } = mk();
  const app = createApp(rt, projects, sources(), { visualDir, figma: fakeFigma() });
  const ok = await app.request(`/figma/preview?url=${encodeURIComponent(figmaLink)}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/png');
  assert.equal((await app.request('/figma/preview?url=https%3A%2F%2Fexample.com')).status, 400);
  assert.equal((await app.request('/figma/preview')).status, 400);
  const noToken = createApp(rt, projects, sources(), { visualDir });
  assert.match((await (await noToken.request(`/figma/preview?url=${encodeURIComponent(figmaLink)}`)).json()).error, /FIGMA_TOKEN/);
});

test('the "before" shot is taken once, as soon as the feature exists; its failure does not stop the build', async () => {
  const shots: Array<{ width: number; height: number }> = [];
  const beforeShooter = { shoot: async (r: { viewport: { width: number; height: number } }) => { shots.push(r.viewport); } };
  const builder = { build: async () => ({ branch: 'b', worktree: '/tmp/wt', stat: 's', diff: 'd' }) };
  const projects = store();
  const { rt } = mk({ builder, beforeShooter }, projects);
  const app = createApp(rt, projects, sources(), { visualDir, figma: fakeFigma(1000, 700) });
  await post(app, '/projects/app/features', { ...feature(), figma: figmaLink });
  await settle();
  assert.deepEqual(shots, [{ width: 1000, height: 700 }]); // the design's size
  assert.equal(rt.get('f1')!.before, 'before.png'); // already there while the plan waits for the user
  assert.equal(rt.get('f1')!.state, 'PLANNED');
  await post(app, '/features/f1/approve', { gate: 'plan' });
  await settle();
  rt.send('f1', { type: 'VISUAL_DIFF', feedback: 'x' }); // back to BUILDING
  await settle();
  assert.equal(shots.length, 1); // not shot again

  const failing = mk({ builder, beforeShooter: { shoot: async () => { throw new Error('no dev script'); } } });
  failing.rt.create('f2', { title: 't', design: 'd', projectId: 'app' });
  await settle();
  assert.equal(failing.rt.get('f2')!.before, undefined);
  failing.rt.send('f2', { type: 'APPROVE', gate: 'plan' });
  await settle();
  assert.equal(failing.rt.get('f2')!.state, 'VISUAL_CHECK'); // built anyway
  assert.ok(failing.rt.journal.list('f2').some(e => e.type === 'ERROR' && /no dev script/.test(String((e.payload as { message: string }).message))));
});
