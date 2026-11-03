import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { join } from 'node:path';
import type { Publisher } from '@ripple/shared';
import type { LLM } from '../adapters/llm.ts';
import { ContentStore } from './store.ts';
import { calibration, moved, project } from './forecast.ts';
import type { ImageGen } from '../adapters/image.ts';
import { renderVideo } from './video.ts';
import { draftItem, draftPost, explainForecast, proposeContent, reviseItem, revisePost, type FeatureFacts } from './assistant.ts';
import { addDays, day, daysBetween, normalizeHashtags, type AccountPost, type ExportPack, type Forecast, type Item, type ItemKind, type Match, type Media, type Milestone, type Outcome, type Profile, type PublishMode, type Series, type Step } from './types.ts';

const run = promisify(execFile);
const cut = (s: string, n = 120) => { const t = s.trim().replace(/\s+/g, ' '); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

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
  reusedFrom?: string; // titles of the pieces this one was derived from, if any
  versionCount?: number; // approved snapshots kept for this piece
  chain: Step[]; // how it got here: every step, who did it, when
  outcome?: Outcome; // posted pieces tied to the real post: what it got
  match?: Match; // posted pieces not tied yet: the real post that looks like it, to confirm
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

  addItem(i: { projectId: string; milestoneId?: string; featureId?: string; kind: ItemKind; title: string; brief: string; offsetDays?: number; fixedDate?: string; rationale?: string; source?: Item['source']; pitch?: Item['pitch'] }) {
    if (i.milestoneId && this.#need(i.milestoneId).projectId !== i.projectId) throw new Error('this milestone belongs to another project');
    const item = this.store.addItem({ ...i, origin: 'user', createdAt: this.#now().toISOString() });
    this.step(item.id, 'added', 'you', i.brief ? `Added it yourself: ${cut(i.brief)}` : 'Added it yourself');
    return item;
  }

  // One link of the chain, written as it happens.
  step(itemId: string, kind: Step['kind'], who: Step['who'], text: string) {
    this.store.addStep(itemId, { kind, who, text, at: this.#now().toISOString() });
  }

  // The chain of a piece: the steps written as they happened, the chat about it, and, for a piece older than the
  // steps table, what its fields still tell.
  chain(item: Item): Step[] {
    const stored = this.store.steps(item.id);
    const talk: Step[] = this.store.chatAbout(item.id).map(m => m.role === 'user'
      ? { kind: 'asked', who: 'you', text: `${(m.agent as string) === 'team' ? 'To the team' : `To the ${m.agent}`}: ${cut(m.text, 160)}`, at: m.at }
      : { kind: 'answered', who: m.agent, text: cut(m.text, 160), at: m.at });
    const steps = stored.length ? stored : this.#derived(item);
    return [...steps, ...talk].sort((a, b) => a.at.localeCompare(b.at));
  }

  #derived(item: Item): Step[] {
    const out: Step[] = [];
    const born = item.createdAt;
    if (item.origin === 'ai') out.push({ kind: 'proposed', who: 'strategist', text: cut(item.rationale.split('\nEvidence: ')[0]) || 'Proposed it', at: born });
    else out.push({ kind: 'added', who: 'you', text: item.origin === 'dev' ? 'Came from the dev workflow' : 'Added it yourself', at: born });
    if (item.status === 'rejected') out.push({ kind: 'refused', who: 'you', text: item.rejectedReason ? `Refused: ${item.rejectedReason}` : 'Refused it', at: born });
    else if (item.status !== 'idea') out.push({ kind: 'accepted', who: 'you', text: 'Said yes', at: born });
    if (item.revisions > 0) out.push({ kind: 'drafted', who: 'writer', text: item.revisions > 1 ? `Wrote it, ${item.revisions} versions` : 'Wrote the first draft', at: born });
    for (const s of item.media?.slides ?? []) if (s.file) out.push({ kind: 'picture', who: 'you', text: `Generated a picture: ${cut(s.visual, 80)}`, at: born });
    for (const v of this.store.versions(item.id)) out.push({ kind: 'approved', who: 'you', text: 'Signed it off', at: v.createdAt });
    if (item.status === 'approved' && this.store.versions(item.id).length === 0) out.push({ kind: 'approved', who: 'you', text: 'Signed it off', at: born });
    if (item.status === 'published') out.push({ kind: 'posted', who: 'you', text: 'Posted it', at: item.publishedAt ?? born });
    return out;
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
    const item = this.store.updateItem(itemId, { status: i.draft ? 'drafted' : 'briefed' });
    this.step(itemId, 'accepted', 'you', i.draft ? 'Said yes: the draft is back for review' : 'Said yes: the Writer may write it');
    return item;
  }

  reject(itemId: string, reason: string): Item {
    this.#needItem(itemId);
    const item = this.store.updateItem(itemId, { status: 'rejected', rejectedReason: reason });
    this.step(itemId, 'refused', 'you', reason.trim() ? `Said no: ${cut(reason)}` : 'Said no');
    return item;
  }

  // A refusal is not final: the piece comes back as an idea, its reason kept in the chain.
  restore(itemId: string): Item {
    const i = this.#needItem(itemId);
    if (i.status !== 'rejected') throw new Error('only a refused piece can be taken back');
    const item = this.store.updateItem(itemId, { status: 'idea', rejectedReason: undefined });
    this.step(itemId, 'restored', 'you', i.rejectedReason ? `Took it back (had refused: ${cut(i.rejectedReason, 80)})` : 'Took it back');
    return item;
  }

  // Decline a piece into a new one: same line, new round. The child starts as
  // an idea so the manager decides again; the link remembers where it came from.
  reuseItem(itemId: string): Item {
    const parent = this.#needItem(itemId);
    const child = this.store.addItem({
      projectId: parent.projectId, milestoneId: parent.milestoneId, kind: parent.kind, title: parent.title, brief: parent.brief,
      draft: parent.draft, seriesId: parent.seriesId, rationale: `Reused from "${parent.title}".`, source: parent.source,
      origin: 'user', status: 'idea', createdAt: this.#now().toISOString(),
    });
    this.store.linkItems(parent.id, child.id, 'reuse', this.#now().toISOString());
    this.step(child.id, 'reused', 'you', `Started again from "${parent.title}"`);
    return child;
  }

  series(projectId: string): Series[] {
    return this.store.series(projectId);
  }

  saveSeries(projectId: string, name: string): Series {
    return this.store.saveSeries(projectId, name, this.#now().toISOString());
  }

  setItemSeries(itemId: string, seriesId: string | null): Item {
    const item = this.#needItem(itemId);
    if (seriesId && this.store.series(item.projectId).every(s => s.id !== seriesId)) throw new Error('unknown series in this project');
    this.store.setItemSeries(itemId, seriesId);
    return this.store.item(itemId)!;
  }

  // The real post a posted piece looks like: same first words, or same platform within three days of the
  // posting date. The first is certain and linked on its own; the second is offered, the manager confirms.
  #candidate(item: Item, posts: AccountPost[]): { post: AccountPost; sure: boolean; why: string } | undefined {
    const head = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 40);
    const mine = head(item.draft);
    const when = (item.publishedAt ?? '').slice(0, 10) || item.fixedDate || '';
    const channel = (item.pitch?.channel ?? '').toLowerCase();
    const free = posts.filter(p => p.id != null && !p.simulated && (!p.itemId || p.itemId === item.id));
    const byText = mine.length >= 20 && free.find(p => head(p.text) === mine);
    if (byText) return { post: byText, sure: true, why: 'same first words' };
    if (!when) return undefined;
    const near = free.filter(p => Math.abs(daysBetween(when, p.postedAt)) <= 3 && (!channel || channel.includes((p.platform ?? 'instagram').toLowerCase())))
      .sort((a, b) => Math.abs(daysBetween(when, a.postedAt)) - Math.abs(daysBetween(when, b.postedAt)));
    return near[0] ? { post: near[0], sure: false, why: `posted on ${near[0].platform ?? 'instagram'} ${near[0].postedAt === when ? 'the same day' : `${Math.abs(Math.round(daysBetween(when, near[0].postedAt)))} day(s) apart`}` } : undefined;
  }

  // After the account is read: every posted piece whose text is found as a real post is tied to it, silently.
  // The rest is left for the manager (see `match` on the calendar).
  autoMatch(projectId: string): number {
    const posts = this.store.account(projectId);
    let n = 0;
    for (const item of this.store.items(projectId).filter(i => i.status === 'published')) {
      if (posts.some(p => p.itemId === item.id)) continue;
      const c = this.#candidate(item, posts);
      if (!c || !c.sure) continue;
      this.store.linkPost(c.post.id!, item.id);
      this.step(item.id, 'matched', 'analyst', `Found it on ${c.post.platform ?? 'instagram'} (${c.why}): ${c.post.likes} likes, ${c.post.comments} comments`);
      n++;
    }
    return n;
  }

  // The manager says "yes, that is it": the piece and the real post are one.
  confirmMatch(itemId: string, postId: number): Item {
    const item = this.#needItem(itemId);
    const post = this.store.account(item.projectId).find(p => p.id === postId);
    if (!post) throw new Error('unknown post');
    this.store.linkPost(postId, itemId);
    this.step(itemId, 'matched', 'you', `Tied it to the real post on ${post.platform ?? 'instagram'} (${post.postedAt})`);
    return this.store.item(itemId)!;
  }

  // What a posted piece got, once tied to its real post; or the post that looks like it, to confirm.
  #afterPosting(item: Item, posts: AccountPost[]): { outcome?: Outcome; match?: Match } {
    if (item.status !== 'published') return {};
    const linked = posts.find(p => p.itemId === item.id);
    if (linked) return { outcome: { postId: linked.id!, platform: linked.platform ?? 'instagram', text: linked.text, postedAt: linked.postedAt, likes: linked.likes, comments: linked.comments, shares: linked.shares, saves: linked.saves, views: linked.views, daysSince: Math.max(0, Math.round(daysBetween(linked.postedAt, day(this.#now())))) } };
    const c = this.#candidate(item, posts);
    return c ? { match: { postId: c.post.id!, platform: c.post.platform ?? 'instagram', text: c.post.text, postedAt: c.post.postedAt, why: c.why } } : {};
  }

  // Tie a posted piece back to the studio item it came from, so the next
  // account analysis can learn from what worked.
  linkPost(projectId: string, postId: number, itemId: string | null): void {
    const posts = this.store.account(projectId);
    if (!posts.some(p => p.id === postId)) throw new Error('unknown post');
    if (itemId && this.store.item(itemId)?.projectId !== projectId) throw new Error('unknown piece in this project');
    this.store.linkPost(postId, itemId);
  }

  async draft(itemId: string, guidance?: string, commits: string[] = []): Promise<Item> {
    const item = this.#needItem(itemId);
    const milestone = item.milestoneId ? this.store.milestone(item.milestoneId) : undefined;
    const ids = [...(milestone?.featureIds ?? []), ...(item.featureId ? [item.featureId] : [])];
    const ctx = { item, milestone, profile: this.store.profile(item.projectId), features: this.#facts([...new Set(ids)]), commits, guidance };
    if (guidance) this.step(itemId, 'asked', 'you', `Direction for the Writer: ${cut(guidance)}`);
    let out: Item;
    if (SOCIAL.includes(item.kind)) {
      const { caption, media } = await draftPost(this.#llm, ctx);
      out = this.store.updateItem(itemId, { draft: caption, media, status: 'drafted', revisions: item.revisions + 1 });
    } else out = this.store.updateItem(itemId, { draft: await draftItem(this.#llm, ctx), status: 'drafted', revisions: item.revisions + 1 });
    this.step(itemId, 'drafted', 'writer', item.revisions === 0 ? `Wrote the first draft: “${cut(out.draft, 90)}”` : `Rewrote it (version ${item.revisions + 1}): “${cut(out.draft, 90)}”`);
    return out;
  }

  async revise(itemId: string, instruction: string): Promise<Item> {
    const item = this.#needItem(itemId);
    if (!item.draft) throw new Error('nothing to revise yet: draft it first');
    const profile = this.store.profile(item.projectId);
    this.step(itemId, 'asked', 'you', `Asked for a change: ${cut(instruction)}`);
    let out: Item;
    if (SOCIAL.includes(item.kind)) {
      const { caption, media } = await revisePost(this.#llm, { item, instruction, profile });
      out = this.store.updateItem(itemId, { draft: caption, media, status: 'drafted', revisions: item.revisions + 1 });
    } else out = this.store.updateItem(itemId, { draft: await reviseItem(this.#llm, { item, instruction, profile }), status: 'drafted', revisions: item.revisions + 1 });
    this.step(itemId, 'revised', 'writer', `Revised it (version ${item.revisions + 1}): “${cut(out.draft, 90)}”`);
    return out;
  }

  editItem(itemId: string, patch: Partial<Pick<Item, 'title' | 'brief' | 'draft' | 'kind' | 'offsetDays' | 'fixedDate' | 'milestoneId' | 'media'>> & { clearFixedDate?: boolean; seriesId?: string | null }): Item {
    const item = this.#needItem(itemId);
    if (patch.media) patch = { ...patch, media: { ...patch.media, hashtags: normalizeHashtags(patch.media.hashtags) } };
    const edited = (patch.draft !== undefined && patch.draft !== item.draft) || (patch.media !== undefined && JSON.stringify(patch.media) !== JSON.stringify(item.media));
    const status = edited ? 'drafted' : item.status === 'idea' && patch.brief?.trim() ? 'briefed' : item.status;
    const out = this.store.updateItem(itemId, { ...patch, status });
    if (patch.draft !== undefined && patch.draft !== item.draft) this.step(itemId, 'edited', 'you', 'Changed the text by hand');
    else if (patch.brief !== undefined && patch.brief !== item.brief) this.step(itemId, 'edited', 'you', `Changed what it should say: ${cut(patch.brief)}`);
    return out;
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
    this.store.snapshotVersion(itemId, this.#now().toISOString()); // keep what was signed off: the piece can be declined later
    const out = this.store.updateItem(itemId, { status: 'approved', exportedPath: file });
    this.step(itemId, 'approved', 'you', `Signed it off${item.revisions > 1 ? ` after ${item.revisions} versions` : ''}`);
    return out;
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

  // How a piece leaves the studio. Local and assisted just record that the
  // manager posted it by hand (in the app, or via a scheduler): nothing
  // depends on a Meta app. Connected posts through the configured publisher
  // and fails loudly when none is set up, instead of pretending it worked.
  async publish(itemId: string, mode?: PublishMode): Promise<Item> {
    const item = this.#needItem(itemId);
    if (item.status !== 'approved') throw new Error('approve it first');
    const how = mode ?? this.store.profile(item.projectId).publishMode;
    if (how === 'connected') {
      if (!this.#publisher) throw new Error('connected publishing needs a Meta app, which is not set up: post it where your audience lives, then mark it posted by hand instead');
      if (SOCIAL.includes(item.kind)) await this.#publisher.publish({ caption: this.exportPack(itemId).copyText, imagePath: (item.media?.slides[0]?.file && this.mediaPath(item.id, item.media.slides[0].file)) || '' });
    }
    const out = this.store.updateItem(itemId, { status: 'published', publishedAt: this.#now().toISOString() });
    this.step(itemId, 'posted', 'you', how === 'connected' ? 'Posted through the connected account' : 'Posted it by hand and marked it here');
    return out;
  }

  // The ready-to-post pack: the exact text to paste (caption, then
  // hashtags), the media files to attach, and where the signed-off copy
  // lives. Works with no Meta app involved.
  exportPack(itemId: string): ExportPack {
    const item = this.#needItem(itemId);
    if (!item.draft.trim()) throw new Error('there is nothing to export: draft it first');
    const hashtags = item.media?.hashtags ?? [];
    return {
      caption: item.draft,
      hashtags,
      copyText: [item.draft, hashtags.join(' ')].filter(Boolean).join('\n\n'),
      mediaFiles: (item.media?.slides ?? []).map(s => s.file).filter((f): f is string => Boolean(f)),
      exportedPath: item.exportedPath,
    };
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
    const out = this.store.updateItem(itemId, { media: { ...media, slides } });
    this.step(itemId, 'picture', 'you', `Generated picture ${index + 1}: ${cut(prompt, 80)}`);
    return out;
  }

  // The manager's own picture on a slide: a real photo instead of a generated one. No model call.
  uploadSlide(itemId: string, index: number, data: Buffer, type: string): Item {
    const item = this.#needItem(itemId);
    const media = item.media;
    if (!media || !media.slides[index]) throw new Error('unknown slide');
    const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : type === 'image/jpeg' ? 'jpg' : '';
    if (!ext) throw new Error('use a JPEG, PNG or WebP picture');
    if (data.length > 8 * 1024 * 1024) throw new Error('picture too big: 8 MB at most');
    const dir = join(this.#mediaDir, itemId);
    mkdirSync(dir, { recursive: true });
    const file = `${index + 1}-${Date.now().toString(36)}.${ext}`;
    writeFileSync(join(dir, file), data);
    const slides = media.slides.map((x, i) => i === index ? { ...x, file } : x);
    const out = this.store.updateItem(itemId, { media: { ...media, slides } });
    this.step(itemId, 'picture', 'you', `Put your own picture on ${media.format === 'video' ? 'shot' : 'slide'} ${index + 1}`);
    return out;
  }

  // Everything approved, ready for a scheduler: one ZIP with a CSV (date, channel, title, caption, hashtags,
  // media files) and every picture in a folder per piece. Stored entries, no compression: pictures are JPEGs already.
  weekPack(projectId: string): { name: string; zip: Buffer; count: number } {
    const items = this.calendar(projectId).filter(i => i.status === 'approved' && i.draft.trim());
    const files: Array<{ name: string; data: Buffer }> = [];
    const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = ['date,channel,title,caption,hashtags,media'];
    for (const i of items) {
      const slug = i.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || i.id;
      const media: string[] = [];
      for (const s of i.media?.slides ?? []) {
        const src = s.file && this.mediaPath(i.id, s.file);
        if (src) { const name = `${slug}/${s.file}`; media.push(name); files.push({ name, data: readFileSync(src) }); }
      }
      const tags = (i.media?.hashtags ?? []).join(' ');
      rows.push([i.date ?? '', i.pitch?.channel ?? '', i.title, i.draft, tags, media.join(' ')].map(q).join(','));
      files.push({ name: `${slug}/caption.txt`, data: Buffer.from([i.draft, tags].filter(Boolean).join('\n\n'), 'utf8') });
    }
    files.unshift({ name: 'posts.csv', data: Buffer.from('\ufeff' + rows.join('\n') + '\n', 'utf8') });
    return { name: `ripple-${projectId}-${day(this.#now())}.zip`, zip: zipStored(files, this.#now()), count: items.length };
  }

  async generateMissing(itemId: string): Promise<Item> {
    let item = this.#needItem(itemId);
    for (const [i, s] of (item.media?.slides ?? []).entries()) if (!s.file) item = await this.generateSlide(itemId, i);
    return item;
  }

  // The video of a storyboard, assembled from its keyframes with ffmpeg. No model call, so no cost.
  async renderVideo(itemId: string): Promise<void> {
    const item = this.#needItem(itemId);
    const slides = item.media?.slides ?? [];
    if (item.media?.format !== 'video' || slides.length === 0) throw new Error('this post is not a video');
    const missing = slides.findIndex(s => !s.file);
    if (missing >= 0) throw new Error(`shot ${missing + 1} has no keyframe yet: generate it first`);
    await renderVideo(slides.map(s => ({ image: this.mediaPath(itemId, s.file!)!, seconds: s.seconds, text: s.text })), this.videoPath(itemId));
  }

  videoPath(itemId: string): string { return join(this.#mediaDir, itemId, 'video.mp4'); }

  // Thumbnails of field examples, fetched once from their page. Not an item folder: mediaPath never serves it.
  get thumbDir(): string { return join(this.#mediaDir, '_thumbs'); }

  mediaPath(itemId: string, file: string): string | undefined {
    if (!/^[\w.-]+$/.test(file)) return undefined;
    const path = join(this.#mediaDir, itemId, file);
    return this.store.item(itemId)?.media?.slides.some(s => s.file === file) && existsSync(path) ? path : undefined;
  }

  // --- the calendar: every item with the date it is due now
  schedule(item: Item, posts: AccountPost[] = this.store.account(item.projectId)): ScheduledItem {
    const memory = { reusedFrom: this.store.parentsOf(item.id).map(p => p.title).join(', ') || undefined, versionCount: this.store.versions(item.id).length, chain: this.chain(item), ...this.#afterPosting(item, posts) };
    if (item.fixedDate) return { ...item, ...memory, date: item.fixedDate, plannedDate: item.fixedDate, shiftDays: 0 };
    const m = item.milestoneId ? this.store.milestone(item.milestoneId) : undefined;
    if (!m) return { ...item, ...memory };
    const forecast = this.store.forecasts(m.id).at(-1);
    const offset = item.offsetDays ?? 0;
    const anchor = m.status === 'done' && m.doneAt ? m.doneAt.slice(0, 10) : forecast?.predictedDate ?? m.targetDate;
    const date = addDays(anchor, offset);
    const plannedDate = addDays(m.targetDate, offset);
    return { ...item, ...memory, date, plannedDate, shiftDays: Math.round(daysBetween(plannedDate, date)) };
  }

  calendar(projectId: string): ScheduledItem[] {
    const posts = this.store.account(projectId);
    return this.store.items(projectId).map(i => this.schedule(i, posts)).sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
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

// A pasted analytics export, read exactly: no model call, no invented numbers. Two shapes are known:
// our own CSV (text,format,likes,comments,shares,saves,views,posted_at, any order, extra columns ignored)
// and the sheet of a LinkedIn Page export ("Mises à jour" / "Updates": title, date, impressions, reactions,
// comments, reposts…), pasted from the spreadsheet with tabs or commas, in French or English.
// Returns undefined when the text is not such a table, so the caller can fall back to the model for free-form pastes.
const COLUMNS: Record<string, string[]> = {
  text: ['text', 'texte', 'titre de la mise à jour', 'update title', 'post title', 'titre', 'title', 'caption', 'légende'],
  format: ['format', 'type', 'type de contenu', 'content type'],
  likes: ['likes', 'réactions', 'reactions', "j'aime", 'j’aime', 'likes count'],
  comments: ['comments', 'commentaires'],
  shares: ['shares', 'republications', 'reposts', 'partages'],
  saves: ['saves', 'enregistrements', 'saved'],
  views: ['views', 'impressions', 'vues', 'reach', 'portée', 'impressions (total)'],
  posted_at: ['posted_at', 'date', 'date de création', 'created date', 'date de publication', 'published date', 'posted'],
};
export function parseAccountCsv(pasted: string, today: string): AccountPost[] | undefined {
  const lines = pasted.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
  if (lines.length < 2) return undefined;
  // The header is the first line that names a text column and a likes column; a LinkedIn export puts a note above it.
  const norm = (h: string) => h.trim().toLowerCase().replace(/^"|"$/g, '').replace(/\s+/g, ' ');
  let headerAt = -1, sep = ',', header: string[] = [];
  for (let i = 0; i < Math.min(lines.length - 1, 6) && headerAt < 0; i++) {
    for (const d of [lines[i].includes('\t') ? '\t' : ',']) {
      const cells = split(lines[i], d).map(norm);
      if (COLUMNS.text.some(a => cells.includes(a)) && COLUMNS.likes.some(a => cells.includes(a))) { headerAt = i; sep = d; header = cells; }
    }
  }
  if (headerAt < 0) return undefined;
  const idx = (col: string) => header.findIndex(h => COLUMNS[col].includes(h));
  const cell = (cells: string[], col: string) => { const i = idx(col); return i < 0 || i >= cells.length ? '' : cells[i].trim().replace(/^"|"$/g, ''); };
  const num = (cells: string[], col: string) => { const n = Number(cell(cells, col).replace(/[^\d]/g, '')); return Number.isInteger(n) && n >= 0 ? n : 0; };
  const posts: AccountPost[] = [];
  for (const line of lines.slice(headerAt + 1)) {
    const cells = split(line, sep);
    const text = cell(cells, 'text');
    if (!text) continue;
    const views = idx('views') >= 0 ? num(cells, 'views') : undefined;
    posts.push({
      text, format: cell(cells, 'format').toLowerCase() || 'post',
      likes: num(cells, 'likes'), comments: num(cells, 'comments'), shares: num(cells, 'shares'), saves: num(cells, 'saves'),
      ...(views !== undefined ? { views } : {}),
      postedAt: parseDay(cell(cells, 'posted_at')) ?? today,
      simulated: false,
    });
  }
  return posts.length ? posts : undefined;
}

// A date as the exports write it: 2026-10-30, 30/10/2026 (French), 10/30/2026 (US, when the first number cannot be a day), or anything Date.parse reads.
export function parseDay(s: string): string | undefined {
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const [d, mo] = a > 12 || b <= 12 ? [a, b] : [b, a];
    return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10);
}

// One row, honouring double-quoted cells that contain the separator.
function split(line: string, sep = ','): string[] {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// A ZIP with stored entries (no compression), enough for any scheduler or file manager to open.
function zipStored(files: Array<{ name: string; data: Buffer }>, at: Date): Buffer {
  const dosTime = ((at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate()) & 0xffff;
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.data.length, 18); local.writeUInt32LE(f.data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12); central.writeUInt16LE(dosDate, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(f.data.length, 20); central.writeUInt32LE(f.data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, name, f.data);
    centrals.push(central, name);
    offset += local.length + name.length + f.data.length;
  }
  const dirSize = centrals.reduce((a, b) => a + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirSize, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}
