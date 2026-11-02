import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calibration, project } from './forecast.ts';
import { ContentService, type FeatureLookup } from './service.ts';
import { ContentStore } from './store.ts';
import { createApp } from '../app.ts';
import { ProjectStore } from '../projects.ts';
import { Runtime } from '../runtime.ts';
import { createSources } from '../project-sources.ts';
import type { LLM } from '../adapters/llm.ts';
import type { Publisher } from '@ripple/shared';
import type { Forecast } from './types.ts';
import { parseAccountCsv } from './service.ts';

const DAY = 86_400_000;
const t0 = Date.parse('2026-11-01T09:00:00Z');

// A clock the test moves, and features whose state the test sets.
function setup(opts: { llm?: LLM; publisher?: Publisher } = {}) {
  let now = t0;
  const states = new Map<string, string>();
  const features: FeatureLookup = id => states.has(id) ? { projectId: 'app', title: `Feature ${id}`, state: states.get(id)!, summary: `does ${id}` } : undefined;
  const calls: string[] = [];
  const llm: LLM = opts.llm ?? {
    json: async (prompt, schema, name) => {
      calls.push(name);
      if (name === 'content_plan') return schema.parse({ items: [
        { kind: 'teaser', title: 'Sneak peek', brief: 'tease it', offsetDays: -7 },
        { kind: 'release-notes', title: 'Release notes', brief: 'what is new', offsetDays: 0 },
      ] });
      if (name === 'post' || name === 'post_revision') return schema.parse({ caption: `caption (${name})`, hashtags: ['#Meal Prep', 'mealprep', 'cooking'], format: 'carousel', slides: [
        { kind: 'image', visual: 'a plate, flat lay', text: 'Plan', seconds: 0 }, { kind: 'image', visual: 'a calendar', text: 'Shop', seconds: 0 } ] });
      if (name === 'forecast_note') return schema.parse({ note: 'moved because of pace' });
      return schema.parse({ draft: `draft for: ${prompt.slice(0, 20)}` });
    },
  };
  const exportDir = mkdtempSync(join(tmpdir(), 'ripple-content-'));
  const svc = new ContentService({ llm, features, exportDir, repoPath: () => '/repo', now: () => new Date(now), git: async () => ['abc123 add drawer', 'def456 fix typo'], publisher: opts.publisher });
  return { svc, states, calls, exportDir, advance: (days: number) => { now += days * DAY; } };
}
const ms = (over = {}) => ({ projectId: 'app', title: 'v1', intent: 'ship the drawer', targetDate: '2026-11-21', scope: 4, ...over });

test('with nothing delivered, the forecast starts at the user\'s own target', () => {
  const p = project({ startDate: '2026-11-01', targetDate: '2026-11-21', scope: 4 }, 0, new Date(t0), { factor: 1, samples: 0 });
  assert.equal(p.predictedDate, '2026-11-21');
  assert.equal(p.confidence, 'low');
  assert.equal(p.pace, 'planned');
});

test('delivering slower than planned pushes the forecast out', () => {
  // 1 of 4 done after 10 days: 10 days per feature, 3 left = 30 days from the 11th, against a plan landing on the 21st
  const p = project({ startDate: '2026-11-01', targetDate: '2026-11-21', scope: 4 }, 1, new Date(t0 + 10 * DAY), { factor: 1, samples: 0 });
  assert.equal(p.predictedDate, '2026-12-11');
  assert.equal(p.pace, 'observed');
});

const forecast = (madeAt: string, raw: number): Forecast => ({ id: 1, milestoneId: 'm', madeAt, predictedDate: '', rawRemainingDays: raw, calibration: 1, done: 0, scope: 1, confidence: 'low', note: '' });

test('calibration learns from milestones that landed late, and is bounded', () => {
  // the raw projection said 10 days left, it took 15: x1.5
  const late = calibration([{ doneAt: '2026-11-16T00:00:00Z', forecasts: [forecast('2026-11-01T00:00:00Z', 10)] }]);
  assert.ok(Math.abs(late.factor - 1.5) < 0.01);
  assert.equal(late.samples, 1);
  const wild = calibration([{ doneAt: '2027-11-01T00:00:00Z', forecasts: [forecast('2026-11-01T00:00:00Z', 1)] }]);
  assert.equal(wild.factor, 2.5);
  assert.deepEqual(calibration([]), { factor: 1, samples: 0 });
});

