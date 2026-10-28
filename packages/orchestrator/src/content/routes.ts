import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ProjectStore } from '../projects.ts';
import type { ContentService } from './service.ts';
import { Team } from './team.ts';
import { ItemKind } from './types.ts';
import { existsSync, readFileSync } from 'node:fs';

const Date_ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const NewMilestone = z.object({ title: z.string().trim().min(1).max(120), intent: z.string().trim().max(4000).default(''), targetDate: Date_, scope: z.number().int().min(1).max(50) });
const PatchMilestone = NewMilestone.partial();
const Profile = z.object({ voice: z.string().max(2000), audience: z.string().max(1000), language: z.string().trim().min(1).max(40), autoDraft: z.boolean(), niche: z.string().max(500).default(''), directives: z.string().max(3000).default('') });
const NewItem = z.object({
  kind: ItemKind, title: z.string().trim().min(1).max(160), brief: z.string().max(4000).default(''),
  milestoneId: z.string().optional(), featureId: z.string().optional(), offsetDays: z.number().int().min(-90).max(90).optional(), fixedDate: Date_.optional(),
});
const PatchItem = z.object({
  title: z.string().trim().min(1).max(160), brief: z.string().max(4000), draft: z.string().max(20000), kind: ItemKind,
  offsetDays: z.number().int().min(-90).max(90), fixedDate: Date_, milestoneId: z.string(), clearFixedDate: z.boolean(),
  media: z.object({
    format: z.enum(['image', 'carousel', 'video']),
    hashtags: z.array(z.string().max(60)).max(30),
    slides: z.array(z.object({ kind: z.enum(['image', 'video']), visual: z.string().max(2000), text: z.string().max(1000), seconds: z.number().int().min(0).max(90), file: z.string().regex(/^[\w.-]+$/).optional() })).min(1).max(10),
  }),
}).partial();

// Roadmap, content calendar and the AI that helps with both. Mounted next to the feature routes.
export function contentRoutes(svc: ContentService, projects: ProjectStore) {
  const app = new Hono();
  const team = new Team(svc);

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
    ? c.json({ profile: svc.profile(c.req.param('pid')), milestones: svc.milestones(c.req.param('pid')), items: svc.calendar(c.req.param('pid')) })
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
  app.post('/items/:id/publish', c => guard(c, () => svc.publish(c.req.param('id'))));

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
    const b = await body(c, z.object({ agents: z.array(z.enum(['scout', 'analyst', 'strategist', 'writer'])).min(1).default(['scout', 'analyst', 'strategist']), brief: z.string().max(2000).default('') }));
    if (isResponse(b)) return b;
    return team.start(c.req.param('pid'), projects.get(c.req.param('pid'))!.name, b.agents, b.brief) ? c.json({ ok: true }, 202) : c.json({ error: 'the team is already working' }, 409);
  });

  // The account the analyst compares with the field: pasted by the manager, or fictional demo data.
  app.put('/projects/:pid/account', async c => {
    if (!known(c)) return c.json({ error: 'unknown project' }, 404);
    const b = await body(c, z.object({ paste: z.string().max(20000).optional(), demo: z.boolean().optional() }).refine(x => x.paste?.trim() || x.demo, { message: 'paste your posts, or load the demo' }));
    if (isResponse(b)) return b;
    return guard(c, async () => {
      if (b.demo) team.loadDemoAccount(c.req.param('pid'), projects.get(c.req.param('pid'))!.name);
      else await team.importAccount(c.req.param('pid'), b.paste!);
      return team.overview(c.req.param('pid'));
    });
  });

  // The director first, then any agent: a conversation, a configuration, and the manager's confirmation of what was suggested.
  const Agent = z.enum(['director', 'scout', 'analyst', 'strategist', 'writer']);
  app.get('/projects/:pid/team/chat/:agent', c => {
    const a = Agent.safeParse(c.req.param('agent'));
    return known(c) && a.success ? c.json(svc.store.chat(c.req.param('pid'), a.data)) : c.json({ error: 'unknown project or agent' }, 404);
  });
  app.post('/projects/:pid/team/chat/:agent', async c => {
    const a = Agent.safeParse(c.req.param('agent'));
    if (!known(c) || !a.success) return c.json({ error: 'unknown project or agent' }, 404);
    const b = await body(c, z.object({ message: z.string().trim().min(1).max(2000) }));
    return isResponse(b) ? b : guard(c, () => team.chatAgent(c.req.param('pid'), a.data, b.message));
  });
  app.patch('/projects/:pid/team/agents/:agent', async c => {
    const a = Agent.safeParse(c.req.param('agent'));
    if (!known(c) || !a.success) return c.json({ error: 'unknown project or agent' }, 404);
    const b = await body(c, z.object({ enabled: z.boolean(), workers: z.number().int().min(1).max(3), instructions: z.string().max(2000) }).partial());
    return isResponse(b) ? b : guard(c, () => team.setConfig(c.req.param('pid'), a.data, b));
  });
  app.post('/projects/:pid/team/actions', async c => {
    if (!known(c)) return c.json({ error: 'unknown project' }, 404);
    const b = await body(c, z.object({ kind: z.enum(['run', 'configure']), label: z.string().max(200).default(''), agents: z.array(Agent).max(4).optional(), brief: z.string().max(2000).optional(), agent: Agent.optional(), enabled: z.boolean().optional(), workers: z.number().int().min(1).max(3).optional(), instructions: z.string().max(2000).optional() }));
    return isResponse(b) ? b : guard(c, () => team.apply(c.req.param('pid'), projects.get(c.req.param('pid'))!.name, b));
  });

  app.post('/items/:id/accept', c => guard(c, () => svc.accept(c.req.param('id'))));
  app.post('/items/:id/reject', async c => {
    const b = await body(c, z.object({ reason: z.string().trim().max(500).default('') }));
    return isResponse(b) ? b : guard(c, () => svc.reject(c.req.param('id'), b.reason));
  });

  app.post('/content/tick', c => guard(c, () => svc.tick()));

  return app;
}
