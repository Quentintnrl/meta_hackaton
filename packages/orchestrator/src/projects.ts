import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Project {
  id: string;
  name: string;
  path: string;
  repoUrl: string; // empty for a repo that only exists locally
  source: 'link' | 'clone' | 'scratch';
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';

// The apps Ripple_handoff works on: a name, where the repo lives on disk, and its remote URL.
export class ProjectStore {
  #db: DatabaseSync;

  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec("CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, repo_url TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'link')");
    // Databases created before `source` existed.
    const cols = this.#db.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'source')) this.#db.exec("ALTER TABLE projects ADD COLUMN source TEXT NOT NULL DEFAULT 'link'");
  }

  // A free id for this name, so a repo can be provisioned under it before the project is registered.
  suggestId(name: string): string {
    let id = slug(name);
    for (let n = 2; this.get(id); n++) id = `${slug(name)}-${n}`;
    return id;
  }

  add(p: Omit<Project, 'id'> & { id?: string }): Project {
    const id = p.id ?? this.suggestId(p.name);
    this.#db.prepare('INSERT INTO projects (id, name, path, repo_url, source) VALUES (?, ?, ?, ?, ?)').run(id, p.name, p.path, p.repoUrl, p.source);
    return { ...p, id };
  }

  get(id: string): Project | undefined {
    const r = this.#db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, string> | undefined;
    return r && this.#row(r);
  }

  list(): Project[] {
    return (this.#db.prepare('SELECT * FROM projects ORDER BY rowid').all() as Array<Record<string, string>>).map(r => this.#row(r));
  }

  #row(r: Record<string, string>): Project {
    return { id: r.id, name: r.name, path: r.path, repoUrl: r.repo_url, source: r.source as Project['source'] };
  }

  remove(id: string) {
    this.#db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }
}