test('a milestone gets a first forecast, and a merge re-projects it with a note', async () => {
  const { svc, states, advance } = setup();
  states.set('a', 'BUILDING');
  const m = await svc.createMilestone(ms());
  assert.equal(m.forecast?.predictedDate, '2026-11-21');
  await svc.link(m.id, 'a');
  advance(10);
  states.set('a', 'APPLIED');
  await svc.onFeatureApplied('a');
  const after = svc.milestone(m.id)!;
  assert.equal(after.delivered, 1);
  assert.equal(after.forecast!.predictedDate, '2026-12-11');
  assert.equal(after.forecast!.note, 'moved because of pace');
  assert.equal(after.atRisk, true);
  assert.equal(after.slipDays, 20);
  assert.ok(svc.store.forecasts(m.id).length >= 2, 'forecasts are kept, not overwritten');
});

test('a forecast that says nothing new is not recorded', async () => {
  const { svc } = setup();
  const m = await svc.createMilestone(ms());
  const n = svc.store.forecasts(m.id).length;
  await svc.reforecast(m.id, 'again');
  assert.equal(svc.store.forecasts(m.id).length, n);
});

test('if the model fails to explain, the forecast still records with a template note', async () => {
  const { svc } = setup({ llm: { json: async () => { throw new Error('down'); } } });
  const m = await svc.createMilestone(ms());
  assert.match(m.forecast!.note, /projected 2026-11-21/);
});

test('the AI learns from a finished milestone: the next one is corrected', async () => {
  const { svc, states, advance } = setup();
  states.set('a', 'BUILDING');
  const first = await svc.createMilestone(ms({ title: 'first', scope: 1, targetDate: '2026-11-11' }));
  await svc.link(first.id, 'a');
  advance(20); // twice as long as planned
  states.set('a', 'APPLIED');
  await svc.onFeatureApplied('a');
  assert.equal(svc.milestone(first.id)!.status, 'done');
  const second = await svc.createMilestone(ms({ title: 'second', scope: 1, targetDate: '2026-12-11' }));
  assert.ok(second.forecast!.calibration > 1.5, `calibration ${second.forecast!.calibration}`);
  assert.ok(second.forecast!.predictedDate > '2026-12-11', 'planned 10 days, corrected beyond the user\'s own date');
});

test('content follows the forecast: when the milestone slips, its items move', async () => {
  const { svc, states, advance } = setup();
  states.set('a', 'BUILDING');
  const m = await svc.createMilestone(ms());
  await svc.link(m.id, 'a');
  const items = await svc.planContent(m.id, 'keep it light');
  assert.equal(items.length, 2);
  assert.ok(items.every(i => i.status === 'idea' && i.origin === 'ai'));
  const before = svc.calendar('app').find(i => i.kind === 'teaser')!;
  assert.equal(before.date, '2026-11-14');
  advance(10);
  states.set('a', 'APPLIED');
  await svc.onFeatureApplied('a');
  const after = svc.calendar('app').find(i => i.kind === 'teaser')!;
  assert.equal(after.date, '2026-12-04');
  assert.equal(after.shiftDays, 20);
  assert.equal(after.plannedDate, '2026-11-14');
});

test('a locked date does not move', async () => {
  const { svc } = setup();
  const m = await svc.createMilestone(ms());
  const i = svc.addItem({ projectId: 'app', milestoneId: m.id, kind: 'social-post', title: 'Launch', brief: 'x', offsetDays: 0, fixedDate: '2026-11-30' });
  assert.equal(svc.schedule(i).date, '2026-11-30');
});

test('draft, revise, approve (writes a file), publish', async () => {
  const { svc } = setup();
  const i = svc.addItem({ projectId: 'app', kind: 'devlog', title: 'Week 1', brief: 'what I learned', fixedDate: '2026-11-05' });
  assert.equal(i.status, 'briefed');
  assert.throws(() => svc.approve(i.id), /draft it first/);
  await assert.rejects(svc.revise(i.id, 'shorter'), /draft it first/);
  const d = await svc.draft(i.id);
  assert.equal(d.status, 'drafted');
  assert.ok(d.draft);
  assert.equal((await svc.revise(i.id, 'shorter')).revisions, 2);
  await assert.rejects(svc.publish(i.id), /approve it first/);
  const a = svc.approve(i.id);
  assert.equal(a.status, 'approved');
  assert.match(readFileSync(a.exportedPath!, 'utf8'), /kind: devlog\ndate: 2026-11-05/);
  assert.equal((await svc.publish(i.id)).status, 'published');
});

