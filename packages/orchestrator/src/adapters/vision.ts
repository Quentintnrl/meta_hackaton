import type { Box } from '../visual/types.ts';

// Finds the things a short noun phrase names in an image. An empty result means "not found", never an error.
export interface Vision {
  detect(imageDataUrl: string, phrase: string): Promise<Box[]>;
}

const BASE = 'https://api.meta.ai/v1';
const BOX = /<\|box;x1=([\d.]+);y1=([\d.]+);x2=([\d.]+);y2=([\d.]+);w=([\d.]+);h=([\d.]+)\|>/g;

// SAM 3.1 through the Responses API. It wants short, concrete phrases ("outlined button", "logo").
export class MetaSam implements Vision {
  #key: string;

  constructor(key: string) {
    this.#key = key;
  }

  async detect(imageDataUrl: string, phrase: string): Promise<Box[]> {
    const res = await fetch(`${BASE}/responses`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.#key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'sam-3.1',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: phrase }, { type: 'input_image', image_url: imageDataUrl }] }],
      }),
    });
    if (!res.ok) throw new Error(`SAM ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { output?: Array<{ type: string; content?: Array<{ text?: string }> }> };
    const text = (body.output ?? []).filter(i => i.type === 'message').flatMap(i => i.content ?? []).map(c => c.text ?? '').join('');
    return [...text.matchAll(BOX)].map(m => ({ x1: +m[1] / +m[5], y1: +m[2] / +m[6], x2: +m[3] / +m[5], y2: +m[4] / +m[6] }));
  }
}
