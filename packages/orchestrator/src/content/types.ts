import { z } from 'zod';

export const ItemKind = z.enum(['changelog', 'release-notes', 'devlog', 'social-post', 'teaser', 'doc-update', 'demo-script', 'newsletter']);
export type ItemKind = z.infer<typeof ItemKind>;

// idea = the team proposed it and waits for the manager, rejected = the manager said no (the reason is kept: the team learns from it), briefed = the user said what they want, drafted = text exists, approved = the user signed it off.
export const ItemStatus = z.enum(['idea', 'briefed', 'drafted', 'approved', 'published', 'rejected']);
export type ItemStatus = z.infer<typeof ItemStatus>;

export interface Profile {
  voice: string; // how the project speaks
  audience: string; // who reads it
  language: string;
  autoDraft: boolean; // draft on its own when an item gets close; it never approves or publishes
  niche: string; // what the project is about, for the scout
  directives: string; // standing orders from the manager, read by every agent
}

export const defaultProfile: Profile = { voice: '', audience: '', language: 'English', autoDraft: false, niche: '', directives: '' };

export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  intent: string; // what the user wants, in their words: the AI plans content from it
  targetDate: string; // YYYY-MM-DD, the date the user wants
  startDate: string;
  scope: number; // how many features this milestone is expected to take
  status: 'open' | 'done';
  doneAt?: string;
  featureIds: string[];
  createdAt: string;
}

// One projection of when the milestone lands. Forecasts are kept, never overwritten: that history is how the AI is held to account.
export interface Forecast {
  id: number;
  milestoneId: string;
  madeAt: string;
  predictedDate: string;
  rawRemainingDays: number; // the projection before correction, so errors are measured on the model and not on its corrections
  calibration: number; // the correction applied (1 = none)
  done: number;
  scope: number;
  confidence: 'low' | 'medium' | 'high';
  note: string; // what changed since the previous forecast, in words
}

export type ItemSource = 'trend' | 'account' | 'roadmap' | 'manager' | '';

export interface Item {
  id: string;
  projectId: string;
  milestoneId?: string;
  featureId?: string;
  kind: ItemKind;
  title: string;
  brief: string; // what the user wants this piece to say
  draft: string;
  status: ItemStatus;
  offsetDays?: number; // date relative to the milestone's forecast: the item moves when the forecast does
  fixedDate?: string; // or a date the user locked
  origin: 'user' | 'ai' | 'dev';
  rationale: string; // why the team proposes it: what it saw in trends, in the account, in the roadmap
  source: ItemSource;
  rejectedReason?: string;
  revisions: number;
  exportedPath?: string;
  publishedAt?: string;
  createdAt: string;
}

export const day = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => day(new Date(Date.parse(iso + 'T00:00:00Z') + n * 86_400_000));
export const daysBetween = (a: string | Date, b: string | Date) => (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;

export type AgentId = 'scout' | 'analyst' | 'strategist' | 'writer';

export interface AccountPost { id?: number; text: string; format: string; likes: number; comments: number; shares: number; saves: number; postedAt: string; simulated: boolean }
export interface Activity { id: number; projectId: string; agent: AgentId; summary: string; ok: boolean; at: string }
export interface Report<T = unknown> { id: number; kind: 'audit' | 'account'; data: T; simulated: boolean; at: string }
export const engagement = (p: Pick<AccountPost, 'likes' | 'comments' | 'shares' | 'saves'>) => p.likes + p.comments * 2 + p.shares * 3 + p.saves * 3;