test('a hostile title cannot escape the export folder', async () => {
  const { svc } = setup();
  const i = svc.addItem({ projectId: 'app', kind: 'devlog', title: '../../evil', brief: 'x', fixedDate: '2026-11-05' });
  await svc.draft(i.id);
  const a = svc.approve(i.id);
  assert.ok(!a.exportedPath!.split('/').includes('..'), 'stays inside the export folder');
  assert.match(readFileSync(a.exportedPath!, 'utf8'), /"\.\.\/\.\.\/evil"/);
});

test('reuse starts a linked new idea and keeps its series', async () => {
  const { svc } = setup();
  const s = svc.saveSeries('app', 'Beta diary');
  assert.equal(svc.saveSeries('app', 'beta DIARY').id, s.id, 'same name twice is one series');
  const i = svc.addItem({ projectId: 'app', kind: 'devlog', title: 'Week 1', brief: 'notes', fixedDate: '2026-11-05' });
  svc.setItemSeries(i.id, s.id);
  await svc.draft(i.id);
  svc.approve(i.id);
  const child = svc.reuseItem(i.id);
  assert.equal(child.status, 'idea');
  assert.equal(child.seriesId, s.id);
  assert.equal(child.draft, svc.store.item(i.id)!.draft, 'the new round starts from the same text');
  assert.deepEqual(svc.store.parentsOf(child.id).map(p => p.id), [i.id]);
  assert.equal(svc.schedule(child).reusedFrom, 'Week 1');
  assert.equal(svc.schedule(i).versionCount, 1, 'approving keeps a snapshot');
  assert.throws(() => svc.setItemSeries(i.id, 'ghost'), /unknown series in this project/);
});

test('account posts link to studio pieces and survive a re-import', () => {
  const { svc } = setup();
  const i = svc.addItem({ projectId: 'app', kind: 'devlog', title: 'Week 1', brief: 'notes' });
  svc.store.setAccount('app', [{ text: 'hello', format: 'tip', likes: 10, comments: 1, shares: 0, saves: 2, postedAt: '2026-11-01', simulated: false }]);
  const [post] = svc.store.account('app');
  svc.linkPost('app', post.id!, i.id);
  assert.equal(svc.store.account('app')[0].itemId, i.id);
  assert.throws(() => svc.linkPost('app', 9999, i.id), /unknown post/);
  assert.throws(() => svc.linkPost('other', post.id!, i.id), /unknown post|unknown piece/);
  svc.store.setAccount('app', [{ text: 'hello', format: 'tip', likes: 11, comments: 1, shares: 0, saves: 2, postedAt: '2026-11-01', simulated: false }]);
  assert.equal(svc.store.account('app')[0].itemId, i.id, 'same text re-imported keeps its link');
});

test('editing the text by hand makes it a draft that needs a new approval', async () => {
  const { svc } = setup();
  const i = svc.addItem({ projectId: 'app', kind: 'devlog', title: 'x', brief: 'y' });
  await svc.draft(i.id);
  svc.approve(i.id);
  assert.equal(svc.editItem(i.id, { draft: 'mine' }).status, 'drafted');
});

test('a merged feature starts its own changelog; autoDraft writes it', async () => {
  const { svc, states } = setup();
  states.set('a', 'APPLIED');
  svc.setProfile('app', { voice: 'warm', audience: 'cooks', language: 'English', autoDraft: true, niche: '', directives: '', publishMode: 'local' });
  const [item] = await svc.onFeatureApplied('a');
  assert.equal(item.origin, 'dev');
  assert.equal(item.status, 'drafted');
  assert.deepEqual(await svc.onFeatureApplied('a'), [], 'once per feature');
});

test('changelog from git history', async () => {
  const { svc } = setup();
  const i = await svc.fromGit('app', '2 weeks ago');
  assert.equal(i.kind, 'changelog');
  assert.equal(i.status, 'drafted');
});

test('tick drafts what is due soon, only where the project allows it, and never approves', async () => {
  const { svc, advance } = setup();
  const i = svc.addItem({ projectId: 'app', kind: 'social-post', title: 'p', brief: 'b', fixedDate: '2026-11-03' });
  assert.deepEqual(await svc.tick(), { reforecast: 0, drafted: 0 });
  svc.setProfile('app', { voice: '', audience: '', language: 'English', autoDraft: true, niche: '', directives: '', publishMode: 'local' });
  advance(0);
  assert.equal((await svc.tick()).drafted, 1);
  assert.equal(svc.store.item(i.id)!.status, 'drafted');
});

