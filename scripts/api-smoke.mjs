#!/usr/bin/env node
// Smoke test of the Meta Model API calls Ripple_handoff depends on.
// No dependencies (Node 18+ fetch). Reads MODEL_API_KEY from the environment or ../.env.
//
//   node scripts/api-smoke.mjs                  run everything
//   node scripts/api-smoke.mjs --only text,sam  run a subset
//   node scripts/api-smoke.mjs --skip image     skip a test (image generation is billed per image)
//   node scripts/api-smoke.mjs --image path.png use another screenshot for the SAM test

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://api.meta.ai/v1';
const MODEL = 'muse-spark-1.3';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : (process.argv[i + 1] ?? '');
}
const only = arg('only')?.split(',');
const skip = arg('skip')?.split(',') ?? [];
const imagePath = resolve(arg('image') ?? resolve(ROOT, '../mealkinator/assets/mockup-week-before.png'));

function loadKey() {
  if (process.env.MODEL_API_KEY) return process.env.MODEL_API_KEY;
  const envFile = resolve(ROOT, '.env');
  if (!existsSync(envFile)) return null;
  // Tolerates `NAME=value`, `NAME="value"` and the malformed `NAME "value"`.
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:MODEL_API_KEY|META_API_KEY)\s*[=\s]\s*"?([^"\s]+)"?\s*$/);
    if (m) return m[1];
  }
  return null;
}
const KEY = loadKey();
if (!KEY) {
  console.error('No API key found. Put MODEL_API_KEY="..." in .env (or export it).');
  process.exit(1);
}

async function api(path, body) {
  const started = Date.now();
  const res = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { ok: res.ok, status: res.status, json, text, ms: Date.now() - started };
}

function outputText(json) {
  const parts = [];
  for (const item of json?.output ?? []) {
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) if (c.type === 'output_text') parts.push(c.text);
  }
  return parts.join('');
}

const short = (s, n = 160) => (s.length > n ? s.slice(0, n) + '…' : s).replace(/\s+/g, ' ');
const errText = r => `HTTP ${r.status} ${short(r.json ? JSON.stringify(r.json) : r.text, 300)}`;

