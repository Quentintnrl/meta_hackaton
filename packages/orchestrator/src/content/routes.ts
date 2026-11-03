import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ProjectStore } from '../projects.ts';
import type { ContentService } from './service.ts';
import { Team, chatThread } from './team.ts';
import { thumbnail } from './thumb.ts';
import { ItemKind, PublishMode } from './types.ts';
import { existsSync, readFileSync } from 'node:fs';

const Date_ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const NewMilestone = z.object({ title: z.string().trim().min(1).max(120), intent: z.string().trim().max(4000).default(''), targetDate: Date_, scope: z.number().int().min(1).max(50) });
const PatchMilestone = NewMilestone.partial();
const Profile = z.object({ voice: z.string().max(2000), audience: z.string().max(1000), language: z.string().trim().min(1).max(40), autoDraft: z.boolean(), autopilot: z.boolean().default(false), niche: z.string().max(500).default(''), directives: z.string().max(3000).default(''), publishMode: PublishMode.default('local'), cadence: z.record(z.string(), z.number().min(0).max(30)).default({}) });
const NewItem = z.object({
  kind: ItemKind, title: z.string().trim().min(1).max(160), brief: z.string().max(4000).default(''),
  milestoneId: z.string().optional(), featureId: z.string().optional(), offsetDays: z.number().int().min(-90).max(90).optional(), fixedDate: Date_.optional(),
  // A piece the manager takes from something seen in the field: it keeps where it came from and why.
  rationale: z.string().max(1500).optional(), source: z.enum(['trend', 'account', 'roadmap', 'manager']).optional(), pitch: z.object({ hook: z.string().max(400), channel: z.string().max(80), measure: z.string().max(300), context: z.string().max(800).optional(), audience: z.string().max(200).optional() }).optional(),
});
const PatchItem = z.object({
  title: z.string().trim().min(1).max(160), brief: z.string().max(4000), draft: z.string().max(20000), kind: ItemKind,
  offsetDays: z.number().int().min(-90).max(90), fixedDate: Date_, milestoneId: z.string(), clearFixedDate: z.boolean(),
  seriesId: z.string().max(40).nullable(),
  media: z.object({
    format: z.enum(['image', 'carousel', 'video']),
    hashtags: z.array(z.string().max(60)).max(30),
    slides: z.array(z.object({ kind: z.enum(['image', 'video']), visual: z.string().max(2000), text: z.string().max(1000), seconds: z.number().int().min(0).max(90), file: z.string().regex(/^[\w.-]+$/).optional() })).min(1).max(10),
  }),
}).partial();

