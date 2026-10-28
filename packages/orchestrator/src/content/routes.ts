import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { ProjectStore } from '../projects.ts';
import type { ContentService } from './service.ts';
import { ItemKind } from './types.ts';

const Date_ = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const NewMilestone = z.object({ title: z.string().trim().min(1).max(120), intent: z.string().trim().max(4000).default(''), targetDate: Date_, scope: z.number().int().min(1).max(50) });
const PatchMilestone = NewMilestone.partial();
const Profile = z.object({ voice: z.string().max(2000), audience: z.string().max(1000), language: z.string().trim().min(1).max(40), autoDraft: z.boolean() });
const NewItem = z.object({
  kind: ItemKind, title: z.string().trim().min(1).max(160), brief: z.string().max(4000).default(''),
  milestoneId: z.string().optional(), featureId: z.string().optional(), offsetDays: z.number().int().min(-90).max(90).optional(), fixedDate: Date_.optional(),
});
const PatchItem = z.object({
  title: z.string().trim().min(1).max(160), brief: z.string().max(4000), draft: z.string().max(20000), kind: ItemKind,
  offsetDays: z.number().int().min(-90).max(90), fixedDate: Date_, milestoneId: z.string(), clearFixedDate: z.boolean(),
}).partial();

// Roadmap, content calendar and the AI that helps with both. Mounted next to the feature routes.
export function contentRoutes(svc: ContentService, projects: ProjectStore) {
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
  app.post('/items/:id/approve', c => guard(c, () => svc.approve(c.req.param('id'))));
  app.post('/items/:id/publish', c => guard(c, () => svc.publish(c.req.param('id'))));

  // Changelog from the repository's own history. A git hook can call this after each merge (see README).
  app.post('/projects/:pid/content/from-git', async c => {
    if (!known(c)) return c.json({ error: 'unknown project' }, 404);
    const b = await body(c, z.object({ since: z.string().trim().max(60).regex(/^[\w .:+-]+$/).optional() }));
    return isResponse(b) ? b : guard(c, () => svc.fromGit(c.req.param('pid'), b.since), 201);
  });

  app.post('/content/tick', c => guard(c, () => svc.tick()));

  return app;
}
