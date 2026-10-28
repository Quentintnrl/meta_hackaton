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

// --- content: roadmap, projections, calendar
export type ItemKind = 'changelog' | 'release-notes' | 'devlog' | 'social-post' | 'teaser' | 'doc-update' | 'demo-script' | 'newsletter';
export const ITEM_KINDS: ItemKind[] = ['changelog', 'release-notes', 'devlog', 'social-post', 'teaser', 'doc-update', 'demo-script', 'newsletter'];
export type ItemStatus = 'idea' | 'briefed' | 'drafted' | 'approved' | 'published' | 'rejected';
export type ItemSource = 'trend' | 'account' | 'roadmap' | 'manager' | '';

export interface Forecast { id: number; madeAt: string; predictedDate: string; calibration: number; done: number; scope: number; confidence: 'low' | 'medium' | 'high'; note: string }
export interface Milestone {
  id: string; projectId: string; title: string; intent: string; targetDate: string; scope: number; status: 'open' | 'done'; doneAt?: string;
  featureIds: string[]; delivered: number; forecast?: Forecast; atRisk: boolean; slipDays: number; accuracy?: { errorDays: number };
}
export interface ContentItem {
  id: string; projectId: string; milestoneId?: string; featureId?: string; kind: ItemKind; title: string; brief: string; draft: string; status: ItemStatus;
  offsetDays?: number; fixedDate?: string; origin: 'user' | 'ai' | 'dev'; revisions: number; exportedPath?: string; rationale: string; source: ItemSource; rejectedReason?: string;
  date?: string; plannedDate?: string; shiftDays?: number;
}
export interface Profile { voice: string; audience: string; language: string; autoDraft: boolean; niche: string; directives: string }
export interface ContentView { profile: Profile; milestones: Milestone[]; items: ContentItem[] }

const send = <T>(method: string, path: string, body?: unknown) => call<T>(path, { method, body: JSON.stringify(body ?? {}) });

export type AgentId = 'scout' | 'analyst' | 'strategist' | 'writer';
export interface Audit { summary: string; whatWorks: Array<{ format: string; why: string; example: string }>; hooks: string[]; topics: string[]; avoid: string[]; sources: string[] }
export interface AccountReport { summary: string; strengths: string[]; gaps: string[]; opportunities: string[]; stats: Array<{ format: string; posts: number; avgEngagement: number }>; postCount: number }
export interface Report<T> { data: T; simulated: boolean; at: string }
export interface TeamView {
  agents: Array<{ id: AgentId; name: string; role: string }>;
  working?: { agent: AgentId; since: string };
  audit?: Report<Audit>; account?: Report<AccountReport>; accountPosts: number;
  activity: Array<{ id: number; agent: AgentId; summary: string; ok: boolean; at: string }>;
}

export const teamApi = {
  view: (pid: string) => call<TeamView>(`/projects/${pid}/team`),
  run: (pid: string, agents: AgentId[], brief: string) => send<{ ok: true }>('POST', `/projects/${pid}/team/run`, { agents, brief }),
  setAccount: (pid: string, b: { paste?: string; demo?: boolean }) => send<TeamView>('PUT', `/projects/${pid}/account`, b),
  accept: (id: string) => send<ContentItem>('POST', `/items/${id}/accept`),
  reject: (id: string, reason: string) => send<ContentItem>('POST', `/items/${id}/reject`, { reason }),
};

export const contentApi = {
  view: (pid: string) => call<ContentView>(`/projects/${pid}/content`),
  setProfile: (pid: string, p: Profile) => send<Profile>('PUT', `/projects/${pid}/profile`, p),
  addMilestone: (pid: string, b: { title: string; intent: string; targetDate: string; scope: number }) => send<Milestone>('POST', `/projects/${pid}/milestones`, b),
  patchMilestone: (id: string, b: Partial<{ title: string; intent: string; targetDate: string; scope: number }>) => send<Milestone>('PATCH', `/milestones/${id}`, b),
  removeMilestone: (id: string) => send<{ ok: true }>('DELETE', `/milestones/${id}`),
  markDone: (id: string) => send<Milestone>('POST', `/milestones/${id}/done`),
  forecasts: (id: string) => call<Forecast[]>(`/milestones/${id}/forecasts`),
  link: (id: string, featureId: string) => send<Milestone>('POST', `/milestones/${id}/features`, { featureId }),
  unlink: (id: string, featureId: string) => send<Milestone>('DELETE', `/milestones/${id}/features/${featureId}`),
  plan: (id: string, guidance?: string) => send<ContentItem[]>('POST', `/milestones/${id}/plan`, { guidance }),
  addItem: (pid: string, b: { kind: ItemKind; title: string; brief: string; milestoneId?: string; offsetDays?: number; fixedDate?: string }) => send<ContentItem>('POST', `/projects/${pid}/items`, b),
  patchItem: (id: string, b: Partial<Pick<ContentItem, 'title' | 'brief' | 'draft' | 'kind' | 'offsetDays' | 'fixedDate' | 'milestoneId'>> & { clearFixedDate?: boolean }) => send<ContentItem>('PATCH', `/items/${id}`, b),
  removeItem: (id: string) => send<{ ok: true }>('DELETE', `/items/${id}`),
  draft: (id: string, guidance?: string) => send<ContentItem>('POST', `/items/${id}/draft`, { guidance }),
  revise: (id: string, instruction: string) => send<ContentItem>('POST', `/items/${id}/revise`, { instruction }),
  approve: (id: string) => send<ContentItem>('POST', `/items/${id}/approve`),
  publish: (id: string) => send<ContentItem>('POST', `/items/${id}/publish`),
  fromGit: (pid: string, since?: string) => send<ContentItem>('POST', `/projects/${pid}/content/from-git`, { since: since || undefined }),
};
