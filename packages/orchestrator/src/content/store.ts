import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { defaultProfile, type Forecast, type Item, type Milestone, type Profile } from './types.ts';

type Row = Record<string, string | number | null>;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'milestone';

// Roadmap, forecasts and content items of every project. Plain SQLite, like the journal.
export class ContentStore {
  #db: DatabaseSync;

  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (project_id TEXT PRIMARY KEY, voice TEXT NOT NULL, audience TEXT NOT NULL, language TEXT NOT NULL, auto_draft INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS milestones (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, intent TEXT NOT NULL, target_date TEXT NOT NULL, start_date TEXT NOT NULL, scope INTEGER NOT NULL, status TEXT NOT NULL, done_at TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS milestone_features (milestone_id TEXT NOT NULL, feature_id TEXT NOT NULL, PRIMARY KEY (milestone_id, feature_id));
      CREATE TABLE IF NOT EXISTS forecasts (id INTEGER PRIMARY KEY AUTOINCREMENT, milestone_id TEXT NOT NULL, made_at TEXT NOT NULL, predicted_date TEXT NOT NULL, raw_remaining_days REAL NOT NULL, calibration REAL NOT NULL, done INTEGER NOT NULL, scope INTEGER NOT NULL, confidence TEXT NOT NULL, note TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, milestone_id TEXT, feature_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, brief TEXT NOT NULL, draft TEXT NOT NULL, status TEXT NOT NULL, offset_days INTEGER, fixed_date TEXT, origin TEXT NOT NULL, revisions INTEGER NOT NULL, exported_path TEXT, published_at TEXT, created_at TEXT NOT NULL);
    `);
  }

  // --- profile
  profile(projectId: string): Profile {
    const r = this.#db.prepare('SELECT * FROM profiles WHERE project_id = ?').get(projectId) as Row | undefined;
    return r ? { voice: String(r.voice), audience: String(r.audience), language: String(r.language), autoDraft: r.auto_draft === 1 } : { ...defaultProfile };
  }

  setProfile(projectId: string, p: Profile): Profile {
    this.#db.prepare('INSERT OR REPLACE INTO profiles (project_id, voice, audience, language, auto_draft) VALUES (?, ?, ?, ?, ?)').run(projectId, p.voice, p.audience, p.language, p.autoDraft ? 1 : 0);
    return p;
  }

  // --- milestones
  addMilestone(m: Omit<Milestone, 'id' | 'status' | 'featureIds' | 'createdAt'> & { createdAt: string }): Milestone {
    let id = slug(m.title);
    for (let n = 2; this.milestone(id); n++) id = `${slug(m.title)}-${n}`;
    this.#db.prepare("INSERT INTO milestones (id, project_id, title, intent, target_date, start_date, scope, status, done_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', NULL, ?)")
      .run(id, m.projectId, m.title, m.intent, m.targetDate, m.startDate, m.scope, m.createdAt);
    return this.milestone(id)!;
  }

  milestone(id: string): Milestone | undefined {
    const r = this.#db.prepare('SELECT * FROM milestones WHERE id = ?').get(id) as Row | undefined;
    return r && this.#milestone(r);
  }

  milestones(projectId?: string): Milestone[] {
    const rows = (projectId
      ? this.#db.prepare('SELECT * FROM milestones WHERE project_id = ? ORDER BY target_date, rowid').all(projectId)
      : this.#db.prepare('SELECT * FROM milestones ORDER BY target_date, rowid').all()) as Row[];
    return rows.map(r => this.#milestone(r));
  }

  updateMilestone(id: string, patch: Partial<Pick<Milestone, 'title' | 'intent' | 'targetDate' | 'scope' | 'status' | 'doneAt'>>) {
    const m = this.milestone(id);
    if (!m) throw new Error(`unknown milestone ${id}`);
    const n = { ...m, ...patch };
    this.#db.prepare('UPDATE milestones SET title = ?, intent = ?, target_date = ?, scope = ?, status = ?, done_at = ? WHERE id = ?')
      .run(n.title, n.intent, n.targetDate, n.scope, n.status, n.doneAt ?? null, id);
    return this.milestone(id)!;
  }

  removeMilestone(id: string) {
    for (const t of ['milestone_features', 'forecasts']) this.#db.prepare(`DELETE FROM ${t} WHERE milestone_id = ?`).run(id);
    this.#db.prepare('UPDATE items SET milestone_id = NULL, offset_days = NULL WHERE milestone_id = ?').run(id);
    this.#db.prepare('DELETE FROM milestones WHERE id = ?').run(id);
  }

  link(milestoneId: string, featureId: string) {
    this.#db.prepare('INSERT OR IGNORE INTO milestone_features (milestone_id, feature_id) VALUES (?, ?)').run(milestoneId, featureId);
  }

  unlink(milestoneId: string, featureId: string) {
    this.#db.prepare('DELETE FROM milestone_features WHERE milestone_id = ? AND feature_id = ?').run(milestoneId, featureId);
  }

  milestonesOfFeature(featureId: string): Milestone[] {
    const rows = this.#db.prepare('SELECT m.* FROM milestones m JOIN milestone_features f ON f.milestone_id = m.id WHERE f.feature_id = ?').all(featureId) as Row[];
    return rows.map(r => this.#milestone(r));
  }

  // --- forecasts
  addForecast(f: Omit<Forecast, 'id'>): Forecast {
    const r = this.#db.prepare('INSERT INTO forecasts (milestone_id, made_at, predicted_date, raw_remaining_days, calibration, done, scope, confidence, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(f.milestoneId, f.madeAt, f.predictedDate, f.rawRemainingDays, f.calibration, f.done, f.scope, f.confidence, f.note);
    return { ...f, id: Number(r.lastInsertRowid) };
  }

  forecasts(milestoneId: string): Forecast[] {
    return (this.#db.prepare('SELECT * FROM forecasts WHERE milestone_id = ? ORDER BY id').all(milestoneId) as Row[]).map(r => ({
      id: Number(r.id), milestoneId: String(r.milestone_id), madeAt: String(r.made_at), predictedDate: String(r.predicted_date),
      rawRemainingDays: Number(r.raw_remaining_days), calibration: Number(r.calibration), done: Number(r.done), scope: Number(r.scope),
      confidence: r.confidence as Forecast['confidence'], note: String(r.note),
    }));
  }

  // Milestones that landed, oldest first, with the forecasts the AI made along the way.
  finished(projectId?: string): Array<{ doneAt: string; forecasts: Forecast[] }> {
    return this.milestones(projectId)
      .filter(m => m.status === 'done' && m.doneAt)
      .sort((a, b) => a.doneAt!.localeCompare(b.doneAt!))
      .map(m => ({ doneAt: m.doneAt!, forecasts: this.forecasts(m.id) }));
  }

  // --- items
  addItem(i: Omit<Item, 'id' | 'revisions' | 'draft' | 'status'> & { draft?: string; status?: Item['status'] }): Item {
    const id = randomUUID().slice(0, 8);
    this.#db.prepare('INSERT INTO items (id, project_id, milestone_id, feature_id, kind, title, brief, draft, status, offset_days, fixed_date, origin, revisions, exported_path, published_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?)')
      .run(id, i.projectId, i.milestoneId ?? null, i.featureId ?? null, i.kind, i.title, i.brief, i.draft ?? '', i.status ?? (i.brief.trim() ? 'briefed' : 'idea'), i.offsetDays ?? null, i.fixedDate ?? null, i.origin, i.createdAt);
    return this.item(id)!;
  }

  item(id: string): Item | undefined {
    const r = this.#db.prepare('SELECT * FROM items WHERE id = ?').get(id) as Row | undefined;
    return r && this.#item(r);
  }

  items(projectId?: string): Item[] {
    const rows = (projectId ? this.#db.prepare('SELECT * FROM items WHERE project_id = ? ORDER BY rowid').all(projectId) : this.#db.prepare('SELECT * FROM items ORDER BY rowid').all()) as Row[];
    return rows.map(r => this.#item(r));
  }

  updateItem(id: string, patch: Partial<Omit<Item, 'id' | 'projectId' | 'createdAt'>> & { clearFixedDate?: boolean }): Item {
    const i = this.item(id);
    if (!i) throw new Error(`unknown item ${id}`);
    const n = { ...i, ...patch };
    const fixed = patch.clearFixedDate ? null : n.fixedDate ?? null;
    this.#db.prepare('UPDATE items SET milestone_id = ?, feature_id = ?, kind = ?, title = ?, brief = ?, draft = ?, status = ?, offset_days = ?, fixed_date = ?, revisions = ?, exported_path = ?, published_at = ? WHERE id = ?')
      .run(n.milestoneId ?? null, n.featureId ?? null, n.kind, n.title, n.brief, n.draft, n.status, n.offsetDays ?? null, fixed, n.revisions, n.exportedPath ?? null, n.publishedAt ?? null, id);
    return this.item(id)!;
  }

  removeItem(id: string) {
    this.#db.prepare('DELETE FROM items WHERE id = ?').run(id);
  }

  #milestone(r: Row): Milestone {
    const featureIds = (this.#db.prepare('SELECT feature_id FROM milestone_features WHERE milestone_id = ? ORDER BY rowid').all(r.id as string) as Row[]).map(x => String(x.feature_id));
    return {
      id: String(r.id), projectId: String(r.project_id), title: String(r.title), intent: String(r.intent), targetDate: String(r.target_date),
      startDate: String(r.start_date), scope: Number(r.scope), status: r.status as Milestone['status'], doneAt: r.done_at ? String(r.done_at) : undefined,
      featureIds, createdAt: String(r.created_at),
    };
  }

  #item(r: Row): Item {
    return {
      id: String(r.id), projectId: String(r.project_id), milestoneId: r.milestone_id ? String(r.milestone_id) : undefined,
      featureId: r.feature_id ? String(r.feature_id) : undefined, kind: r.kind as Item['kind'], title: String(r.title), brief: String(r.brief),
      draft: String(r.draft), status: r.status as Item['status'], offsetDays: r.offset_days === null ? undefined : Number(r.offset_days),
      fixedDate: r.fixed_date ? String(r.fixed_date) : undefined, origin: r.origin as Item['origin'], revisions: Number(r.revisions),
      exportedPath: r.exported_path ? String(r.exported_path) : undefined, publishedAt: r.published_at ? String(r.published_at) : undefined,
      createdAt: String(r.created_at),
    };
  }
}
