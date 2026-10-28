import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Publisher } from '@ripple/shared';
import type { LLM } from '../adapters/llm.ts';
import { ContentStore } from './store.ts';
import { calibration, moved, project } from './forecast.ts';
import type { ImageGen } from '../adapters/image.ts';
import { draftItem, draftPost, explainForecast, proposeContent, reviseItem, revisePost, type FeatureFacts } from './assistant.ts';
import { addDays, day, daysBetween, normalizeHashtags, type Forecast, type Item, type ItemKind, type Media, type Milestone, type Profile } from './types.ts';

const run = promisify(execFile);

// Features that count as delivered: merged into the app.
const DELIVERED = new Set(['APPLIED', 'FEEDBACK', 'ANNOUNCE_DRAFTED', 'PUBLISHING', 'PUBLISHED']);
const DRAFT_LEAD_DAYS = 3; // an item is drafted on its own this many days before its date, when the project allows it
const SOCIAL: ItemKind[] = ['social-post', 'teaser'];

export type FeatureLookup = (id: string) => (FeatureFacts & { projectId: string }) | undefined;
export type GitLog = (repoPath: string, since?: string) => Promise<string[]>;

export const gitLog: GitLog = async (repoPath, since) => {
  const args = ['-C', repoPath, 'log', '--no-merges', '--pretty=%h %s', '-n', '60', ...(since ? [`--since=${since}`] : [])];
  return (await run('git', args)).stdout.split('\n').map(l => l.trim()).filter(Boolean);
};

export interface ScheduledItem extends Item {
  date?: string; // when it is due now: the locked date, or the milestone's projection plus the offset
  plannedDate?: string; // when it was due against the user's own target
  shiftDays?: number; // how far the projection moved it
}

export interface MilestoneView extends Milestone {
  delivered: number;
  forecast?: Forecast;
  atRisk: boolean; // projected after the date the user wants
  slipDays: number; // projected minus wanted
  accuracy?: { errorDays: number }; // for a finished milestone: the last forecast against what happened
}

// The content side of a project: a roadmap the user plans, content the AI helps write around it, and projections the AI revises.
export class ContentService {
  readonly store: ContentStore;
  #llm: LLM;
  #features: FeatureLookup;
  #now: () => Date;
  #exportDir: string;
  #git: GitLog;
  #repoPath: (projectId: string) => string | undefined;
  #publisher?: Publisher;
  #images?: ImageGen;
  #mediaDir: string;
  #projectFeatures: (projectId: string) => Array<FeatureFacts & { id: string }>;

  constructor(o: { images?: ImageGen; mediaDir?: string; projectFeatures?: (projectId: string) => Array<FeatureFacts & { id: string }>; store?: ContentStore; llm: LLM; features: FeatureLookup; exportDir: string; repoPath: (projectId: string) => string | undefined; now?: () => Date; git?: GitLog; publisher?: Publisher }) {
    this.store = o.store ?? new ContentStore();
    this.#llm = o.llm;
    this.#features = o.features;
    this.#exportDir = o.exportDir;
    this.#repoPath = o.repoPath;
    this.#now = o.now ?? (() => new Date());
    this.#git = o.git ?? gitLog;
    this.#publisher = o.publisher;
    this.#images = o.images;
    this.#mediaDir = o.mediaDir ?? join(o.exportDir, 'media');
    this.#projectFeatures = o.projectFeatures ?? (() => []);
  }

