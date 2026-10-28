import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { Autonomy, Gate, defaultAutonomy } from '@ripple/shared';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { imageInfo } from './visual/image.ts';
import { parseFigmaUrl, type Figma } from './adapters/figma.ts';
import type { Runtime } from './runtime.ts';
import type { ProjectStore } from './projects.ts';
import { REPO_URL, repoNameFromUrl, type ProjectSources } from './project-sources.ts';

const CreateFeature = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,60}$/),
    title: z.string().min(1),
    design: z.string().default(''), // notes; optional when a Figma frame is linked
    autonomy: z.partialRecord(Gate, Autonomy).optional(), // gates left out keep their default
    figma: z.string().max(500).optional(), // link to the Figma frame: the source of truth
  })
  .refine(b => b.design.trim() || b.figma, { message: 'Describe the change or link a Figma frame', path: ['design'] });

// One body per way of getting a repository.
const CreateProject = z.discriminatedUnion('source', [
  z.object({ source: z.literal('link'), name: z.string().trim().min(1).max(60), path: z.string().trim().min(1) }),
  z.object({ source: z.literal('clone'), repoUrl: z.string().trim().regex(REPO_URL, 'must be an https:// or git@ URL'), name: z.string().trim().max(60).optional() }),
  z.object({
    source: z.literal('scratch'),
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(2000).optional(),
    github: z.object({ visibility: z.enum(['private', 'public']) }).optional(),
  }),
]);

const Approval = z.object({ gate: Gate, push: z.boolean().optional() });