const tests = {
  async models() {
    const r = await api('/models');
    if (!r.ok) return { pass: false, note: errText(r) };
    const ids = (r.json?.data ?? []).map(m => m.id);
    const need = [MODEL, 'sam-3.1', 'muse-image-1.0'];
    const missing = need.filter(m => !ids.includes(m));
    return { pass: missing.length === 0, note: missing.length ? `missing: ${missing.join(', ')}` : `${ids.length} models, all required present`, ms: r.ms };
  },

  async text() {
    const r = await api('/responses', { model: MODEL, input: 'Reply with exactly one word: pong' });
    if (!r.ok) return { pass: false, note: errText(r) };
    const t = outputText(r.json);
    return { pass: /pong/i.test(t), note: `output_text="${short(t, 60)}"`, ms: r.ms };
  },

  async search() {
    const r = await api('/responses', {
      model: MODEL,
      input: 'In two sentences, what content themes are trending on Instagram for home cooking and weekly meal planning right now?',
      tools: [{ type: 'web_search' }],
    });
    if (!r.ok) return { pass: false, note: errText(r) };
    const searched = (r.json.output ?? []).some(i => i.type === 'web_search_call');
    // The answer is the LAST message item; earlier ones are intermediate reasoning rounds.
    const last = (r.json.output ?? []).filter(i => i.type === 'message').at(-1);
    const cites = (last?.content ?? []).flatMap(c => c.annotations ?? []).filter(a => a.type === 'url_citation' && a.url);
    return {
      pass: searched && cites.length > 0,
      note: `web_search_call=${searched}, citations=${cites.length}, text="${short((last?.content ?? []).map(c => c.text ?? '').join(''), 120)}"`,
      ms: r.ms,
    };
  },

  async structured() {
    const schema = {
      type: 'object',
      properties: { dish: { type: 'string' }, minutes: { type: 'integer' }, vegetarian: { type: 'boolean' } },
      required: ['dish', 'minutes', 'vegetarian'],
      additionalProperties: false,
    };
    const input = 'Give one quick weeknight dinner idea.';
    // Responses API shape (OpenAI-style text.format). The docs do not show it, so we also try chat completions.
    const a = await api('/responses', {
      model: MODEL,
      input,
      text: { format: { type: 'json_schema', name: 'dinner', strict: true, schema } },
    });
    if (a.ok) {
      try {
        const o = JSON.parse(outputText(a.json));
        if (typeof o.dish === 'string' && Number.isInteger(o.minutes) && typeof o.vegetarian === 'boolean') {
          return { pass: true, note: `responses text.format OK: ${short(JSON.stringify(o), 100)}`, ms: a.ms };
        }
      } catch { /* fall through */ }
    }
    const b = await api('/chat/completions', {
      model: MODEL,
      messages: [{ role: 'user', content: input }],
      response_format: { type: 'json_schema', json_schema: { name: 'dinner', strict: true, schema } },
    });
    if (!b.ok) return { pass: false, note: `responses: ${a.ok ? 'bad JSON' : errText(a)} | chat: ${errText(b)}` };
    try {
      const o = JSON.parse(b.json.choices[0].message.content);
      return { pass: typeof o.dish === 'string', note: `only chat completions response_format works (responses: ${a.ok ? 'bad JSON' : errText(a)}): ${short(JSON.stringify(o), 80)}`, ms: b.ms };
    } catch (e) {
      return { pass: false, note: `chat returned invalid JSON: ${e.message}` };
    }
  },

  async sam() {
    if (!existsSync(imagePath)) return { pass: false, note: `image not found: ${imagePath}` };
    const dataUrl = 'data:image/png;base64,' + readFileSync(imagePath).toString('base64');
    // SAM wants short, concrete noun phrases. An empty output means "no match", not an error.
    // On the Mealkinator "before" screen: "outlined button" and "logo" match, "button" and "card" do not.
    const prompts = ['outlined button', 'logo'];
    const found = {};
    for (const p of prompts) {
      const r = await api('/responses', {
        model: 'sam-3.1',
        input: [{ type: 'message', role: 'user', content: [
          { type: 'input_text', text: p },
          { type: 'input_image', image_url: dataUrl },
        ] }],
      });
      if (!r.ok) return { pass: false, note: `"${p}": ${errText(r)}` };
      found[p] = [...outputText(r.json).matchAll(/<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+)/g)].map(m => [+m[1], +m[2], +m[3], +m[4]]);
    }
    const hits = Object.entries(found).filter(([, b]) => b.length);
    return {
      pass: hits.length > 0,
      note: `${hits.length}/${prompts.length} prompts matched in ${imagePath.split('/').pop()}: ${short(JSON.stringify(found), 160)}`,
    };
  },

  async image() {
    const r = await api('/images/generations', {
      model: 'muse-image-1.0',
      prompt: 'A flat illustration of a French brasserie bell cloche releasing steam, cream background, burgundy and gold accents, no text, no people',
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
      output_format: 'jpeg',
    });
    if (!r.ok) return { pass: false, note: errText(r) };
    const b64 = r.json?.data?.[0]?.b64_json;
    if (!b64) return { pass: false, note: 'no b64_json in response' };
    const buf = Buffer.from(b64, 'base64');
    mkdirSync(resolve(ROOT, 'out'), { recursive: true });
    const file = resolve(ROOT, 'out/smoke-image.jpeg');
    writeFileSync(file, buf);
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    return { pass: isJpeg, note: `${buf.length} bytes, JPEG=${isJpeg}, saved to out/smoke-image.jpeg`, ms: r.ms };
  },
};

const names = Object.keys(tests).filter(n => (!only || only.includes(n)) && !skip.includes(n));
let failed = 0;
for (const n of names) {
  let res;
  try { res = await tests[n](); } catch (e) { res = { pass: false, note: `exception: ${e.message}` }; }
  if (!res.pass) failed++;
  console.log(`${res.pass ? 'PASS' : 'FAIL'}  ${n.padEnd(11)} ${res.ms ? `${res.ms} ms  ` : ''}${res.note}`);
}
console.log(failed ? `\n${failed} test(s) failed.` : '\nAll tests passed.');
process.exit(failed ? 1 : 0);
