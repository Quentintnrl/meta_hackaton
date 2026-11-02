import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pageImage, publicUrl, thumbnail } from './thumb.ts';

test('the picture a page advertises is found whichever way the tag is written', () => {
  assert.equal(pageImage('<meta property="og:image" content="https://x.test/a.jpg">', 'https://x.test/p'), 'https://x.test/a.jpg');
  assert.equal(pageImage("<meta content='/b.png?x=1&amp;y=2' name='twitter:image'>", 'https://x.test/p/q'), 'https://x.test/b.png?x=1&y=2');
  assert.equal(pageImage('<meta name="description" content="hello">', 'https://x.test'), undefined);
});

test('only public web addresses are fetched', () => {
  assert.ok(publicUrl('https://example.com/post'));
  assert.equal(publicUrl('http://localhost:8787/x'), undefined);
  assert.equal(publicUrl('http://192.168.1.4/x'), undefined);
  assert.equal(publicUrl('file:///etc/passwd'), undefined);
  assert.equal(publicUrl('not a url'), undefined);
});

test('a thumbnail is fetched once and cached; a page without one is remembered', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thumb-'));
  let calls = 0;
  const get = (async (u: URL | RequestInfo) => {
    calls++;
    const url = String(u);
    if (url.endsWith('/post')) return new Response('<meta property="og:image" content="/pic.png">', { status: 200 });
    if (url.endsWith('/pic.png')) return new Response(Buffer.from([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } });
    return new Response('<p>no picture</p>', { status: 200 });
  }) as typeof fetch;
  const t = await thumbnail('https://example.com/post', dir, get);
  assert.equal(t?.type, 'image/png');
  assert.equal(calls, 2, 'the page, then the picture');
  await thumbnail('https://example.com/post', dir, get);
  assert.equal(calls, 2, 'served from the cache');
  assert.equal(await thumbnail('https://example.com/bare', dir, get), undefined);
  await thumbnail('https://example.com/bare', dir, get);
  assert.equal(calls, 3, 'a page without a picture is not asked again');
  assert.equal(await thumbnail('http://localhost/post', dir, get), undefined);
  assert.equal(calls, 3, 'local addresses are never fetched');
  assert.ok(readdirSync(dir).some(f => f.endsWith('.img')));
});
