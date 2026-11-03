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
export type MediaFormat = 'image' | 'carousel' | 'video';
export interface Slide { kind: 'image' | 'video'; visual: string; text: string; seconds: number; file?: string }
export interface Media { format: MediaFormat; hashtags: string[]; slides: Slide[] }
export const SOCIAL_KINDS: ItemKind[] = ['social-post', 'teaser'];

export interface Pitch { hook: string; channel: string; measure: string; context?: string; audience?: string }
export type StepKind = 'proposed' | 'added' | 'accepted' | 'refused' | 'restored' | 'drafted' | 'revised' | 'edited' | 'picture' | 'approved' | 'posted' | 'matched' | 'reused' | 'asked' | 'answered';
export interface Step { kind: StepKind; who: AgentId | 'you'; text: string; at: string }
export interface ContentItem {
  media?: Media; pitch?: Pitch;
  id: string; projectId: string; milestoneId?: string; featureId?: string; kind: ItemKind; title: string; brief: string; draft: string; status: ItemStatus;
  offsetDays?: number; fixedDate?: string; origin: 'user' | 'ai' | 'dev'; revisions: number; createdAt: string; exportedPath?: string; rationale: string; proof?: Proof; source: ItemSource; rejectedReason?: string;
  seriesId?: string; date?: string; plannedDate?: string; shiftDays?: number; reusedFrom?: string; versionCount?: number;
  chain?: Step[]; // how it got here: every step, who did it, when
  outcome?: Outcome; // posted and tied to the real post: what it got
  match?: Match; // posted, not tied yet: the real post that looks like it
}
export interface Outcome { postId: number; platform: string; text: string; postedAt: string; likes: number; comments: number; shares: number; saves: number; views?: number; daysSince: number }
export interface Match { postId: number; platform: string; text: string; postedAt: string; why: string }
export type PublishMode = 'local' | 'assisted' | 'connected';
export interface Profile { voice: string; audience: string; language: string; autoDraft: boolean; autopilot?: boolean; niche: string; directives: string; publishMode: PublishMode; cadence?: Record<string, number> }
export interface ExportPack { copyText: string; caption: string; hashtags: string[]; mediaFiles: string[]; exportedPath?: string }
export interface Series { id: string; projectId: string; name: string; createdAt: string }
export interface AccountPost { id?: number; platform?: string; text: string; format: string; likes: number; comments: number; shares: number; saves: number; views?: number; postedAt: string; simulated: boolean; itemId?: string }
export interface ContentView { profile: Profile; milestones: Milestone[]; items: ContentItem[]; series: Series[] }

const send = <T>(method: string, path: string, body?: unknown) => call<T>(path, { method, body: JSON.stringify(body ?? {}) });

