export type Gate = 'plan' | 'visual' | 'merge' | 'publish' | 'teaser';
export type Autonomy = 'low' | 'medium' | 'high';

export interface Plan {
  summary: string;
  steps: Array<{ title: string; detail: string }>;
  options: Array<{ question: string; choices: string[]; recommended: string }>;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  repoUrl: string; // empty when the repo only exists locally
  source: 'link' | 'clone' | 'scratch';
}

export type NewProjectInput =
  | { source: 'link'; name: string; path: string }
  | { source: 'clone'; repoUrl: string; name?: string }
  | { source: 'scratch'; name: string; description?: string; github?: { visibility: 'private' | 'public' } };

export interface Box { x1: number; y1: number; x2: number; y2: number }
export interface ElementResult { phrase: string; status: 'match' | 'missing' | 'moved' | 'fewer' | 'inconclusive'; mockup: Box[]; app: Box[]; iou?: number }
export interface VisualReport { verdict: 'pass' | 'fail' | 'inconclusive'; feedback: string; elements: ElementResult[]; mockupFile: string; appFile: string; at: string }

export type FixKind = 'retry' | 'prune-worktrees' | 'reset-branch';
// A step that failed: where, why, and the one fix proposed. It waits for the user's answer.
export interface Failure {
  id: number;
  agent: string;
  message: string;
  cause: string;
  fix: { kind: FixKind; label: string; detail: string; destructive: boolean };
}

export interface Feature {
  id: string;
  projectId: string;
  title: string;
  design: string;
  state: string;
  plan?: Plan;
  build?: { branch: string; stat: string; diff?: string };
  merge?: { commit: string; pushed: boolean; pushError?: string };
  feedback?: string;
  visual?: VisualReport;
  hasMockup?: boolean;
  mockupFile?: string;
  before?: string;
  figma?: string;
  failure?: Failure;
  events?: JournalEntry[]; // only on the single-feature endpoint
}

export interface JournalEntry {
  id: number;
  featureId: string;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch('/api' + path, init && { ...init, headers: { 'content-type': 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}
const post = (path: string, body: unknown) => call<Feature>(path, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  journal: (after: number) => call<JournalEntry[]>(`/journal?after=${after}`),
  projects: () => call<Project[]>('/projects'),
  addProject: (b: NewProjectInput) => call<Project>('/projects', { method: 'POST', body: JSON.stringify(b) }),
  removeProject: (id: string) => call<{ ok: true }>(`/projects/${id}`, { method: 'DELETE' }),
  // A project contains its features.
  features: (projectId: string) => call<Feature[]>(`/projects/${projectId}/features`),
  createFeature: (projectId: string, b: { id: string; title: string; design: string; autonomy: Partial<Record<Gate, Autonomy>>; figma?: string }) =>
    post(`/projects/${projectId}/features`, b),
  rerunVisual: (id: string) => call<{ ok: true }>(`/features/${id}/visual/run`, { method: 'POST', body: '{}' }),
  get: (id: string) => call<Feature>(`/features/${id}`),
  recover: (id: string, action: 'apply' | 'dismiss', always?: boolean) => post(`/features/${id}/recovery`, { action, always }),
  autofix: () => call<FixKind[]>('/autofix'),
  stopAutofix: (kind: FixKind) => call<FixKind[]>(`/autofix/${kind}`, { method: 'DELETE' }),
  approve: (id: string, gate: Gate, push?: boolean) => post(`/features/${id}/approve`, { gate, push }),
  event: (id: string, type: 'VISUAL_OK' | 'VISUAL_DIFF' | 'MERGED', feedback?: string) => post(`/features/${id}/events`, { type, feedback }),
};

export const FLOW = ['DESIGN_DEFINED', 'PLANNED', 'BUILDING', 'VISUAL_CHECK', 'PR_READY', 'MERGING', 'APPLIED', 'FEEDBACK', 'ANNOUNCE_DRAFTED', 'PUBLISHING', 'PUBLISHED'];
export const label = (s: string) => s.toLowerCase().replace(/_/g, ' ');

// wait = needs the user, work = an agent is running, done = finished.
export type Tone = 'wait' | 'work' | 'done';
export function tone(state: string): Tone {
  if (state === 'PUBLISHED') return 'done';
  if (['PLANNED', 'VISUAL_CHECK', 'PR_READY', 'MERGE_FAILED', 'ANNOUNCE_DRAFTED'].includes(state)) return 'wait';
  return 'work';
}
