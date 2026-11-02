import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPage, pageText, scoutTools } from './scout-tools.ts';
import type { LLM } from '../adapters/llm.ts';

const page = (status: number, body: string, type = 'text/html') => (async (u: string | URL) => ({ ok: status < 400, status, url: String(u), headers: new Headers({ 'content-type': type }), text: async () => body })) as unknown as typeof fetch;

test('a page is read as text: scripts, styles and tags gone, blocks on their own lines', () => {
  const t = pageText('<html><head><style>p{}</style><script>x()</script></head><body><h1>Berger-Levrault</h1><p>3 posts&nbsp;par semaine &amp; une newsletter</p><ul><li>Salon des maires</li></ul></body></html>');
  assert.equal(t, 'Berger-Levrault\n3 posts par semaine & une newsletter\nSalon des maires');
});

test('the Scout opens public pages only, and says why a page could not be read', async () => {
  assert.match(await openPage('http://localhost:8787/secret', page(200, 'x')), /only public/);
  assert.match(await openPage('file:///etc/passwd', page(200, 'x')), /only public/);
  assert.match(await openPage('https://www.linkedin.com/company/x', page(999, '')), /HTTP 999.*refuses robots/);
  const ok = await openPage('https://example.com/a', page(200, '<p>Hello</p>'));
  assert.equal(ok, 'https://example.com/a\nHello');
});

test('the Scout tools: search answers with its sources, open validates its argument', async () => {
  const llm: LLM = { json: async () => { throw new Error('unused'); }, search: async q => ({ text: `about ${q}`, sources: ['https://s.example/1'] }) };
  const [search, open] = scoutTools(llm, page(200, '<p>Hi</p>'));
  assert.equal(await search.run({ query: 'mairies' }), 'about mairies\nSources: https://s.example/1');
  assert.throws(() => open.args.parse({ url: 'not a url' }));
  assert.match(await open.run({ url: 'https://example.com' }), /Hi/);
});