export type AgentId = 'director' | 'scout' | 'analyst' | 'strategist' | 'writer';
export interface AgentConfig { enabled: boolean; workers: number; instructions: string }
// What an agent offers after a question; nothing happens until the manager clicks. `by` is who offered it, `why` the one-line reason.
export interface SuggestedAction { kind: 'run' | 'configure' | 'talk' | 'generate' | 'revise' | 'rebrief' | 'propose' | 'date'; label: string; why?: string; by?: AgentId; agents?: AgentId[]; brief?: string; agent?: AgentId; enabled?: boolean; workers?: number; instructions?: string; itemId?: string; index?: number; instruction?: string; title?: string; hook?: string; channel?: string; pieceKind?: ItemKind; date?: string }
// `agent`: who answered; `basis`: what the answer leaned on, as labels.
export interface ChatMessage { id: number; thread: string; role: 'user' | 'agent'; text: string; actions: SuggestedAction[]; at: string; agent?: AgentId; basis?: string[] }
export type ChatBase = 'team' | AgentId;
export interface Synthesis { headline: string; points: string[]; next: string }
// A measured figure from the field. value 0 and unit '' mean none was found: the page says so.
export interface Figure { what: string; value: number; unit: string; source: string; period: string }
export const hasFigure = (f?: Figure): f is Figure => Boolean(f && (f.value > 0 || f.unit));
export interface Benchmark { name: string; value: number; unit: string; note: string; source: string }
export interface YourScore { value: number; posts: number; rank: number; of: number }
export interface Proof { format: string; yours?: YourScore; field?: Figure; text: string }
export type PlanLever = 'double-down' | 'fill-gap' | 'test' | 'keep';
export interface PlanLine { format: string; count: number; lever: PlanLever; why: string; yours?: YourScore; field?: Figure }
export interface Plan { period: string; headline: string; mix: PlanLine[]; cadence: string; next: string; basis: { posts: number; audited: boolean } }
export interface Audit { summary: string; whatWorks: Array<{ format: string; why: string; example: string; strength?: number; figure?: Figure; exampleUrl?: string; exampleFigure?: string }>; hooks: string[]; topics: string[]; avoid: string[]; misses?: Array<{ format: string; why: string; example: string }>; benchmarks?: Benchmark[]; sources: string[] }
export interface VerdictPost { text: string; format: string; engagement: number; note: string }
export interface AccountReport { summary: string; strengths: string[]; gaps: string[]; opportunities: string[]; stats: Array<{ format: string; posts: number; avgEngagement: number }>; postCount: number; winners?: VerdictPost[]; losers?: VerdictPost[]; fixes?: Fix[]; readings?: Reading[] }
export interface Reading { fact: 'pace' | 'trend' | 'question' | 'length' | 'weekday' | 'words' | 'reach' | 'hooks'; meaning: string; action: string }
export interface Fix { problem: string; fix: string; firstStep: string }
export interface Group { n: number; avg: number }
export interface Facts {
  n: number; first: string; last: string; perMonth: number; daysSinceLast: number;
  silences: Array<{ from: string; to: string; days: number }>;
  trend: { early: Group; late: Group; last5: Group; direction: 'up' | 'down' | 'flat' };
  question: { asked: Group; not: Group };
  length: Array<{ label: 'short' | 'medium' | 'long'; max: number } & Group>;
  weekday: Array<{ day: number } & Group>;
  hooks: Array<{ kind: 'question' | 'number' | 'you' | 'other' } & Group>;
  words: Array<{ word: string; best: number; rest: number }>;
  reach: Array<{ text: string; views: number; likes: number; shares: number; rate: number; postedAt: string }>;
  best: { text: string; likes: number; postedAt: string; platform: string }; worst: { text: string; likes: number; postedAt: string; platform: string };
  comments: number; thin: boolean;
}
export interface Report<T> { data: T; simulated: boolean; at: string }
// What the Scout saw at comparable players, each find with its link.
export interface Find { title: string; url: string; account: string; platform: string; whatItIs: string; number: string; whyForYou: string; format: string }
export interface Strategy { rhythm: string; formats: string; subjects: string; tone: string; voices: string; callsToAction: string; lesson: string }
export interface Player { name: string; url: string; what: string; place?: string; size?: string; audience?: string; channels?: string; publishes?: string; strength?: string; opening?: string; strategy?: Strategy }
export interface Event { name: string; when: string; why: string; post?: string }
export interface Watch { market: string; players: Player[]; finds: Find[]; events: Event[]; sources: string[]; trail?: string[] }
export interface Snapshot { at: string; platform: string; followers: number; posts: number }
export interface TeamView {
  agents: Array<{ id: AgentId; name: string; role: string }>;
  working?: { agent: AgentId; since: string };
  config: Record<AgentId, AgentConfig>; synthesis?: Report<Synthesis>; plan?: Report<Plan>;
  posts: Array<{ text: string; format: string; engagement: number; postedAt: string }>;
  audit?: Report<Audit>; audits?: Array<Report<Audit>>; account?: Report<AccountReport>; accountPosts: number; facts: Facts | null;
  watch?: Report<Watch>; snapshots: Snapshot[]; duty: { autopilot: boolean; lastPass?: string }; connected: { instagram: boolean };
  activity: Array<{ id: number; agent: AgentId; summary: string; ok: boolean; at: string }>;
}

