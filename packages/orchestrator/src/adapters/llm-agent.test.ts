import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { MetaLLM } from './llm.ts';

// A fake Meta Responses API: first turn asks for a tool, second turn asks for another, third stops; the final
// JSON turn is answered from what the tools returned. Checks the loop sends function results back on the thread.
test('the Meta adapter runs the tool loop: function_call → run → function_call_output with previous_response_id → final JSON', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (_u: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    const n = calls.length;
    const reply = n === 1 ? { id: 'r1', output: [{ type: 'function_call', call_id: 'c1', name: 'count', arguments: '{"text":"a b c"}' }] }
      : n === 2 ? { id: 'r2', output: [{ type: 'function_call', call_id: 'c2', name: 'nope', arguments: '{}' }, { type: 'function_call', call_id: 'c3', name: 'count', arguments: '{"text":"zz"}' }] }
      : n === 3 ? { id: 'r3', output: [{ type: 'web_search_call', action: { type: 'open_page', url: 'https://example.com' } }, { type: 'message', content: [{ type: 'output_text', text: 'done looking' }] }] }
      : { id: 'r4', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"words":3}' }] }] };
    return { ok: true, json: async () => reply, text: async () => '' };
  }) as typeof fetch;
  try {
    const steps: string[] = [];
    const llm = new MetaLLM('k');
    const out = await llm.agent('count the words', [{ name: 'count', description: 'counts words', args: z.object({ text: z.string() }), run: async a => String(String(a.text).split(' ').length) }], z.object({ words: z.number() }), 'count', { onStep: s => steps.push(`${s.tool}=${s.result}`) });
    assert.deepEqual(out, { words: 3 });
    assert.equal(calls.length, 4);
    assert.equal((calls[0].tools as unknown[]).length, 2, 'web search plus the function');
    assert.equal(calls[1].previous_response_id, 'r1');
    assert.deepEqual(calls[1].input, [{ type: 'function_call_output', call_id: 'c1', output: '3' }]);
    assert.match((calls[2].input as Array<{ output: string }>)[0].output, /no tool named nope/, 'an unknown tool is an error the model reads, not a crash');
    assert.equal(calls[3].previous_response_id, 'r3');
    assert.ok(calls[3].text, 'the last turn asks for strict JSON');
    assert.equal((calls[3].input as unknown[]).length, 1, 'nothing pending: the last turn is the question alone');
    assert.equal(calls[3].tools, undefined);
    assert.deepEqual(steps, ['count=3', 'nope=Error: no tool named nope', 'count=1', 'web_search='], 'a page opened by the built-in search is a step too');
  } finally { globalThis.fetch = real; }
});

test('the tool loop stops at its step budget: the calls over budget are answered in the final turn, never left hanging', async () => {
  const real = globalThis.fetch;
  let n = 0;
  let last: { text?: unknown; input?: unknown } = {};
  globalThis.fetch = (async (_u: string | URL, init?: RequestInit) => {
    n++;
    const body = JSON.parse(String(init?.body)) as { text?: unknown; input?: unknown };
    if (body.text) last = body;
    const reply = body.text ? { id: 'f', output: [{ type: 'message', content: [{ text: '{"ok":true}' }] }] } : { id: `r${n}`, output: [{ type: 'function_call', call_id: `c${n}`, name: 't', arguments: '{}' }] };
    return { ok: true, json: async () => reply, text: async () => '' };
  }) as typeof fetch;
  try {
    const out = await new MetaLLM('k').agent('go', [{ name: 't', description: '', args: z.object({}), run: async () => 'x' }], z.object({ ok: z.boolean() }), 'o', { maxSteps: 3 });
    assert.deepEqual(out, { ok: true });
    assert.equal(n, 5, '3 tool turns, the turn that would be a fourth call, and the JSON turn');
    const input = last.input as Array<{ type?: string; call_id?: string; output?: string; role?: string }>;
    assert.equal(input.length, 2);
    assert.equal(input[0].call_id, 'c4');
    assert.match(input[0].output!, /budget reached/);
    assert.equal(input[1].role, 'user');
  } finally { globalThis.fetch = real; }
});
