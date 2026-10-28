import type { Box, ElementResult, VisualReport } from './types.ts';

export const MATCH_IOU = 0.35; // generous: SAM boxes and a real render never agree to the pixel

export function iou(a: Box, b: Box): number {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const area = (r: Box) => (r.x2 - r.x1) * (r.y2 - r.y1);
  return inter / (area(a) + area(b) - inter);
}

const centre = (b: Box) => ({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 });
const dist = (a: Box, b: Box) => Math.hypot(centre(a).x - centre(b).x, centre(a).y - centre(b).y);
const area = (b: Box) => (b.x2 - b.x1) * (b.y2 - b.y1);

// Same place, same size, give or take: IoU alone is far too harsh on small things (a 20px checkbox shifted by 25px has IoU 0).
export const CENTRE_TOLERANCE = 0.04; // of the screen's width/height, about 50px on a 1280px screen
export function similar(a: Box, b: Box): boolean {
  if (iou(a, b) >= MATCH_IOU) return true;
  const ratio = area(a) / area(b);
  return dist(a, b) <= CENTRE_TOLERANCE && ratio >= 0.5 && ratio <= 2;
}

const nearest = (to: Box, among: Box[]) => among.reduce((best, b) => (dist(to, b) < dist(to, best) ? b : best));

export function compareElement(phrase: string, mockup: Box[], app: Box[]): ElementResult {
  // Neither image shows it: SAM could not see it, so it says nothing about the build.
  if (mockup.length === 0) return { phrase, status: 'inconclusive', mockup, app };
  if (app.length === 0) return { phrase, status: 'missing', mockup, app };
  const overlap = mockup.reduce((sum, m) => sum + Math.max(...app.map(a => iou(m, a))), 0) / mockup.length;
  // Segmentation counts vary a little between two images: only a clear shortfall counts.
  if (app.length < mockup.length * 0.6) return { phrase, status: 'fewer', mockup, app, iou: overlap };
  const matched = mockup.filter(m => app.some(a => similar(m, a))).length / mockup.length;
  return { phrase, status: matched >= 0.5 ? 'match' : 'moved', mockup, app, iou: overlap };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const where = (b: Box) => `x ${pct(b.x1)}-${pct(b.x2)}, y ${pct(b.y1)}-${pct(b.y2)} of the screen`;

function describe(r: ElementResult): string | null {
  switch (r.status) {
    case 'missing': return `"${r.phrase}" is in the mockup (${where(r.mockup[0])}) but was not found in the app.`;
    case 'fewer': return `The mockup shows ${r.mockup.length} "${r.phrase}" but the app shows ${r.app.length}.`;
    case 'moved': {
      // Describe the first mockup box that has no counterpart, next to the closest thing the app has.
      const lost = r.mockup.find(m => !r.app.some(a => similar(m, a))) ?? r.mockup[0];
      return `"${r.phrase}" is at ${where(nearest(lost, r.app))} in the app, but the mockup has it at ${where(lost)}. Match the mockup's position and size.`;
    }
    default: return null;
  }
}

export function judge(elements: ElementResult[]): Pick<VisualReport, 'verdict' | 'feedback'> {
  const problems = elements.map(describe).filter((s): s is string => s !== null);
  if (problems.length) return { verdict: 'fail', feedback: problems.join('\n') };
  // Pass needs at least one element that was actually seen in both images.
  const seen = elements.some(e => e.status === 'match');
  return { verdict: seen ? 'pass' : 'inconclusive', feedback: '' };
}
