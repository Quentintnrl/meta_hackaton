import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appViewToHash, parseAppView, parseStudio, studioToHash } from './route-path.ts';

test('app hashes round-trip', () => {
  const views = [
    { kind: 'new-project' },
    { kind: 'project', id: 'abc' },
    { kind: 'content', id: 'abc' },
    { kind: 'new-feature', projectId: 'abc' },
    { kind: 'feature', id: 'xyz' },
  ] as const;
  for (const v of views) assert.deepEqual(parseAppView(appViewToHash(v)), v);
  assert.equal(parseAppView('/'), null);
  assert.equal(parseAppView('/nonsense'), null);
  assert.deepEqual(parseAppView('/projects/abc/content/calendar'), { kind: 'content', id: 'abc' }, 'studio tail stays on the studio');
});

test('studio hashes keep page and drawer', () => {
  assert.deepEqual(parseStudio('/projects/p/content/calendar/item/abc123', 'p'), { page: 'calendar', openId: 'abc123', about: null });
  assert.deepEqual(parseStudio('/projects/p/content/agent/writer', 'p'), { page: 'agent:writer', openId: null, about: null });
  assert.deepEqual(parseStudio('/projects/p/content', 'p'), { page: 'studio', openId: null, about: null });
  assert.deepEqual(parseStudio('/projects/p/content/nonsense', 'p'), { page: 'studio', openId: null, about: null }, 'unknown page falls back');
  assert.deepEqual(parseStudio('/projects/p/content/agent/nobody', 'p'), { page: 'studio', openId: null, about: null }, 'unknown agent is not a page');
  assert.deepEqual(parseStudio('/projects/other/content/calendar', 'p'), { page: 'studio', openId: null, about: null }, 'another project is not parsed');
  assert.deepEqual(parseStudio('/projects/p/content/inbox', 'p').page, 'today', 'old inbox lands on today');
  assert.deepEqual(parseStudio('/projects/p/content/orders', 'p').page, 'team', 'old orders lands on team');
  assert.deepEqual(parseStudio('/projects/p/content/field', 'p').page, 'insights', 'old field lands on insights');
  assert.deepEqual(parseStudio('/projects/p/content/insights/item/x1', 'p'), { page: 'insights', openId: 'x1', about: null });
  assert.equal(studioToHash('p', 'agent:scout', 'abc123'), '/projects/p/content/agent/scout/item/abc123');
  assert.equal(studioToHash('p', 'today', null), '/projects/p/content/today');
});

test('studio hashes carry invisible chat context', () => {
  const about = { agent: 'writer', kind: 'item', id: 'abc123' } as const;
  assert.equal(studioToHash('p', 'agent:writer', null, about), '/projects/p/content/agent/writer/about/writer/item/abc123');
  assert.deepEqual(parseStudio('/projects/p/content/agent/writer/about/writer/item/abc123', 'p'), { page: 'agent:writer', openId: null, about: { agent: 'writer', kind: 'item', id: 'abc123' } });
  assert.deepEqual(parseStudio('/projects/p/content/today/about/writer/item/abc123', 'p'), { page: 'today', openId: null, about: { agent: 'writer', kind: 'item', id: 'abc123' } }, 'the drawer lives on any page');
  assert.deepEqual(parseStudio('/projects/p/content/today/about/writer', 'p').about, { agent: 'writer', kind: null, id: null }, 'agent alone means a plain chat');
  assert.deepEqual(parseStudio('/projects/p/content/today/about/nobody', 'p').about, null, 'unknown agent is ignored');
  assert.equal(studioToHash('p', 'today', null), '/projects/p/content/today');
});
