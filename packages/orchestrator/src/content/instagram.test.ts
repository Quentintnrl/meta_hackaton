import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readInstagram } from './instagram.ts';
import { parseAccountCsv, parseDay } from './service.ts';

// A fake Graph API: the profile, one page of media, insights for the first post only.
const fake = (calls: string[]) => async (url: string) => {
  calls.push(url);
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  if (url.includes('/1789/media?')) return ok({ data: [
    { id: 'm1', caption: 'Un e-mail. Un fichier partagé.', media_type: 'CAROUSEL_ALBUM', timestamp: '2026-10-01T08:00:00+0000', like_count: 12, comments_count: 0 },
    { id: 'm2', caption: '', media_type: 'VIDEO', media_product_type: 'REELS', timestamp: '2025-11-20T08:00:00+0000', like_count: 8, comments_count: 1 },
  ] });
  if (url.includes('/m1/insights')) return ok({ data: [{ name: 'reach', values: [{ value: 301 }] }, { name: 'saved', values: [{ value: 4 }] }, { name: 'shares', values: [{ value: 2 }] }] });
  if (url.includes('/m2/insights')) return { ok: false, status: 400, json: async () => ({ error: { message: 'unsupported' } }) };
  if (url.includes('/1789?')) return ok({ username: 'mairie360', followers_count: 44 });
  return { ok: false, status: 404, json: async () => ({ error: { message: 'no' } }) };
};

test('the Instagram API is read into posts with their insights, and a refused insight keeps the public counts', async () => {
  const calls: string[] = [];
  const r = await readInstagram({ userId: '1789', token: 'tok' }, fake(calls));
  assert.equal(r.username, 'mairie360'); assert.equal(r.followers, 44);
  assert.equal(r.posts.length, 2);
  assert.deepEqual({ ...r.posts[0] }, { platform: 'instagram', text: 'Un e-mail. Un fichier partagé.', format: 'carousel', likes: 12, comments: 0, shares: 2, saves: 4, views: 301, postedAt: '2026-10-01', simulated: false });
  assert.equal(r.posts[1].format, 'reel'); assert.equal(r.posts[1].text, '(no caption)'); assert.equal(r.posts[1].saves, 0); assert.equal(r.posts[1].views, undefined);
  assert.ok(calls.every(u => u.includes('access_token=tok')), 'the token travels on every call');
});

test('the API error is said plainly', async () => {
  await assert.rejects(readInstagram({ userId: '1789', token: 'bad' }, async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Invalid OAuth access token' } }) })), /Instagram API: Invalid OAuth access token/);
});

test('a LinkedIn page export pasted from the spreadsheet is read exactly, in French, with tabs and French dates', () => {
  const sheet = [
    'Mises à jour de la Page Mairie360\tdu 03/10/2026 au 02/11/2026',
    'Titre de la mise à jour\tLien de la mise à jour\tDate de création\tImpressions\tClics\tRéactions\tCommentaires\tRepublications\tTaux d’engagement',
    'Une information est créée dans un service municipal…\thttps://www.linkedin.com/feed/update/1\t02/10/2026\t301\t12\t5\t0\t4\t0,07',
    'Un document existe. Pourtant…\thttps://www.linkedin.com/feed/update/2\t23/10/2026\t35\t2\t3\t0\t1\t0,17',
  ].join('\n');
  const rows = parseAccountCsv(sheet, '2026-11-02')!;
  assert.equal(rows.length, 2);
  assert.deepEqual({ ...rows[0] }, { text: 'Une information est créée dans un service municipal…', format: 'post', likes: 5, comments: 0, shares: 4, saves: 0, views: 301, postedAt: '2026-10-02', simulated: false });
  assert.equal(rows[1].postedAt, '2026-10-23');
});

test('dates come in the shapes the exports use', () => {
  assert.equal(parseDay('2026-10-30T08:00:00Z'), '2026-10-30');
  assert.equal(parseDay('30/10/2026'), '2026-10-30');
  assert.equal(parseDay('10/30/2026'), '2026-10-30');
  assert.equal(parseDay('03/04/2026'), '2026-04-03', 'ambiguous: day first, as in France');
  assert.equal(parseDay('nope'), undefined);
});