test('routes: roadmap to published, with errors mapped', async () => {
  const { svc, states } = setup();
  states.set('a', 'BUILDING');
  const projects = new ProjectStore();
  projects.add({ id: 'app', name: 'App', path: import.meta.dirname, repoUrl: '', source: 'link' });
  const app = createApp(new Runtime({ llm: { json: async () => { throw new Error('x'); } }, projects }), projects, createSources(mkdtempSync(join(tmpdir(), 'ripple-ws-'))), { visualDir: tmpdir(), content: svc });
  const send = (method: string, path: string, body?: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

  assert.equal((await send('POST', '/projects/nope/milestones', ms())).status, 404);
  assert.equal((await send('POST', '/projects/app/milestones', { title: 'x' })).status, 400);
  assert.equal((await send('POST', '/projects/app/milestones', ms({ targetDate: '2020-01-01' }))).status, 400);
  const m = await (await send('POST', '/projects/app/milestones', ms())).json();
  assert.equal(m.forecast.predictedDate, '2026-11-21');
  assert.equal((await send('POST', `/milestones/${m.id}/features`, { featureId: 'ghost' })).status, 400);
  assert.equal((await send('POST', `/milestones/${m.id}/features`, { featureId: 'a' })).status, 200);
  assert.equal((await send('POST', `/milestones/${m.id}/plan`, { guidance: 'short' })).status, 201);
  const view = await (await send('GET', '/projects/app/content')).json();
  assert.equal(view.milestones.length, 1);
  assert.equal(view.items.length, 2);
  const id = view.items[0].id;
  assert.equal((await send('POST', `/items/${id}/approve`)).status, 400);
  assert.equal((await send('POST', `/items/${id}/draft`, {})).status, 200);
  assert.equal((await send('POST', `/items/${id}/approve`)).status, 200);
  assert.equal((await send('POST', `/items/${id}/publish`)).status, 200);
  assert.equal((await send('POST', '/items/ghost/draft', {})).status, 404);
  assert.equal((await send('PUT', '/projects/app/profile', { voice: 'v', audience: 'a', language: 'French', autoDraft: true, niche: '', directives: '' })).status, 200);
  assert.equal((await send('POST', '/projects/app/content/from-git', { since: '1 week ago; rm -rf' })).status, 400);
  assert.equal((await send('DELETE', `/milestones/${m.id}`)).status, 200);
  assert.equal((await send('POST', '/content/tick')).status, 200);
});

test('a social post is a package: description, hashtags (normalised), and a series of slides', async () => {
  const { svc } = setup();
  const i = svc.addItem({ projectId: 'app', kind: 'social-post', title: 'Launch', brief: 'say it', fixedDate: '2026-11-05' });
  const d = await svc.draft(i.id);
  assert.equal(d.draft, 'caption (post)');
  assert.equal(d.media!.format, 'carousel');
  assert.equal(d.media!.slides.length, 2);
  assert.deepEqual(d.media!.hashtags, ['#MealPrep', '#cooking'], 'cleaned and deduplicated');
  // a changelog stays plain text
  const c = await svc.draft(svc.addItem({ projectId: 'app', kind: 'changelog', title: 'c', brief: 'b' }).id);
  assert.equal(c.media, undefined);
});

test('pictures are generated on request, kept while the description is unchanged, and exported with the post', async () => {
  const { svc, exportDir } = setup();
  const prompts: string[] = [];
  const svc2 = new ContentService({ llm: (svc as unknown as { llm: LLM }).llm, features: () => undefined, exportDir, repoPath: () => '/r', now: () => new Date(t0), images: { generate: async p => { prompts.push(p); return Buffer.from([0xff, 0xd8, 0xff]); } } });
  const i = svc2.addItem({ projectId: 'app', kind: 'teaser', title: 'T', brief: 'b', fixedDate: '2026-11-05' });
  await assert.rejects(svc2.generateSlide(i.id, 0), /unknown slide/, 'nothing to draw before the post is drafted');
  await svc2.draft(i.id);
  const one = await svc2.generateSlide(i.id, 0);
  assert.ok(one.media!.slides[0].file);
  assert.equal(one.media!.slides[1].file, undefined, 'only the asked slide is paid for');
  const all = await svc2.generateMissing(i.id);
  assert.equal(prompts.length, 2, 'the slide that already had a picture is not drawn again');
  assert.ok(all.media!.slides.every(s => s.file));
  assert.ok(svc2.mediaPath(i.id, all.media!.slides[0].file!));
  assert.equal(svc2.mediaPath(i.id, '../../etc/passwd'), undefined);
  // a revision that does not touch the picture's description keeps the picture
  const revised = await svc2.revise(i.id, 'punchier');
  assert.ok(revised.media!.slides.every(s => s.file));
  const a = svc2.approve(i.id);
  const text = readFileSync(a.exportedPath!, 'utf8');
  assert.match(text, /format: carousel/);
  assert.match(text, /#MealPrep #cooking/);
  assert.match(text, /!\[\]\(.*\.jpg\)/);
});

test('without an image model, asking for a picture says so', async () => {
  const { svc } = setup();
  const i = svc.addItem({ projectId: 'app', kind: 'social-post', title: 'T', brief: 'b' });
  await svc.draft(i.id);
  await assert.rejects(svc.generateSlide(i.id, 0), /no image model/);
});

test('local publishing records a hand-posted piece with no Meta app involved', async () => {
  const { svc } = setup();
  const i = svc.addItem({ projectId: 'app', kind: 'social-post', title: 'Launch', brief: 'x', fixedDate: '2026-11-05' });
  await svc.draft(i.id);
  svc.approve(i.id);
  assert.equal((await svc.publish(i.id)).status, 'published');
  const j = svc.addItem({ projectId: 'app', kind: 'devlog', title: 'Week notes', brief: 'y', fixedDate: '2026-11-06' });
  await svc.draft(j.id);
  svc.approve(j.id);
  assert.equal((await svc.publish(j.id, 'assisted')).status, 'published', 'assisted also records hand-posting');
});

test('connected publishing without a Meta app fails loudly instead of pretending', async () => {
  const { svc } = setup();
  const i = svc.addItem({ projectId: 'app', kind: 'social-post', title: 'Launch', brief: 'x', fixedDate: '2026-11-05' });
  await svc.draft(i.id);
  svc.approve(i.id);
  await assert.rejects(svc.publish(i.id, 'connected'), /Meta app/);
  assert.equal(svc.store.item(i.id)!.status, 'approved', 'still waiting to be posted by hand');
});

test('connected publishing with a publisher posts the caption and hashtags', async () => {
  const sent: string[] = [];
  const { svc } = setup({ publisher: { simulated: true, publish: async post => { sent.push(post.caption); return { id: '1', url: 'http://x/1', simulated: true }; } } });
  const i = svc.addItem({ projectId: 'app', kind: 'social-post', title: 'Launch', brief: 'x', fixedDate: '2026-11-05' });
  await svc.draft(i.id);
  svc.approve(i.id);
  await svc.publish(i.id, 'connected');
  assert.equal(sent.length, 1);
  assert.match(sent[0], /caption \(post\)/);
  assert.match(sent[0], /#MealPrep #cooking/);
});

test('the export pack is the exact text to paste, hashtags included', async () => {
  const { svc } = setup();
  const i = svc.addItem({ projectId: 'app', kind: 'social-post', title: 'Launch', brief: 'x', fixedDate: '2026-11-05' });
  await svc.draft(i.id);
  const pack = svc.exportPack(i.id);
  assert.equal(pack.caption, 'caption (post)');
  assert.deepEqual(pack.hashtags, ['#MealPrep', '#cooking']);
  assert.equal(pack.copyText, 'caption (post)\n\n#MealPrep #cooking');
  await assert.rejects(async () => svc.exportPack(svc.addItem({ projectId: 'app', kind: 'devlog', title: 'Empty', brief: 'y' }).id), /draft it first/);
});

test('a pasted CSV table is read exactly, with no model call', () => {
  const rows = parseAccountCsv('text,format,likes,comments,shares,saves,posted_at\n"Hello, world",tip,10,2,1,3,2026-10-12\nSecond,post,5,0,0,0,not-a-date', '2026-11-01');
  assert.deepEqual(rows?.map(r => [r.text, r.format, r.likes, r.comments, r.shares, r.saves, r.postedAt, r.simulated]), [
    ['Hello, world', 'tip', 10, 2, 1, 3, '2026-10-12', false],
    ['Second', 'post', 5, 0, 0, 0, '2026-11-01', false],
  ]);
  assert.equal(parseAccountCsv('just some free text', '2026-11-01'), undefined, 'free text still goes to the model');
  assert.equal(parseAccountCsv('text\nonly a header', '2026-11-01'), undefined);
});
