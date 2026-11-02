import { z } from 'zod';

export interface LLM {
  // Asks for JSON matching `schema`; the reply is validated, never trusted.
  // `images` are data URLs the model really sees (vision input, paid tokens).
  json<T extends z.ZodType>(prompt: string, schema: T, name: string, opts?: { images?: string[] }): Promise<z.infer<T>>;
  // Looks things up on the web and answers in prose, with the pages it relied on. Optional: not every backend can.
  search?(prompt: string): Promise<{ text: string; sources: string[] }>;
  // Works as an agent: the model calls `tools` as many times as it decides (searching, opening pages, counting),
  // then answers in JSON matching `schema`. Optional: a backend without function calling does not offer it.
  agent?<T extends z.ZodType>(prompt: string, tools: Tool[], schema: T, name: string, opts?: AgentOpts): Promise<z.infer<T>>;
}

// A tool the model may call: its arguments are validated before `run`, and whatever `run` returns is what the model reads.
export interface Tool { name: string; description: string; args: z.ZodObject<z.ZodRawShape>; run(args: Record<string, unknown>): Promise<string> }
export interface AgentOpts { maxSteps?: number; webSearch?: boolean; onStep?: (step: { tool: string; args: Record<string, unknown>; result: string }) => void }
const MAX_STEPS = 16;

const BASE = 'https://api.meta.ai/v1';

// Meta Model API, Responses API. The answer is the LAST `message` item of `output`.
export class MetaLLM implements LLM {
  #key: string;
  #model: string;

  constructor(key: string, model = 'muse-spark-1.3') {
    this.#key = key;
    this.#model = model;
  }

  async search(prompt: string) {
    const res = await fetch(`${BASE}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.#key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.#model, input: prompt, tools: [{ type: 'web_search' }] }),
    });
    if (!res.ok) throw new Error(`Meta API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { output?: Array<{ type: string; content?: Array<{ text?: string; annotations?: Array<{ type: string; url?: string }> }> }> };
    const last = (body.output ?? []).filter(i => i.type === 'message').at(-1);
    const text = (last?.content ?? []).map(c => c.text ?? '').join('');
    const sources = [...new Set((last?.content ?? []).flatMap(c => c.annotations ?? []).filter(a => a.type === 'url_citation' && a.url).map(a => a.url!))];
    return { text, sources };
  }

  // The tool loop of the Responses API: each turn is sent with `previous_response_id`, the model's `function_call`
  // items are run here and returned as `function_call_output`, until the model stops calling (or the step budget
  // runs out); one last turn, without tools, asks for the answer in strict JSON.
  async agent<T extends z.ZodType>(prompt: string, tools: Tool[], schema: T, name: string, opts: AgentOpts = {}): Promise<z.infer<T>> {
    const defs = [
      ...(opts.webSearch === false ? [] : [{ type: 'web_search' }]),
      ...tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: z.toJSONSchema(t.args) })),
    ];
    type Item = { type: string; call_id?: string; name?: string; arguments?: string; action?: Record<string, unknown> };
    // The built-in web search runs on Meta's side and reports what it did (a search, a page opened) as
    // `web_search_call` items: they are steps too, so the trail shows them.
    const builtIn = (out: Item[]) => { for (const i of out) if (i.type === 'web_search_call' && i.action) opts.onStep?.({ tool: 'web_search', args: i.action, result: '' }); };
    let res = await this.#post({ model: this.#model, input: prompt, tools: defs, tool_choice: 'auto' });
    let steps = 0;
    let pending: Array<{ type: string; call_id?: string; output: string }> = [];
    while (true) {
      builtIn(res.output ?? []);
      const calls = (res.output ?? []).filter((i: Item) => i.type === 'function_call');
      if (!calls.length) break;
      if (steps >= (opts.maxSteps ?? MAX_STEPS)) {
        // Every call must get an answer or the thread is refused: the ones over budget get a refusal, in the final turn.
        pending = calls.map((c: Item) => ({ type: 'function_call_output', call_id: c.call_id, output: 'Error: step budget reached. Write the final answer now from what you already have.' }));
        break;
      }
      const outputs = await Promise.all(calls.map(async (c: Item) => {
        const tool = tools.find(t => t.name === c.name);
        let result: string;
        let args: Record<string, unknown> = {};
        try {
          if (!tool) throw new Error(`no tool named ${c.name}`);
          args = tool.args.parse(JSON.parse(c.arguments || '{}'));
          result = await tool.run(args);
        } catch (e) { result = `Error: ${(e as Error).message}`; }
        opts.onStep?.({ tool: c.name ?? '?', args, result });
        return { type: 'function_call_output', call_id: c.call_id, output: result.slice(0, 20_000) };
      }));
      steps += calls.length;
      res = await this.#post({ model: this.#model, previous_response_id: res.id, input: outputs, tools: defs, tool_choice: 'auto' });
    }
    const final = await this.#post({
      model: this.#model, previous_response_id: res.id,
      input: [...pending, { role: 'user', content: 'Now write the final answer from everything you found, in the requested JSON. Keep only what the pages and results support.' }],
      text: { format: { type: 'json_schema', name, strict: true, schema: z.toJSONSchema(schema) } },
    });
    return schema.parse(JSON.parse(messageText(final)));
  }

  async #post(body: Record<string, unknown>) {
    const res = await fetch(`${BASE}/responses`, { method: 'POST', headers: { Authorization: `Bearer ${this.#key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Meta API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as { id: string; output?: Array<{ type: string; call_id?: string; name?: string; arguments?: string; action?: Record<string, unknown>; content?: Array<{ type: string; text?: string }> }> };
  }

  async json<T extends z.ZodType>(prompt: string, schema: T, name: string, opts: { images?: string[] } = {}): Promise<z.infer<T>> {
    // Plain text stays a string; with pictures the input becomes one user
    // message with `input_image` parts (Responses API vision input).
    const parts = [{ type: 'input_text', text: prompt }, ...(opts.images ?? []).map(image_url => ({ type: 'input_image', image_url }))];
    const res = await fetch(`${BASE}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.#key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.#model,
        input: parts.length > 1 ? [{ role: 'user', content: parts }] : prompt,
        text: { format: { type: 'json_schema', name, strict: true, schema: z.toJSONSchema(schema) } },
      }),
    });
    if (!res.ok) throw new Error(`Meta API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }> };
    const last = (body.output ?? []).filter(i => i.type === 'message').at(-1);
    const text = (last?.content ?? []).map(c => c.text ?? '').join('');
    return schema.parse(JSON.parse(text));
  }
}

const messageText = (body: { output?: Array<{ type: string; content?: Array<{ text?: string }> }> }) =>
  ((body.output ?? []).filter(i => i.type === 'message').at(-1)?.content ?? []).map(c => c.text ?? '').join('');
