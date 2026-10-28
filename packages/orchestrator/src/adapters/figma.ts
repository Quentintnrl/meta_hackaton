// The design is the source of truth: the mockup image and the frame's structure come from Figma.
export interface FigmaFrame {
  png: Buffer;
  outline: string; // names and texts of the frame's layers, for the planner
}

export interface Figma {
  fetchFrame(url: string): Promise<FigmaFrame>;
}

export interface FrameRef {
  fileKey: string;
  nodeId: string; // "3:102"
}

// figma.com/design/<key>/<name>?node-id=3-102 (also /file/, and /branch/<branchKey>/ which wins over the file key).
export function parseFigmaUrl(input: string): FrameRef | null {
  let u: URL;
  try { u = new URL(input.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || !/^(www\.)?figma\.com$/.test(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (!['design', 'file'].includes(parts[0] ?? '')) return null;
  const fileKey = parts[2] === 'branch' ? parts[3] : parts[1];
  const node = u.searchParams.get('node-id');
  if (!fileKey || !/^[A-Za-z0-9]+$/.test(fileKey) || !node || !/^\d+[-:]\d+$/.test(node)) return null;
  return { fileKey, nodeId: node.replace('-', ':') };
}

interface Node {
  type: string;
  name: string;
  characters?: string;
  children?: Node[];
}

// Drawing primitives say nothing about what the screen contains.
const SKIP = new Set(['VECTOR', 'ELLIPSE', 'STAR', 'LINE', 'POLYGON', 'BOOLEAN_OPERATION']);
const DEFAULT_NAME = /^(Frame|Group|Rectangle|Vector|Ellipse)( \d+)?$/;

// A short indented list of layer names and texts: enough for a planner to know what the screen contains.
// Unnamed wrappers (Frame, Group) are walked through without a line of their own.
export function outlineOf(root: Node, maxLines = 150, maxDepth = 8): string {
  const lines: string[] = [];
  const walk = (n: Node, depth: number, level: number) => {
    if (lines.length >= maxLines || SKIP.has(n.type) || depth > maxDepth) return;
    const wrapper = !n.characters && DEFAULT_NAME.test(n.name) && depth > 0;
    if (!wrapper) {
      const text = n.characters ? `: ${n.characters.replace(/\s+/g, ' ').slice(0, 80)}` : '';
      lines.push(`${'  '.repeat(level)}${n.type.toLowerCase()} "${n.name}"${text}`);
    }
    for (const c of n.children ?? []) walk(c, depth + 1, wrapper ? level : level + 1);
  };
  walk(root, 0, 0);
  return lines.join('\n');
}

const API = 'https://api.figma.com/v1';

export class FigmaClient implements Figma {
  #token: () => string | null;

  // A function rather than a value: the token is read at each call, so editing .env needs no restart.
  constructor(token: string | (() => string | null)) {
    this.#token = typeof token === 'function' ? token : () => token;
  }

  async #get(path: string): Promise<unknown> {
    const token = this.#token();
    if (!token) throw new Error('FIGMA_TOKEN is not set. Add it to .env.');
    // The token only ever goes to api.figma.com.
    const res = await fetch(API + path, { headers: { 'X-Figma-Token': token } });
    if (res.status === 403) throw new Error('Figma refused the token, or the file is not shared with the account that owns it (read access is enough).');
    if (res.status === 404) throw new Error('Figma could not find this file or frame. Check the link.');
    if (!res.ok) throw new Error(`Figma API ${res.status}`);
    return res.json();
  }

  async fetchFrame(url: string): Promise<FigmaFrame> {
    const ref = parseFigmaUrl(url);
    if (!ref) throw new Error('This is not a link to a Figma frame. In Figma: right-click the frame, Copy/Paste as, Copy link to selection.');
    const id = encodeURIComponent(ref.nodeId);

    const [images, nodes] = await Promise.all([
      this.#get(`/images/${ref.fileKey}?ids=${id}&format=png&scale=1`) as Promise<{ images?: Record<string, string | null> }>,
      this.#get(`/files/${ref.fileKey}/nodes?ids=${id}&depth=8`) as Promise<{ nodes?: Record<string, { document: Node } | null> }>,
    ]);
    const imageUrl = images.images?.[ref.nodeId];
    const doc = nodes.nodes?.[ref.nodeId]?.document;
    if (!imageUrl || !doc) throw new Error('Figma returned nothing for this node. Is the link pointing at a frame?');
    if (!imageUrl.startsWith('https://')) throw new Error('Figma returned an unexpected image address.');

    const img = await fetch(imageUrl); // a pre-signed address: no token
    if (!img.ok) throw new Error(`Downloading the frame image failed (${img.status}).`);
    return { png: Buffer.from(await img.arrayBuffer()), outline: outlineOf(doc) };
  }
}
