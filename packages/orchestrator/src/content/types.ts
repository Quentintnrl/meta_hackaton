import { z } from 'zod';

export const ItemKind = z.enum(['changelog', 'release-notes', 'devlog', 'social-post', 'teaser', 'doc-update', 'demo-script', 'newsletter']);
export type ItemKind = z.infer<typeof ItemKind>;

// idea = the AI suggested it, briefed = the user said what they want, drafted = text exists, approved = the user signed it off.
export const ItemStatus = z.enum(['idea', 'briefed', 'drafted', 'approved', 'published']);
export type ItemStatus = z.infer<typeof ItemStatus>;

export interface Profile {
  voice: string; // how the project speaks
  audience: string; // who reads it
  language: string;
  autoDraft: boolean; // draft on its own when an item gets close; it never approves or publishes
}

export const defaultProfile: Profile = { voice: '', audience: '', language: 'English', autoDraft: false };

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
  revisions: number;
  exportedPath?: string;
  publishedAt?: string;
  createdAt: string;
}

export const day = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => day(new Date(Date.parse(iso + 'T00:00:00Z') + n * 86_400_000));
export const daysBetween = (a: string | Date, b: string | Date) => (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
