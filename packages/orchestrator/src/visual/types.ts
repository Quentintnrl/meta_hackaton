// Boxes are normalized to 0..1 (fractions of the image), so a mockup and a screenshot of different sizes compare.
export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type ElementStatus = 'match' | 'missing' | 'moved' | 'fewer' | 'inconclusive';

export interface ElementResult {
  phrase: string;
  status: ElementStatus;
  mockup: Box[];
  app: Box[];
  iou?: number;
}

export interface VisualReport {
  verdict: 'pass' | 'fail' | 'inconclusive';
  feedback: string; // what to tell the builder when it differs
  elements: ElementResult[];
  // Files in the feature's visual folder.
  mockupFile: string;
  appFile: string;
  at: string;
}
