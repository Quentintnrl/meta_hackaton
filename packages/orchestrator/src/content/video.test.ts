import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasFfmpeg, renderVideo, wrap } from './video.ts';

test('long captions are wrapped so they fit the frame', () => {
  const lines = wrap('Three weeks to the beta and we need ten testers who hate meal planning').split('\n');
  assert.ok(lines.length > 1 && lines.every(l => l.length <= 22));
});

test('keyframes become an mp4 of the right length, with no model call', async t => {
  if (!(await hasFfmpeg())) return t.skip('ffmpeg is not installed');
  const dir = mkdtempSync(join(tmpdir(), 'video-test-'));
  const img = (name: string, color: string) => { const p = join(dir, name); execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=640x640`, '-frames:v', '1', p]); return p; };
  const out = join(dir, 'out', 'video.mp4');
  await renderVideo([{ image: img('a.jpg', 'orange'), seconds: 2, text: 'Plan a week in one tap' }, { image: img('b.jpg', 'teal'), seconds: 1, text: '' }], out);
  assert.ok(statSync(out).size > 1000);
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString());
  assert.ok(Math.abs(dur - 3) < 0.3, `duration ${dur}`);
});

test('nothing to assemble is refused', async () => {
  await assert.rejects(renderVideo([], '/tmp/x.mp4'), /no keyframe/);
});