// Roadmap, content calendar and the AI that helps with both. Mounted at '/'
// next to the dev feature routes (see createApp): every path below is
// absolute, starting with /projects/:pid/content, /projects/:pid/team,
// /projects/:pid/account, /items or /milestones.
export function contentRoutes(svc: ContentService, projects: ProjectStore, team = new Team(svc)) {
  const app = new Hono();

  const body = async <T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | Response> => {
    const parsed = schema.safeParse(await c.req.json().catch(() => ({})));
    return parsed.success ? parsed.data : c.json({ error: z.prettifyError(parsed.error) }, 400);
  };
  const isResponse = (x: unknown): x is Response => x instanceof Response;
  const guard = async (c: Context, fn: () => unknown, status = 200) => {
    try {
      return c.json(await fn(), status as 200);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, /^unknown /.test(msg) ? 404 : 400);
    }
  };
  const known = (c: Context) => projects.get(c.req.param('pid') ?? '') !== undefined;

  app.get('/projects/:pid/content', c => known(c)
    ? c.json({ profile: svc.profile(c.req.param('pid')), milestones: svc.milestones(c.req.param('pid')), items: svc.calendar(c.req.param('pid')), series: svc.series(c.req.param('pid')) })
    : c.json({ error: 'unknown project' }, 404));

  app.put('/projects/:pid/profile', async c => {
    if (!known(c)) return c.json({ error: 'unknown project' }, 404);
    const b = await body(c, Profile);
    return isResponse(b) ? b : c.json(svc.setProfile(c.req.param('pid'), b));
  });

  app.post('/projects/:pid/milestones', async c => {
    if (!known(c)) return c.json({ error: 'unknown project' }, 404);
    const b = await body(c, NewMilestone);
    return isResponse(b) ? b : guard(c, () => svc.createMilestone({ projectId: c.req.param('pid'), ...b }), 201);
  });

  app.patch('/milestones/:id', async c => {
    const b = await body(c, PatchMilestone);
    return isResponse(b) ? b : guard(c, () => svc.updateMilestone(c.req.param('id'), b));
  });

  app.delete('/milestones/:id', c => guard(c, () => {
    if (!svc.store.milestone(c.req.param('id'))) throw new Error('unknown milestone');
    svc.store.removeMilestone(c.req.param('id'));
    return { ok: true };
  }));

  app.post('/milestones/:id/done', c => guard(c, () => svc.markDone(c.req.param('id'))));
  app.get('/milestones/:id/forecasts', c => svc.store.milestone(c.req.param('id')) ? c.json(svc.store.forecasts(c.req.param('id'))) : c.json({ error: 'unknown milestone' }, 404));

  app.post('/milestones/:id/features', async c => {
    const b = await body(c, z.object({ featureId: z.string().min(1) }));
    return isResponse(b) ? b : guard(c, () => svc.link(c.req.param('id'), b.featureId));
  });
  app.delete('/milestones/:id/features/:fid', c => guard(c, () => svc.unlink(c.req.param('id'), c.req.param('fid'))));

  // The AI proposes a content plan around the milestone; `guidance` is what the user wants it to keep in mind.
  app.post('/milestones/:id/plan', async c => {
    const b = await body(c, z.object({ guidance: z.string().max(2000).optional() }));
    return isResponse(b) ? b : guard(c, () => svc.planContent(c.req.param('id'), b.guidance), 201);
  });

  app.post('/projects/:pid/items', async c => {
    if (!known(c)) return c.json({ error: 'unknown project' }, 404);
    const b = await body(c, NewItem);
    return isResponse(b) ? b : guard(c, () => svc.addItem({ projectId: c.req.param('pid'), ...b }), 201);
  });

  app.patch('/items/:id', async c => {
    const b = await body(c, PatchItem);
    return isResponse(b) ? b : guard(c, () => svc.editItem(c.req.param('id'), b));
  });
  app.delete('/items/:id', c => guard(c, () => {
    if (!svc.store.item(c.req.param('id'))) throw new Error('unknown item');
    svc.store.removeItem(c.req.param('id'));
    return { ok: true };
  }));

  app.post('/items/:id/draft', async c => {
    const b = await body(c, z.object({ guidance: z.string().max(2000).optional() }));
    return isResponse(b) ? b : guard(c, () => svc.draft(c.req.param('id'), b.guidance));
  });
  app.post('/items/:id/revise', async c => {
    const b = await body(c, z.object({ instruction: z.string().trim().min(1).max(2000) }));
    return isResponse(b) ? b : guard(c, () => svc.revise(c.req.param('id'), b.instruction));
  });
  // Pictures of a post: one slide, or every slide that has none yet. Each call is a paid image generation.
  app.post('/items/:id/media/generate', c => guard(c, () => svc.generateMissing(c.req.param('id'))));
  // The manager's own picture on a slide, sent as base64 (JPEG, PNG or WebP, 8 MB at most). No model call.
  app.post('/items/:id/media/:index/upload', async c => {
    const b = await body(c, z.object({ type: z.enum(['image/jpeg', 'image/png', 'image/webp']), data: z.string().min(1).max(12 * 1024 * 1024) }));
    return isResponse(b) ? b : guard(c, () => svc.uploadSlide(c.req.param('id'), Number(c.req.param('index')), Buffer.from(b.data, 'base64'), b.type));
  });
  app.post('/items/:id/media/:index/generate', async c => {
    const b = await body(c, z.object({ visual: z.string().max(2000).optional() }));
    return isResponse(b) ? b : guard(c, () => svc.generateSlide(c.req.param('id'), Number(c.req.param('index')), b.visual));
  });
  // Assemble the storyboard into an MP4 from its keyframes (local ffmpeg, no model call).
  app.post('/items/:id/video', c => guard(c, async () => { await svc.renderVideo(c.req.param('id')); return { ok: true }; }));
  app.get('/items/:id/video', c => {
    const id = c.req.param('id');
    const path = svc.store.item(id) ? svc.videoPath(id) : '';
    return path && existsSync(path) ? c.body(readFileSync(path), 200, { 'content-type': 'video/mp4', 'cache-control': 'no-store' }) : c.json({ error: 'not found' }, 404);
  });
  app.get('/items/:id/media/:file', c => {
    const path = svc.mediaPath(c.req.param('id'), c.req.param('file'));
    return path ? c.body(readFileSync(path), 200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }) : c.json({ error: 'not found' }, 404);
  });

  app.post('/items/:id/approve', c => guard(c, () => svc.approve(c.req.param('id'))));
  // Local and assisted mark what the manager posted by hand; connected posts
  // through the publisher and fails loudly when no Meta app is set up.
  app.post('/items/:id/publish', async c => {
    const b = await body(c, z.object({ mode: PublishMode.optional() }));
    return isResponse(b) ? b : guard(c, () => svc.publish(c.req.param('id'), b.mode));
  });
  // The ready-to-post pack: exact text to paste and media to attach. No Meta app involved.
  app.get('/items/:id/export-pack', c => guard(c, () => svc.exportPack(c.req.param('id'))));
  // Every approved piece in one ZIP for a scheduler: posts.csv plus a folder per piece with its caption and pictures.
  app.get('/projects/:pid/export-week', c => {
    if (!known(c)) return c.json({ error: 'unknown project' }, 404);
    const pack = svc.weekPack(c.req.param('pid'));
    if (!pack.count) return c.json({ error: 'nothing approved to export yet' }, 400);
    return c.body(new Uint8Array(pack.zip), 200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${pack.name}"`, 'cache-control': 'no-store' });
  });
  // A posted piece and the real post it became: the manager confirms the match the server offers.
  app.post('/items/:id/match', async c => {
    const b = await body(c, z.object({ postId: z.number().int().min(1) }));
    return isResponse(b) ? b : guard(c, () => svc.confirmMatch(c.req.param('id'), b.postId));
  });

  // Changelog from the repository's own history. A git hook can call this after each merge (see README).
  app.post('/projects/:pid/content/from-git', async c => {
    if (!known(c)) return c.json({ error: 'unknown project' }, 404);
    const b = await body(c, z.object({ since: z.string().trim().max(60).regex(/^[\w .:+-]+$/).optional() }));
    return isResponse(b) ? b : guard(c, () => svc.fromGit(c.req.param('pid'), b.since), 201);
  });

  // --- the team
  app.get('/projects/:pid/team', c => known(c) ? c.json(team.overview(c.req.param('pid'))) : c.json({ error: 'unknown project' }, 404));

  // Briefs the team. Runs in the background; the console watches /team for the agent at work and the activity log.
  app.post('/projects/:pid/team/run', async c => {
    if (!known(c)) return c.json({ error: 'unknown project' }, 404);
    const b = await body(c, z.object({ agents: z.array(z.enum(['scout', 'analyst', 'strategist', 'writer', 'director'])).min(1).default(['scout', 'analyst', 'strategist']), brief: z.string().max(2000).default('') }));
    if (isResponse(b)) return b;
    return team.start(c.req.param('pid'), projects.get(c.req.param('pid'))!.name, b.agents, b.brief) ? c.json({ ok: true }, 202) : c.json({ error: 'the team is already working' }, 409);
  });

  // The account the analyst compares with the field: pasted by the manager, or fictional demo data.
  app.put('/projects/:pid/account', async c => {
    if (!known(c)) return c.json({ error: 'unknown project' }, 404);
    const b = await body(c, z.object({ paste: z.string().max(20000).optional(), demo: z.boolean().optional(), platform: z.string().trim().min(1).max(40).default('instagram'), followers: z.number().int().min(0).optional() }).refine(x => x.paste?.trim() || x.demo || x.followers !== undefined, { message: 'paste your posts, give a follower count, or load the demo' }));
    if (isResponse(b)) return b;
    return guard(c, async () => {
      const pid = c.req.param('pid');
      if (b.demo) team.loadDemoAccount(pid, projects.get(pid)!.name);
      else if (b.paste?.trim()) await team.importAccount(pid, b.paste, b.platform);
      // The audience size is a snapshot: two of them make a trend.
      if (b.followers !== undefined) svc.store.snapshot(pid, { at: svc.now.toISOString(), platform: b.platform, followers: b.followers, posts: svc.store.account(pid).filter(p => p.platform === b.platform).length });
      return team.overview(pid);
    });
  });

  // The connected account, read now rather than at the next pass.
  app.post('/projects/:pid/account/sync', c => known(c)
    ? guard(c, async () => { await team.syncInstagram(c.req.param('pid')); return team.overview(c.req.param('pid')); })
    : c.json({ error: 'unknown project' }, 404));

  // Editorial memory: series, reuse, and which posted piece came from which studio item.
  app.post('/projects/:pid/series', async c => {
    if (!known(c)) return c.json({ error: 'unknown project' }, 404);
    const b = await body(c, z.object({ name: z.string().trim().min(1).max(60) }));
    return isResponse(b) ? b : guard(c, () => svc.saveSeries(c.req.param('pid'), b.name), 201);
  });

  app.post('/items/:id/reuse', c => guard(c, () => svc.reuseItem(c.req.param('id')), 201));

  app.get('/projects/:pid/account/posts', c => known(c)
    ? c.json(svc.store.account(c.req.param('pid')))
    : c.json({ error: 'unknown project' }, 404));

  app.patch('/projects/:pid/account/:postId', async c => {
    if (!known(c)) return c.json({ error: 'unknown project' }, 404);
    const b = await body(c, z.object({ itemId: z.string().max(40).nullable() }));
    return isResponse(b) ? b : guard(c, () => { svc.linkPost(c.req.param('pid'), Number(c.req.param('postId')), b.itemId); return { ok: true }; });
  });

  // The team: its settings, the manager's confirmation of what a chat offered, and the conversation itself (/team/talk).
  const Agent = z.enum(['director', 'scout', 'analyst', 'strategist', 'writer']);
  // The picture a field example's page advertises, fetched once and cached. No model call.
  app.get('/projects/:pid/team/thumb', async c => {
    const url = c.req.query('url') ?? '';
    if (!known(c) || !url) return c.json({ error: 'not found' }, 404);
    const t = await thumbnail(url, svc.thumbDir);
    return t ? c.body(readFileSync(t.path), 200, { 'content-type': t.type, 'cache-control': 'public, max-age=86400' }) : c.json({ error: 'no picture on that page' }, 404);
  });
  app.patch('/projects/:pid/team/agents/:agent', async c => {
    const a = Agent.safeParse(c.req.param('agent'));
    if (!known(c) || !a.success) return c.json({ error: 'unknown project or agent' }, 404);
    const b = await body(c, z.object({ enabled: z.boolean(), workers: z.number().int().min(1).max(3), instructions: z.string().max(2000) }).partial());
    return isResponse(b) ? b : guard(c, () => team.setConfig(c.req.param('pid'), a.data, b));
  });
  // What the manager confirmed from a chat: run, configure, generate, revise, rebrief, propose, date.
  app.post('/projects/:pid/team/actions', async c => {
    if (!known(c)) return c.json({ error: 'unknown project' }, 404);
    const b = await body(c, z.object({
      kind: z.enum(['run', 'configure', 'generate', 'revise', 'rebrief', 'propose', 'date']), label: z.string().max(200).default(''), why: z.string().max(400).optional(), by: Agent.optional(),
      agents: z.array(Agent).max(4).optional(), brief: z.string().max(2000).optional(), agent: Agent.optional(), enabled: z.boolean().optional(), workers: z.number().int().min(1).max(3).optional(), instructions: z.string().max(2000).optional(),
      itemId: z.string().max(40).optional(), index: z.number().int().min(0).max(20).optional(), instruction: z.string().max(2000).optional(),
      title: z.string().max(160).optional(), hook: z.string().max(400).optional(), channel: z.string().max(80).optional(), pieceKind: ItemKind.optional(), date: Date_.optional(),
    }));
    return isResponse(b) ? b : guard(c, () => team.apply(c.req.param('pid'), projects.get(c.req.param('pid'))!.name, b));
  });

  // The team's conversation: one thread for the studio (or per piece / goal), any agent may answer.
  const Base = z.enum(['team', 'director', 'scout', 'analyst', 'strategist', 'writer']);
  app.get('/projects/:pid/team/talk', c => {
    const base = Base.safeParse(c.req.query('base') ?? 'team');
    return known(c) && base.success ? c.json(svc.store.chat(c.req.param('pid'), chatThread(base.data, c.req.query('about') ?? ''))) : c.json({ error: 'unknown project or thread' }, 404);
  });
  app.post('/projects/:pid/team/talk', async c => {
    if (!known(c)) return c.json({ error: 'unknown project' }, 404);
    const b = await body(c, z.object({ message: z.string().trim().min(1).max(2000), context: z.string().trim().max(4000).default(''), about: z.string().trim().max(80).default(''), hint: z.string().trim().max(40).default(''), agent: Agent.optional(), base: Base.default('team') }));
    return isResponse(b) ? b : guard(c, () => team.ask(c.req.param('pid'), b));
  });

  app.post('/items/:id/accept', c => guard(c, () => svc.accept(c.req.param('id'))));
  app.post('/items/:id/restore', c => guard(c, () => svc.restore(c.req.param('id'))));
  app.post('/items/:id/reject', async c => {
    const b = await body(c, z.object({ reason: z.string().trim().max(500).default('') }));
    return isResponse(b) ? b : guard(c, () => svc.reject(c.req.param('id'), b.reason));
  });

  app.post('/content/tick', c => guard(c, () => svc.tick()));

  return app;
}
