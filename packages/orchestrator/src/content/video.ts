import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const run = promisify(execFile);
const W = 720, H = 1280, FPS = 25;
const FONTS = ['/usr/share/fonts/liberation-sans-fonts/LiberationSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf', '/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Helvetica.ttc'];

export interface Shot { image: string; seconds: number; text: string }

// H.264 plays everywhere (browsers, Instagram). Builds differ in which encoder they ship.
async function h264(): Promise<string[]> {
  const { stdout } = await run('ffmpeg', ['-hide_banner', '-encoders']);
  if (stdout.includes('libx264')) return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23'];
  if (stdout.includes('libopenh264')) return ['-c:v', 'libopenh264', '-b:v', '3M'];
  throw new Error('this ffmpeg has no H.264 encoder (install ffmpeg with libx264)');
}

export async function hasFfmpeg(): Promise<boolean> {
  try { await run('ffmpeg', ['-version']); return true; } catch { return false; }
}

// Break a caption into lines that fit the frame, so no text is cut.
export function wrap(text: string, width = 22): string {
  const lines: string[] = [];
  let line = '';
  for (const word of text.replace(/\s+/g, ' ').trim().split(' ')) {
    if (line && `${line} ${word}`.length > width) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.slice(0, 5).join('\n');
}

// A vertical MP4 from the keyframes: each one held for its duration with a slow zoom and its text on top.
// Everything runs locally with ffmpeg: no model call, so it costs no tokens.
export async function renderVideo(shots: Shot[], out: string): Promise<void> {
  if (shots.length === 0) throw new Error('no keyframe to assemble');
  if (!(await hasFfmpeg())) throw new Error('ffmpeg is not installed on this machine');
  const font = FONTS.find(existsSync);
  const work = mkdtempSync(join(tmpdir(), 'ripple-video-'));
  try {
    const args = ['-y', '-v', 'error'];
    const filters: string[] = [];
    shots.forEach((s, i) => {
      const secs = Math.min(15, Math.max(1, s.seconds || 3));
      const frames = Math.round(secs * FPS);
      args.push('-i', s.image);
      let f = `[${i}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='min(1+0.12*on/${frames},1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS}`;
      const text = wrap(s.text);
      if (text && font) {
        const file = join(work, `t${i}.txt`);
        writeFileSync(file, text);
        f += `,drawtext=fontfile='${font}':textfile='${file}':fontsize=54:fontcolor=white:line_spacing=10:box=1:boxcolor=black@0.55:boxborderw=22:x=(w-text_w)/2:y=h-text_h-150`;
      }
      filters.push(`${f},setsar=1,format=yuv420p[v${i}]`);
    });
    const joined = shots.map((_, i) => `[v${i}]`).join('');
    const graph = `${filters.join(';')};${joined}concat=n=${shots.length}:v=1:a=0[out]`;
    mkdirSync(join(out, '..'), { recursive: true });
    await run('ffmpeg', [...args, '-filter_complex', graph, '-map', '[out]', ...(await h264()), '-movflags', '+faststart', out], { timeout: 120_000 });
  } finally { rmSync(work, { recursive: true, force: true }); }
}