export const teamApi = {
  view: (pid: string) => call<TeamView>(`/projects/${pid}/team`),
  run: (pid: string, agents: AgentId[], brief: string) => send<{ ok: true }>('POST', `/projects/${pid}/team/run`, { agents, brief }),
  stop: (pid: string) => send<{ ok: true; stopped: boolean }>('POST', `/projects/${pid}/team/stop`),
  setAccount: (pid: string, b: { paste?: string; demo?: boolean; platform?: string; followers?: number }) => send<TeamView>('PUT', `/projects/${pid}/account`, b),
  sync: (pid: string) => send<TeamView>('POST', `/projects/${pid}/account/sync`, {}),
  // The team's conversation: one thread per base ('team', or an agent's own) and subject (a piece, a goal).
  thread: (pid: string, base: ChatBase, about?: string) => call<ChatMessage[]>(`/projects/${pid}/team/talk?base=${base}${about ? `&about=${encodeURIComponent(about)}` : ''}`),
  // Ask: the question goes to the agent whose job it is (or `agent`, when forced); `hint` is the page.
  ask: (pid: string, b: { message: string; base: ChatBase; about?: string; context?: string; hint?: string; agent?: AgentId }) => send<ChatMessage[]>('POST', `/projects/${pid}/team/talk`, b),
  configure: (pid: string, agent: AgentId, patch: Partial<AgentConfig>) => send<AgentConfig>('PATCH', `/projects/${pid}/team/agents/${agent}`, patch),
  plan: (pid: string, brief = '') => send<{ ok: true }>('POST', `/projects/${pid}/team/run`, { agents: ['director'], brief }),
  thumbUrl: (pid: string, url: string) => `/api/projects/${pid}/team/thumb?url=${encodeURIComponent(url)}`,
  apply: (pid: string, a: SuggestedAction) => send<{ started?: boolean; itemId?: string }>('POST', `/projects/${pid}/team/actions`, a),
  accept: (id: string) => send<ContentItem>('POST', `/items/${id}/accept`),
  reject: (id: string, reason: string) => send<ContentItem>('POST', `/items/${id}/reject`, { reason }),
  restore: (id: string) => send<ContentItem>('POST', `/items/${id}/restore`),
  confirmMatch: (id: string, postId: number) => send<ContentItem>('POST', `/items/${id}/match`, { postId }),
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
  addItem: (pid: string, b: { kind: ItemKind; title: string; brief: string; milestoneId?: string; offsetDays?: number; fixedDate?: string; rationale?: string; source?: ItemSource; pitch?: Pitch }) => send<ContentItem>('POST', `/projects/${pid}/items`, b),
  patchItem: (id: string, b: Partial<Pick<ContentItem, 'title' | 'brief' | 'draft' | 'kind' | 'offsetDays' | 'fixedDate' | 'milestoneId' | 'media'>> & { clearFixedDate?: boolean; seriesId?: string | null }) => send<ContentItem>('PATCH', `/items/${id}`, b),
  saveSeries: (pid: string, name: string) => send<Series>('POST', `/projects/${pid}/series`, { name }),
  reuseItem: (id: string) => send<ContentItem>('POST', `/items/${id}/reuse`),
  accountPosts: (pid: string) => call<AccountPost[]>(`/projects/${pid}/account/posts`),
  linkPost: (pid: string, postId: number, itemId: string | null) => send<{ ok: true }>('PATCH', `/projects/${pid}/account/${postId}`, { itemId }),
  generateSlide: (id: string, index: number, visual?: string) => send<ContentItem>('POST', `/items/${id}/media/${index}/generate`, { visual }),
  generateMissing: (id: string) => send<ContentItem>('POST', `/items/${id}/media/generate`),
  uploadSlide: (id: string, index: number, type: string, data: string) => send<ContentItem>('POST', `/items/${id}/media/${index}/upload`, { type, data }),
  exportWeekUrl: (pid: string) => `/api/projects/${pid}/export-week`,
  renderVideo: (id: string) => send<{ ok: boolean }>('POST', `/items/${id}/video`),
  videoUrl: (id: string, stamp: number) => `/api/items/${id}/video?v=${stamp}`,
  mediaUrl: (id: string, file: string) => `/api/items/${id}/media/${file}`,
  removeItem: (id: string) => send<{ ok: true }>('DELETE', `/items/${id}`),
  draft: (id: string, guidance?: string) => send<ContentItem>('POST', `/items/${id}/draft`, { guidance }),
  revise: (id: string, instruction: string) => send<ContentItem>('POST', `/items/${id}/revise`, { instruction }),
  approve: (id: string) => send<ContentItem>('POST', `/items/${id}/approve`),
  publish: (id: string, mode?: PublishMode) => send<ContentItem>('POST', `/items/${id}/publish`, { mode }),
  exportPack: (id: string) => call<ExportPack>(`/items/${id}/export-pack`),
  fromGit: (pid: string, since?: string) => send<ContentItem>('POST', `/projects/${pid}/content/from-git`, { since: since || undefined }),
};
