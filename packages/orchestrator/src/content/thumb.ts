import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The picture a page advertises for itself (og:image, twitter:image), resolved against the page.
export function pageImage(html: string, base: string): string | undefined {
  const m = /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]*content=["']([^"']+)["']/i.exec(html)
    ?? /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["']/i.exec(html);
  if (!m) return undefined;
  try { return new URL(m[1].replace(/&amp;/g, '&'), base).href; } catch { return undefined; }
}

// Only public web addresses: a field example never points the server at itself or the local network.
export function publicUrl(url: string): URL | undefined {
  let u: URL;
  try { u = new URL(url); } catch { return undefined; }
  if (!/^https?:$/.test(u.protocol)) return undefined;
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|\[::1\]|\[fe80:)/i.test(u.hostname)) return undefined;
  return u;
}

const TIMEOUT = 8000, MAX_HTML = 400_000, MAX_IMAGE = 3_000_000;

// A thumbnail for an example seen in the field: fetched once, cached on disk, never generated. Nothing, when
// the page has no picture or is unreachable; a page without a picture is remembered so it is not asked twice.
export async function thumbnail(url: string, dir: string, get: typeof fetch = fetch): Promise<{ path: string; type: string } | undefined> {
  const u = publicUrl(url);
  if (!u) return undefined;
  mkdirSync(dir, { recursive: true });
  const key = createHash('sha1').update(url).digest('hex');
  const meta = join(dir, `${key}.json`);
  if (existsSync(meta)) {
    const m = JSON.parse(readFileSync(meta, 'utf8')) as { type: string; file?: string };
    return m.file ? { path: join(dir, m.file), type: m.type } : undefined;
  }
  const none = () => { writeFileSync(meta, JSON.stringify({ type: '' })); return undefined; };
  try {
    const page = await get(u, { signal: AbortSignal.timeout(TIMEOUT), redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; Ripple_handoff)' } });
    if (!page.ok) return none();
    const img = pageImage((await page.text()).slice(0, MAX_HTML), page.url || url);
    const iu = img ? publicUrl(img) : undefined;
    if (!iu) return none();
    const res = await get(iu, { signal: AbortSignal.timeout(TIMEOUT), redirect: 'follow' });
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!res.ok || !/^image\//.test(type)) return none();
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE) return none();
    const file = `${key}.img`;
    writeFileSync(join(dir, file), buf);
    writeFileSync(meta, JSON.stringify({ type, file }));
    return { path: join(dir, file), type };
  } catch { return undefined; } // a network hiccup is not remembered: the next look may succeed
}
