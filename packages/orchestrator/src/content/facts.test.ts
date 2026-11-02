import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountFacts, factsText } from './facts.ts';
import type { AccountPost } from './types.ts';

const post = (postedAt: string, likes: number, text: string, extra: Partial<AccountPost> = {}): AccountPost => ({ platform: 'instagram', text, format: 'post', likes, comments: 0, shares: 0, saves: 0, postedAt, simulated: false, ...extra });

test('facts: pace, silences, drift, questions, length, weekday, words and reach, all from the posts', () => {
  const posts = [
    post('2026-01-05', 3, 'Moderniser une mairie, un outil simple'), // Monday
    post('2026-01-12', 4, 'Un outil simple pour la mairie, encore'),
    post('2026-03-02', 9, 'Où est la bonne version du programme en mairie ?'), // 49 days after: a silence
    post('2026-03-09', 12, 'Un e-mail, un fichier, une mairie : où est la bonne information ? ' + 'x'.repeat(300)),
    post('2026-03-16', 2, 'Slogan', { platform: 'linkedin', views: 100, shares: 1 }),
  ];
  const f = accountFacts(posts, '2026-04-01')!;
  assert.equal(f.n, 5); assert.equal(f.daysSinceLast, 16);
  assert.deepEqual(f.silences, [{ from: '2026-01-12', to: '2026-03-02', days: 49 }]);
  assert.equal(f.trend.early.n, 2); assert.equal(f.trend.late.n, 3); assert.equal(f.trend.direction, 'up');
  assert.deepEqual(f.question, { asked: { n: 2, avg: 10.5 }, not: { n: 3, avg: 3 } });
  assert.deepEqual(f.length.map(l => [l.label, l.n]), [['short', 4], ['medium', 0], ['long', 1]]);
  assert.equal(f.weekday[0].n, 5, 'every post was a Monday');
  assert.ok(f.words.some(w => w.word === 'bonne'), 'the word of the best posts stands out');
  assert.ok(!f.words.some(w => w.word === 'mairie'), 'a word used everywhere is not a signal');
  assert.deepEqual(f.reach, [{ text: 'Slogan', views: 100, likes: 2, shares: 1, rate: 2, postedAt: '2026-03-16' }]);
  assert.equal(f.best.likes, 12); assert.equal(f.worst.likes, 2); assert.equal(f.thin, true);
  const t = factsText(f);
  assert.match(t, /49 days/); assert.match(t, /ask a question: 10.5 likes avg over 2/); assert.match(t, /too small to rank/);
  assert.equal(accountFacts([], '2026-04-01'), null);
});
