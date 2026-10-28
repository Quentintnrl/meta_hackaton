import { z } from 'zod';

export interface LLM {
  // Asks for JSON matching `schema`; the reply is validated, never trusted.
  json<T extends z.ZodType>(prompt: string, schema: T, name: string): Promise<z.infer<T>>;
  // Looks things up on the web and answers in prose, with the pages it relied on. Optional: not every backend can.
  search?(prompt: string): Promise<{ text: string; sources: string[] }>;
}

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

  async json<T extends z.ZodType>(prompt: string, schema: T, name: string): Promise<z.infer<T>> {
    const res = await fetch(`${BASE}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.#key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.#model,
        input: prompt,
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
