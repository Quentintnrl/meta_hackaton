import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareElement, iou, judge } from './compare.ts';
import { imageInfo, fromDataUrl } from './image.ts';
import { SamVisualReviewer } from './reviewer.ts';
import type { Box } from './types.ts';

const box = (x1: number, y1: number, x2: number, y2: number): Box => ({ x1, y1, x2, y2 });
// Header-only PNG: enough for the size.
export const png = (w: number, h: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
};

test('iou: identical, disjoint and half-overlapping boxes', () => {
  assert.equal(iou(box(0, 0, 1, 1), box(0, 0, 1, 1)), 1);
  assert.equal(iou(box(0, 0, .4, .4), box(.5, .5, 1, 1)), 0);
  assert.ok(Math.abs(iou(box(0, 0, 1, 1), box(0, 0, .5, 1)) - 0.5) < 1e-9);
});

test('each element gets the status that says what is wrong', () => {
  const a = box(.1, .1, .3, .2);
  assert.equal(compareElement('button', [a], [a]).status, 'match');
  assert.equal(compareElement('button', [a], [box(.6, .6, .9, .9)]).status, 'moved');
  assert.equal(compareElement('button', [a], []).status, 'missing');
  assert.equal(compareElement('card', [a, a, a], [a]).status, 'fewer');
  assert.equal(compareElement('card', [a, a, a, a, a], [a, a, a, a]).status, 'match'); // one fewer is segmentation noise
  assert.equal(compareElement('logo', [], [a]).status, 'inconclusive'); // SAM did not see it in the mockup
  assert.equal(compareElement('logo', [], []).status, 'inconclusive');
});

test('small things shifted by a few pixels still match; a real displacement does not', () => {
  const checkbox = box(.73, .22, .75, .24); // ~25px at 1280 wide
  assert.equal(compareElement('checkbox', [checkbox], [box(.71, .22, .72, .24)]).status, 'match');
  assert.equal(compareElement('checkbox', [checkbox], [box(.1, .8, .12, .82)]).status, 'moved');
});

test('verdict: a problem fails with feedback for the builder, nothing seen is inconclusive', () => {
  const a = box(.1, .1, .3, .2);
  const ok = judge([compareElement('button', [a], [a]), compareElement('logo', [], [])]);
  assert.equal(ok.verdict, 'pass');
  const bad = judge([compareElement('button', [a], [a]), compareElement('side panel', [box(.6, 0, 1, 1)], [])]);
  assert.equal(bad.verdict, 'fail');
  assert.match(bad.feedback, /"side panel" is in the mockup.*not found/);
  assert.equal(judge([compareElement('logo', [], [])]).verdict, 'inconclusive');
});

test('image size is read from the header; other data is refused', () => {
  assert.deepEqual(imageInfo(png(1280, 800)), { width: 1280, height: 800, mime: 'image/png', ext: 'png' });
  assert.equal(imageInfo(Buffer.from('GIF89a....................................')), null);
  assert.equal(fromDataUrl('data:text/html;base64,PGI+'), null);
  assert.ok(fromDataUrl(`data:image/png;base64,${png(300, 300).toString('base64')}`));
});

test('the reviewer renders at the mockup size and compares each element in both images', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ripple-rev-'));
  const mockupFile = join(dir, 'mockup.png');
  writeFileSync(mockupFile, png(1280, 800));
  let viewport: unknown;
  const llm = {
    json: async (_p: string, schema: { parse: (v: unknown) => unknown }, name: string) =>
      schema.parse(name === 'visual_checklist' ? { elements: ['Side Panel', 'outlined button', 'logo', 'checkbox'] } : { actions: [{ do: 'click', text: 'Shopping list', path: '', ms: 0 }, { do: 'goto', text: '', path: 'no-slash', ms: 0 }] }),
  };
  const drawer = box(.7, 0, 1, 1);
  const vision = { detect: async (url: string, phrase: string) => (phrase === 'side panel' ? (url.includes('image/png') ? [drawer] : []) : [box(.8, .03, .97, .09)]) };
  const capture = { capture: async (r: { viewport: unknown; chooseActions: (l: string[]) => Promise<unknown[]> }) => { viewport = r.viewport; assert.equal((await r.chooseActions(['Shopping list'])).length, 1); return png(1280, 800); } };
  const report = await new SamVisualReviewer({ llm: llm as never, vision, capture }).review({ featureId: 'f1', design: 'd', worktree: dir, mockupFile, outDir: join(dir, 'out') });
  assert.deepEqual(viewport, { width: 1280, height: 800 });
  assert.equal(report.verdict, 'pass'); // both images are PNG data URLs here, so the drawer is found in both
  assert.deepEqual(report.elements.map(e => e.phrase).slice(0, 2), ['side panel', 'outlined button']); // normalized
  assert.ok(existsSync(join(dir, 'out', 'app.png')) && existsSync(join(dir, 'out', 'report.json')));
});
