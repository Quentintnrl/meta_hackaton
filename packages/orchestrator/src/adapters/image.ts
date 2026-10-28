const BASE = 'https://api.meta.ai/v1';

export interface ImageGen {
  // One JPEG for a prompt.
  generate(prompt: string, size?: string): Promise<Buffer>;
}

// Muse Image through the Meta Model API.
export class MetaImage implements ImageGen {
  #key: string;

  constructor(key: string) { this.#key = key; }

  async generate(prompt: string, size = '1024x1024') {
    const res = await fetch(`${BASE}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.#key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'muse-image-1.0', prompt, n: 1, size, response_format: 'b64_json', output_format: 'jpeg' }),
    });
    if (!res.ok) throw new Error(`Meta API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const b64 = ((await res.json()) as { data?: Array<{ b64_json?: string }> }).data?.[0]?.b64_json;
    if (!b64) throw new Error('the image model returned no image');
    return Buffer.from(b64, 'base64');
  }
}
