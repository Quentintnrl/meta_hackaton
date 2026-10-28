import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FigmaClient, outlineOf, parseFigmaUrl } from './figma.ts';

test('Figma links: design, file and branch URLs, with or without a name', () => {
  assert.deepEqual(parseFigmaUrl('https://www.figma.com/design/hhuTYravSy587lUvUmX1Zc/Mealkinator?node-id=3-102&t=x'), { fileKey: 'hhuTYravSy587lUvUmX1Zc', nodeId: '3:102' });
  assert.deepEqual(parseFigmaUrl('https://figma.com/file/AbC123/x?node-id=3:102'), { fileKey: 'AbC123', nodeId: '3:102' });
  assert.deepEqual(parseFigmaUrl('https://www.figma.com/design/MAIN1/branch/BRANCH2/x?node-id=1-2'), { fileKey: 'BRANCH2', nodeId: '1:2' });
  for (const bad of ['', 'not a url', 'http://www.figma.com/design/a/b?node-id=1-2', 'https://evil.com/design/a/b?node-id=1-2',
    'https://www.figma.com/design/a/b', 'https://www.figma.com/board/a/b?node-id=1-2', 'https://www.figma.com/design/a%2F..%2Fb/x?node-id=1-2']) {
    assert.equal(parseFigmaUrl(bad), null, bad);
  }
});

test('the outline lists layer names and texts, limited in depth and size', () => {
  const tree = { type: 'FRAME', name: 'Week', children: [{ type: 'TEXT', name: 'Title', characters: 'Menu  of\nthe week' }, { type: 'FRAME', name: 'Drawer', children: [{ type: 'TEXT', name: 'x', characters: 'Close' }] }] };
  assert.equal(outlineOf(tree), 'frame "Week"\n  text "Title": Menu of the week\n  frame "Drawer"\n    text "x": Close');
  // drawing primitives and unnamed wrappers add nothing
  const logo = { type: 'FRAME', name: 'Header', children: [{ type: 'INSTANCE', name: 'Logo', children: [{ type: 'FRAME', name: 'Frame', children: [{ type: 'VECTOR', name: 'Vector' }, { type: 'TEXT', name: 'a', characters: 'Hi' }] }] }] };
  assert.equal(outlineOf(logo), 'frame "Header"\n  instance "Logo"\n    text "a": Hi');
  assert.equal(outlineOf({ type: 'FRAME', name: 'r', children: Array.from({ length: 500 }, (_, i) => ({ type: 'TEXT', name: `t${i}` })) }, 50).split('\n').length, 50);
});

test('fetchFrame sends the token to the Figma API only, and downloads the image without it', async () => {
  const calls: Array<{ url: string; token?: string }> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, token: init?.headers?.['X-Figma-Token'] });
    const json = (b: unknown) => new Response(JSON.stringify(b));
    if (url.startsWith('https://api.figma.com/v1/images/')) return json({ images: { '3:102': 'https://s3.example.com/frame.png' } });
    if (url.startsWith('https://api.figma.com/v1/files/')) return json({ nodes: { '3:102': { document: { type: 'FRAME', name: 'Week - after', children: [] } } } });
    return new Response(Buffer.from('PNGDATA'));
  }) as never;
  try {
    const f = await new FigmaClient('secret-token').fetchFrame('https://www.figma.com/design/KEY1/x?node-id=3-102');
    assert.equal(f.png.toString(), 'PNGDATA');
    assert.equal(f.outline, 'frame "Week - after"');
    const download = calls.find(c => c.url.startsWith('https://s3.example.com'))!;
    assert.equal(download.token, undefined);
    assert.ok(calls.filter(c => c.url.startsWith('https://api.figma.com')).every(c => c.token === 'secret-token'));
    await assert.rejects(new FigmaClient('t').fetchFrame('https://www.figma.com/design/KEY1/x'), /not a link to a Figma frame/);
  } finally {
    globalThis.fetch = real;
  }
});

test('Figma errors are turned into advice', async () => {
  const real = globalThis.fetch;
  try {
    for (const [status, expected] of [[403, /not shared/], [404, /could not find/]] as const) {
      globalThis.fetch = (async () => new Response('{}', { status })) as never;
      await assert.rejects(new FigmaClient('t').fetchFrame('https://www.figma.com/design/KEY1/x?node-id=1-2'), expected);
    }
  } finally {
    globalThis.fetch = real;
  }
});

test('the token is read at each call, and a missing one is explained', async () => {
  let token: string | null = null;
  const real = globalThis.fetch;
  const seen: Array<string | undefined> = [];
  globalThis.fetch = (async (_u: string, init?: { headers?: Record<string, string> }) => { seen.push(init?.headers?.['X-Figma-Token']); return new Response('{}', { status: 404 }); }) as never;
  try {
    const client = new FigmaClient(() => token);
    const url = 'https://www.figma.com/design/KEY1/x?node-id=1-2';
    await assert.rejects(client.fetchFrame(url), /FIGMA_TOKEN is not set/);
    assert.deepEqual(seen, []); // nothing is sent without a token
    token = 'added-later'; // .env edited while the server runs
    await assert.rejects(client.fetchFrame(url), /could not find/);
    assert.ok(seen.every(t => t === 'added-later'));
  } finally {
    globalThis.fetch = real;
  }
});