  // What the dev side is doing, for the agents: every feature of the project and where it stands.
  projectFeatures(projectId: string) { return this.#projectFeatures(projectId); }
  recentCommits(projectId: string, since = '3 weeks ago') { return this.#commits(projectId, since); }
  get now() { return this.#now(); }
  get llm() { return this.#llm; }

  // --- roadmap
  async createMilestone(i: { projectId: string; title: string; intent: string; targetDate: string; scope: number }) {
    const today = day(this.#now());
    if (i.targetDate < today) throw new Error('the target date is in the past');
    const m = this.store.addMilestone({ ...i, startDate: today, createdAt: this.#now().toISOString() });
    await this.reforecast(m.id, 'first projection');
    return this.milestone(m.id)!;
  }

  async updateMilestone(id: string, patch: Partial<Pick<Milestone, 'title' | 'intent' | 'targetDate' | 'scope'>>) {
    this.store.updateMilestone(id, patch);
    await this.reforecast(id, 'the plan was edited');
    return this.milestone(id)!;
  }

  async markDone(id: string) {
    const m = this.#need(id);
    if (m.status === 'done') return this.milestone(id)!;
    await this.reforecast(id, 'marked done by hand', true);
    this.store.updateMilestone(id, { status: 'done', doneAt: this.#now().toISOString() });
    return this.milestone(id)!;
  }

  async link(milestoneId: string, featureId: string) {
    const m = this.#need(milestoneId);
    const f = this.#features(featureId);
    if (!f || f.projectId !== m.projectId) throw new Error(`feature ${featureId} is not in this project`);
    this.store.link(milestoneId, featureId);
    await this.reforecast(milestoneId, `${f.title} joined the milestone`);
    return this.milestone(milestoneId)!;
  }

  async unlink(milestoneId: string, featureId: string) {
    this.#need(milestoneId);
    this.store.unlink(milestoneId, featureId);
    await this.reforecast(milestoneId, 'a feature left the milestone');
    return this.milestone(milestoneId)!;
  }

  milestone(id: string): MilestoneView | undefined {
    const m = this.store.milestone(id);
    if (!m) return undefined;
    const delivered = m.featureIds.filter(f => DELIVERED.has(this.#features(f)?.state ?? '')).length;
    const forecasts = this.store.forecasts(id);
    const forecast = forecasts.at(-1);
    const slipDays = forecast ? Math.round(daysBetween(m.targetDate, forecast.predictedDate)) : 0;
    return {
      ...m, delivered, forecast, slipDays,
      atRisk: m.status === 'open' && slipDays > 0,
      accuracy: m.status === 'done' && m.doneAt && forecasts.length ? { errorDays: Math.round(daysBetween(forecasts.at(-1)!.predictedDate, m.doneAt.slice(0, 10))) } : undefined,
    };
  }

  milestones(projectId: string) {
    return this.store.milestones(projectId).map(m => this.milestone(m.id)!);
  }

  // The AI revises its projection. A new forecast is only recorded when something changed; the old ones stay, so errors can be learned from.
  async reforecast(milestoneId: string, reason: string, force = false): Promise<Forecast | undefined> {
    const m = this.#need(milestoneId);
    if (m.status === 'done') return undefined;
    const now = this.#now();
    const delivered = m.featureIds.filter(f => DELIVERED.has(this.#features(f)?.state ?? '')).length;
    const done = Math.min(delivered, Math.max(m.scope, 1));
    const cal = calibration(this.store.finished(m.projectId));
    const p = project(m, done, now, cal);
    const previous = this.store.forecasts(milestoneId).at(-1);
    if (!force && !moved(previous, p)) return previous;
    const base = { milestoneId, madeAt: now.toISOString(), predictedDate: p.predictedDate, rawRemainingDays: p.rawRemainingDays, calibration: p.calibration, done: p.done, scope: p.scope, confidence: p.confidence };
    // The numbers are computed above. The model only puts the revision into words; if it fails the note still says what moved.
    let note = `${reason}: ${previous ? `projection moved from ${previous.predictedDate} to ${p.predictedDate}` : `projected ${p.predictedDate}`} (${p.done}/${p.scope} delivered).`;
    try { note = await explainForecast(this.#llm, { milestone: m, previous, next: base, calibrationSamples: cal.samples }); } catch { /* keep the template */ }
    const f = this.store.addForecast({ ...base, note });
    // Everything delivered: the milestone has landed.
    if (done >= m.scope) this.store.updateMilestone(milestoneId, { status: 'done', doneAt: now.toISOString() });
    return f;
  }

  // --- content
  profile(projectId: string) { return this.store.profile(projectId); }
  setProfile(projectId: string, p: Profile) { return this.store.setProfile(projectId, p); }

  addItem(i: { projectId: string; milestoneId?: string; featureId?: string; kind: ItemKind; title: string; brief: string; offsetDays?: number; fixedDate?: string }) {
    if (i.milestoneId && this.#need(i.milestoneId).projectId !== i.projectId) throw new Error('this milestone belongs to another project');
    return this.store.addItem({ ...i, origin: 'user', createdAt: this.#now().toISOString() });
  }

  // Asks the AI for a content plan around a milestone. The pieces come back as ideas: the user corrects the briefs before anything is written.
  async planContent(milestoneId: string, guidance?: string): Promise<Item[]> {
    const m = this.#need(milestoneId);
    const proposed = await proposeContent(this.#llm, {
      milestone: m, forecast: this.store.forecasts(milestoneId).at(-1), profile: this.store.profile(m.projectId),
      features: this.#facts(m.featureIds), existing: this.store.items(m.projectId).filter(i => i.milestoneId === m.id), guidance,
    });
    return proposed.map(p => this.store.addItem({
      projectId: m.projectId, milestoneId: m.id, kind: p.kind, title: p.title, brief: p.brief, offsetDays: p.offsetDays, origin: 'ai', status: 'idea', createdAt: this.#now().toISOString(),
    }));
  }

  // The manager's answer to a proposal. Accepting puts it in the calendar; refusing keeps the reason, which the strategist reads next time.
  accept(itemId: string): Item {
    const i = this.#needItem(itemId);
    return this.store.updateItem(itemId, { status: i.draft ? 'drafted' : 'briefed' });
  }

  reject(itemId: string, reason: string): Item {
    this.#needItem(itemId);
    return this.store.updateItem(itemId, { status: 'rejected', rejectedReason: reason });
  }

  async draft(itemId: string, guidance?: string, commits: string[] = []): Promise<Item> {
    const item = this.#needItem(itemId);
    const milestone = item.milestoneId ? this.store.milestone(item.milestoneId) : undefined;
    const ids = [...(milestone?.featureIds ?? []), ...(item.featureId ? [item.featureId] : [])];
    const ctx = { item, milestone, profile: this.store.profile(item.projectId), features: this.#facts([...new Set(ids)]), commits, guidance };
    if (SOCIAL.includes(item.kind)) {
      const { caption, media } = await draftPost(this.#llm, ctx);
      return this.store.updateItem(itemId, { draft: caption, media, status: 'drafted', revisions: item.revisions + 1 });
    }
    return this.store.updateItem(itemId, { draft: await draftItem(this.#llm, ctx), status: 'drafted', revisions: item.revisions + 1 });
  }

  async revise(itemId: string, instruction: string): Promise<Item> {
    const item = this.#needItem(itemId);
    if (!item.draft) throw new Error('nothing to revise yet: draft it first');
    const profile = this.store.profile(item.projectId);
    if (SOCIAL.includes(item.kind)) {
      const { caption, media } = await revisePost(this.#llm, { item, instruction, profile });
      return this.store.updateItem(itemId, { draft: caption, media, status: 'drafted', revisions: item.revisions + 1 });
    }
    return this.store.updateItem(itemId, { draft: await reviseItem(this.#llm, { item, instruction, profile }), status: 'drafted', revisions: item.revisions + 1 });
  }

  editItem(itemId: string, patch: Partial<Pick<Item, 'title' | 'brief' | 'draft' | 'kind' | 'offsetDays' | 'fixedDate' | 'milestoneId' | 'media'>> & { clearFixedDate?: boolean }): Item {
    const item = this.#needItem(itemId);
    if (patch.media) patch = { ...patch, media: { ...patch.media, hashtags: normalizeHashtags(patch.media.hashtags) } };
    const edited = (patch.draft !== undefined && patch.draft !== item.draft) || (patch.media !== undefined && JSON.stringify(patch.media) !== JSON.stringify(item.media));
    const status = edited ? 'drafted' : item.status === 'idea' && patch.brief?.trim() ? 'briefed' : item.status;
    return this.store.updateItem(itemId, { ...patch, status });
  }

  // The user signs it off. Approved text is written to a file, ready to be copied into the project or a post.
  approve(itemId: string): Item {
    const item = this.#needItem(itemId);
    if (!item.draft.trim()) throw new Error('there is nothing to approve: draft it first');
    const date = this.schedule(item).date ?? day(this.#now());
    const dir = join(this.#exportDir, item.projectId);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${date}-${item.kind}-${item.id}.md`);
    const post = item.media ? this.#exportMedia(item, dir, date) : '';
    writeFileSync(file, `---\ntitle: ${JSON.stringify(item.title)}\nkind: ${item.kind}\ndate: ${date}${item.media ? `\nformat: ${item.media.format}` : ''}\n---\n\n${item.draft}\n${post}`);
    return this.store.updateItem(itemId, { status: 'approved', exportedPath: file });
  }

  // Hashtags, the shot list or slide list, and the pictures copied next to the text.
  #exportMedia(item: Item, dir: string, date: string): string {
    const media = item.media!;
    const folder = `${date}-${item.id}-media`;
    const lines = [`\n${media.hashtags.join(' ')}\n`, `## ${media.format === 'video' ? 'Shots' : 'Slides'}\n`];
    media.slides.forEach((x, i) => {
      let img = '';
      const src = x.file && this.mediaPath(item.id, x.file);
      if (src) { mkdirSync(join(dir, folder), { recursive: true }); copyFileSync(src, join(dir, folder, x.file!)); img = `\n   ![](${folder}/${x.file})`; }
      lines.push(`${i + 1}. ${x.kind === 'video' ? `**Shot${x.seconds ? ` (${x.seconds}s)` : ''}** ` : ''}${x.visual}${x.text ? `\n   Text: ${x.text}` : ''}${img}`);
    });
    return lines.join('\n') + '\n';
  }

  async publish(itemId: string): Promise<Item> {
    const item = this.#needItem(itemId);
    if (item.status !== 'approved') throw new Error('approve it first');
    if (this.#publisher && SOCIAL.includes(item.kind)) await this.#publisher.publish({ caption: [item.draft, item.media?.hashtags.join(' ')].filter(Boolean).join('\n\n'), imagePath: (item.media?.slides[0]?.file && this.mediaPath(item.id, item.media.slides[0].file)) || '' });
    return this.store.updateItem(itemId, { status: 'published', publishedAt: this.#now().toISOString() });
  }

  // --- pictures. Only on request: each one is a paid call, so nothing is generated behind the manager's back.
  async generateSlide(itemId: string, index: number, visual?: string): Promise<Item> {
    if (!this.#images) throw new Error('no image model is configured');
    const item = this.#needItem(itemId);
    const media = item.media;
    const slide = media?.slides[index];
    if (!media || !slide) throw new Error('unknown slide');
    const prompt = (visual ?? slide.visual).trim();
    if (!prompt) throw new Error('describe the picture first');
    const buf = await this.#images.generate(prompt, media.format === 'video' ? '1024x1792' : '1024x1024');
    const dir = join(this.#mediaDir, itemId);
    mkdirSync(dir, { recursive: true });
    const file = `${index + 1}-${Date.now().toString(36)}.jpg`;
    writeFileSync(join(dir, file), buf);
    const slides = media.slides.map((x, i) => i === index ? { ...x, visual: prompt, file } : x);
    return this.store.updateItem(itemId, { media: { ...media, slides } });
  }

  async generateMissing(itemId: string): Promise<Item> {
    let item = this.#needItem(itemId);
    for (const [i, s] of (item.media?.slides ?? []).entries()) if (!s.file) item = await this.generateSlide(itemId, i);
    return item;
  }

  mediaPath(itemId: string, file: string): string | undefined {
    if (!/^[\w.-]+$/.test(file)) return undefined;
    const path = join(this.#mediaDir, itemId, file);
    return this.store.item(itemId)?.media?.slides.some(s => s.file === file) && existsSync(path) ? path : undefined;
  }

  // --- the calendar: every item with the date it is due now
  schedule(item: Item): ScheduledItem {
    if (item.fixedDate) return { ...item, date: item.fixedDate, plannedDate: item.fixedDate, shiftDays: 0 };
    const m = item.milestoneId ? this.store.milestone(item.milestoneId) : undefined;
    if (!m) return { ...item };
    const forecast = this.store.forecasts(m.id).at(-1);
    const offset = item.offsetDays ?? 0;
    const anchor = m.status === 'done' && m.doneAt ? m.doneAt.slice(0, 10) : forecast?.predictedDate ?? m.targetDate;
    const date = addDays(anchor, offset);
    const plannedDate = addDays(m.targetDate, offset);
    return { ...item, date, plannedDate, shiftDays: Math.round(daysBetween(plannedDate, date)) };
  }

  calendar(projectId: string): ScheduledItem[] {
    return this.store.items(projectId).map(i => this.schedule(i)).sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
  }

  // --- dev workflow
  // A feature was merged: the milestones it belongs to are re-projected, and the release note starts itself.
  async onFeatureApplied(featureId: string): Promise<Item[]> {
    const f = this.#features(featureId);
    if (!f) return [];
    const milestones = this.store.milestonesOfFeature(featureId);
    for (const m of milestones) await this.reforecast(m.id, `${f.title} was merged`);
    if (this.store.items(f.projectId).some(i => i.featureId === featureId && i.origin === 'dev')) return [];
    const item = this.store.addItem({
      projectId: f.projectId, milestoneId: milestones[0]?.id, featureId, kind: 'changelog', title: `Changelog: ${f.title}`,
      brief: 'What this feature changes for the people who use the app.', fixedDate: day(this.#now()), origin: 'dev', createdAt: this.#now().toISOString(),
    });
    return [this.store.profile(f.projectId).autoDraft ? await this.draft(item.id).catch(() => item) : item];
  }

  // Changelog from what really happened in the repository, for work done outside the features Ripple_handoff ran.
  async fromGit(projectId: string, since?: string): Promise<Item> {
    const commits = await this.#commits(projectId, since);
    if (!commits.length) throw new Error('no commits in that range');
    const item = this.store.addItem({
      projectId, kind: 'changelog', title: `Changelog${since ? ` since ${since}` : ''}`, brief: 'Summarise these commits for users. Group them; skip chores.',
      fixedDate: day(this.#now()), origin: 'dev', createdAt: this.#now().toISOString(),
    });
    return this.draft(item.id, undefined, commits);
  }

  // Called on a timer. Re-projects open milestones (the plan drifts even when nothing is merged) and drafts what is about to be due.
  async tick(): Promise<{ reforecast: number; drafted: number }> {
    let reforecast = 0, drafted = 0;
    for (const m of this.store.milestones().filter(x => x.status === 'open')) {
      const before = this.store.forecasts(m.id).length;
      await this.reforecast(m.id, 'daily check');
      if (this.store.forecasts(m.id).length > before) reforecast++;
    }
    const today = day(this.#now());
    for (const i of this.store.items()) {
      // Only what the manager accepted or wrote: a proposal still waiting for a decision is not worked on.
      if (i.status !== 'briefed' || !this.store.profile(i.projectId).autoDraft) continue;
      const due = this.schedule(i).date;
      if (!due || due > addDays(today, DRAFT_LEAD_DAYS)) continue;
      try { await this.draft(i.id); drafted++; } catch { /* the next tick tries again */ }
    }
    return { reforecast, drafted };
  }

  #commits(projectId: string, since?: string) {
    const path = this.#repoPath(projectId);
    if (!path) throw new Error(`project ${projectId} not found`);
    return this.#git(path, since);
  }

  #facts(ids: string[]): FeatureFacts[] {
    return ids.map(id => this.#features(id)).filter((f): f is NonNullable<typeof f> => Boolean(f));
  }

  #need(id: string) {
    const m = this.store.milestone(id);
    if (!m) throw new Error(`unknown milestone ${id}`);
    return m;
  }

  #needItem(id: string) {
    const i = this.store.item(id);
    if (!i) throw new Error(`unknown item ${id}`);
    return i;
  }
}
