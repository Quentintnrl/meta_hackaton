import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LLM } from '../adapters/llm.ts';
import type { Vision } from '../adapters/vision.ts';
import type { Capture } from '../adapters/capture.ts';
import { chooseActions, visualChecklist } from './capture-plan.ts';
import { compareElement, judge } from './compare.ts';
import { imageInfo, toDataUrl } from './image.ts';
import type { VisualReport } from './types.ts';

export interface ReviewRequest {
  featureId: string;
  design: string;
  worktree: string;
  mockupFile: string; // path of the mockup image
  outDir: string; // where this feature's screenshot and report are written
}

// Compares what was built with the mockup: screenshot the app, then look for the same elements in both images.
export interface VisualReviewer {
  review(req: ReviewRequest): Promise<VisualReport>;
}

export class SamVisualReviewer implements VisualReviewer {
  #llm: LLM;
  #vision: Vision;
  #capture: Capture;

  constructor(o: { llm: LLM; vision: Vision; capture: Capture }) {
    this.#llm = o.llm;
    this.#vision = o.vision;
    this.#capture = o.capture;
  }

  async review({ design, worktree, mockupFile, outDir }: ReviewRequest): Promise<VisualReport> {
    const mockup = readFileSync(mockupFile);
    const info = imageInfo(mockup);
    if (!info) throw new Error('the mockup is neither a PNG nor a JPEG');

    // The app is rendered at the mockup's size, so positions are comparable.
    const [shot, phrases] = await Promise.all([
      this.#capture.capture({ worktree, viewport: { width: info.width, height: info.height }, chooseActions: labels => chooseActions(this.#llm, design, labels) }),
      visualChecklist(this.#llm, design),
    ]);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'app.png'), shot);

    const mockupUrl = toDataUrl(mockup, info.mime);
    const appUrl = toDataUrl(shot, 'image/png');
    const elements = await Promise.all(phrases.map(async p => {
      const [m, a] = await Promise.all([this.#vision.detect(mockupUrl, p), this.#vision.detect(appUrl, p)]);
      return compareElement(p, m, a);
    }));

    const report: VisualReport = { ...judge(elements), elements, mockupFile: `mockup.${info.ext}`, appFile: 'app.png', at: new Date().toISOString() };
    writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
    return report;
  }
}
