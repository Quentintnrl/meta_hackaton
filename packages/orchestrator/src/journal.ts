import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface JournalEntry {
  id: number;
  featureId: string;
  type: string;
  payload: unknown;
  at: string;
}

// Append-only event log: the timeline shown in the console is a read of this table.
export class Journal {
  #db: DatabaseSync;

  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feature_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      at TEXT NOT NULL
    )`);
  }

  append(featureId: string, type: string, payload: unknown = {}): JournalEntry {
    const at = new Date().toISOString();
    const r = this.#db
      .prepare('INSERT INTO events (feature_id, type, payload, at) VALUES (?, ?, ?, ?)')
      .run(featureId, type, JSON.stringify(payload), at);
    return { id: Number(r.lastInsertRowid), featureId, type, payload, at };
  }

  list(featureId?: string): JournalEntry[] {
    const rows = (featureId
      ? this.#db.prepare('SELECT * FROM events WHERE feature_id = ? ORDER BY id').all(featureId)
      : this.#db.prepare('SELECT * FROM events ORDER BY id').all()) as Array<Record<string, string | number>>;
    return rows.map(r => ({
      id: Number(r.id),
      featureId: String(r.feature_id),
      type: String(r.type),
      payload: JSON.parse(String(r.payload)),
      at: String(r.at),
    }));
  }
}