export function createApp(rt: Runtime, projects: ProjectStore, sources: ProjectSources, opts: { visualDir: string; figma?: Figma }) {
  const app = new Hono();

  app.get('/projects', c => c.json(projects.list()));

  app.post('/projects', async c => {
    const parsed = CreateProject.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400);
    const input = parsed.data;
    try {
      if (input.source === 'link') {
        const { path, repoUrl } = await sources.link(input);
        if (projects.list().some(p => p.path === path)) return c.json({ error: 'a project already uses this path' }, 409);
        return c.json(projects.add({ source: 'link', name: input.name, path, repoUrl }), 201);
      }
      const name = input.source === 'clone' ? input.name || repoNameFromUrl(input.repoUrl) : input.name;
      const id = projects.suggestId(name);
      const made = input.source === 'clone'
        ? await sources.clone({ id, repoUrl: input.repoUrl })
        : await sources.scratch({ id, name, description: input.description, github: input.github });
      return c.json(projects.add({ id, source: input.source, name, ...made }), 201);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.delete('/projects/:id', c => {
    const id = c.req.param('id');
    if (!projects.get(id)) return c.json({ error: 'not found' }, 404);
    if (rt.list().some(f => f.projectId === id)) return c.json({ error: 'this project still has features' }, 409);
    projects.remove(id);
    return c.json({ ok: true });
  });

  // A project contains its features: they are listed and created under it.
  app.get('/projects/:pid/features', c => {
    const pid = c.req.param('pid');
    if (!projects.get(pid)) return c.json({ error: 'unknown project' }, 404);
    return c.json(rt.list().filter(f => f.projectId === pid));
  });

  app.post('/projects/:pid/features', async c => {
    const pid = c.req.param('pid');
    if (!projects.get(pid)) return c.json({ error: 'unknown project' }, 404);
    const parsed = CreateFeature.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400);
    const { id, title, autonomy, figma } = parsed.data;
    let design = parsed.data.design.trim();
    if (rt.get(id)) return c.json({ error: `feature ${id} already exists` }, 409);

    // The Figma frame gives the mockup image (for the visual check) and its structure (for the planner).
    let mockupFile: string | undefined;
    if (figma) {
      if (!opts.figma) return c.json({ error: 'FIGMA_TOKEN is not set. Add it to .env and restart the orchestrator.' }, 400);
      try {
        const frame = await opts.figma.fetchFrame(figma);
        const info = imageInfo(frame.png);
        if (!info) throw new Error('Figma did not return a PNG image');
        if (info.width < 200 || info.height < 200 || info.width > 3000 || info.height > 3000) throw new Error(`the frame is ${info.width}x${info.height}px: expected between 200 and 3000. Link a screen-sized frame.`);
        mkdirSync(join(opts.visualDir, id), { recursive: true });
        mockupFile = join(opts.visualDir, id, 'mockup.png');
        writeFileSync(mockupFile, frame.png);
        design = [design, `Figma frame (layers and texts):\n${frame.outline}`].filter(Boolean).join('\n\n');
      } catch (e) {
        return c.json({ error: (e as Error).message }, 400);
      }
    }
    try {
      return c.json(rt.create(id, { title, design, projectId: pid, mockup: mockupFile, figma }, { ...defaultAutonomy, ...autonomy }), 201);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 409);
    }
  });

  app.get('/features/:id', c => {
    const f = rt.get(c.req.param('id'));
    return f ? c.json({ ...f, events: rt.journal.list(f.id) }) : c.json({ error: 'not found' }, 404);
  });

  // The user validates a gate (low autonomy).
  app.post('/features/:id/approve', async c => {
    const parsed = Approval.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400);
    if (!rt.get(c.req.param('id'))) return c.json({ error: 'not found' }, 404);
    return c.json(rt.send(c.req.param('id'), { type: 'APPROVE', gate: parsed.data.gate, push: parsed.data.push }));
  });

  // The user's answer to a failed step: apply the proposed fix (optionally for every future failure of that kind), or leave it.
  app.post('/features/:id/recovery', async c => {
    const parsed = z.object({ action: z.enum(['apply', 'dismiss']), always: z.boolean().optional() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400);
    if (!rt.get(c.req.param('id'))) return c.json({ error: 'not found' }, 404);
    try {
      return c.json(await rt.resolveFailure(c.req.param('id'), parsed.data));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 409);
    }
  });

  // Fixes applied without asking. Listed so the user can switch one off again.
  app.get('/autofix', c => c.json(rt.autoFix.list()));
  app.delete('/autofix/:kind', c => {
    const kind = c.req.param('kind');
    if (kind !== 'retry' && kind !== 'prune-worktrees' && kind !== 'reset-branch') return c.json({ error: 'unknown fix' }, 404);
    rt.autoFix.disable(kind);
    return c.json(rt.autoFix.list());
  });

  // Images of the visual check: the mockup, the screenshot of the build.
  app.get('/features/:id/visual/:file', c => {
    const { id, file } = c.req.param();
    if (!rt.get(id) || !['mockup.png', 'mockup.jpeg', 'app.png', 'before.png'].includes(file)) return c.json({ error: 'not found' }, 404);
    const path = join(opts.visualDir, id, file);
    if (!existsSync(path)) return c.json({ error: 'not found' }, 404);
    return c.body(readFileSync(path), 200, { 'content-type': file.endsWith('png') ? 'image/png' : 'image/jpeg', 'cache-control': 'no-store' });
  });

  app.post('/features/:id/visual/run', c => {
    try {
      rt.reviewAgain(c.req.param('id'));
      return c.json({ ok: true }, 202);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 409);
    }
  });

  // Manual stand-in for agents that are not wired yet (visual check). Gates go through /approve.
  app.post('/features/:id/events', async c => {
    const parsed = z.object({ type: z.enum(['VISUAL_OK', 'VISUAL_DIFF']), feedback: z.string().max(2000).optional() }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400);
    if (!rt.get(c.req.param('id'))) return c.json({ error: 'not found' }, 404);
    return c.json(rt.send(c.req.param('id'), parsed.data));
  });

  // What a Figma link points at, before a feature is created from it. Nothing is stored.
  app.get('/figma/preview', async c => {
    const url = c.req.query('url') ?? '';
    if (!parseFigmaUrl(url)) return c.json({ error: 'This is not a link to a Figma frame.' }, 400);
    if (!opts.figma) return c.json({ error: 'FIGMA_TOKEN is not set. Add it to .env.' }, 400);
    try {
      return c.body(new Uint8Array((await opts.figma.fetchFrame(url)).png), 200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  // The journal as plain JSON. The console polls it, so it still catches up when the event stream silently dies
  // (a proxy that outlives a server restart, a sleeping laptop).
  app.get('/journal', c => {
    const after = Number(c.req.query('after') ?? 0);
    return c.json(rt.journal.list().filter(e => e.id > (Number.isFinite(after) ? after : 0)));
  });

  // Timeline: replays the journal, then streams new entries.
  app.get('/events', c =>
    streamSSE(c, async stream => {
      await stream.write(': connected\n\n'); // flushes the headers so the browser sees the stream open even with an empty journal
      for (const e of rt.journal.list()) await stream.writeSSE({ id: String(e.id), event: e.type, data: JSON.stringify(e) });
      const unsubscribe = rt.subscribe(e => void stream.writeSSE({ id: String(e.id), event: e.type, data: JSON.stringify(e) }));
      stream.onAbort(unsubscribe);
      await new Promise<void>(resolve => stream.onAbort(resolve));
    }),
  );

  return app;
}

