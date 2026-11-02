import { z } from 'zod';
import type { LLM, Tool } from '../adapters/llm.ts';
import { publicUrl } from './thumb.ts';

// What the Scout can do on its own when it works as an agent: search the web, open a public page and read
// it as text (a LinkedIn or company page, a press article, a programme), so a figure or a rhythm it reports
// comes from a page it really read, not from a summary. Nothing is written anywhere; nothing private is reached.
const TIMEOUT = 10_000, MAX_HTML = 600_000, MAX_TEXT = 9_000;

export function pageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<!--[\s\S]*?-->/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

export async function openPage(url: string, get: typeof fetch = fetch): Promise<string> {
  const u = publicUrl(url);
  if (!u) return 'Error: only public http(s) pages can be opened.';
  try {
    const res = await get(u, { signal: AbortSignal.timeout(TIMEOUT), redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; Ripple_handoff)', accept: 'text/html,*/*' } });
    if (!res.ok) return `Error: the page answered HTTP ${res.status}${res.status === 999 || res.status === 403 ? ' (it refuses robots: rely on search results and other pages for it)' : ''}.`;
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    const raw = (await res.text()).slice(0, MAX_HTML);
    const text = /html/.test(type) ? pageText(raw) : raw;
    return text ? `${res.url || url}\n${text.slice(0, MAX_TEXT)}${text.length > MAX_TEXT ? '\n…(cut)' : ''}` : 'Error: the page has no readable text.';
  } catch (e) { return `Error: could not open the page (${(e as Error).message}).`; }
}

export function scoutTools(llm: LLM, get: typeof fetch = fetch): Tool[] {
  return [
    {
      name: 'search', description: 'Search the web and get a grounded answer with the pages it relied on. Ask one precise question per call.',
      args: z.object({ query: z.string().min(3).max(400) }),
      run: async a => { if (!llm.search) return 'Error: no web search on this backend.'; const r = await llm.search(String(a.query)); return `${r.text}\nSources: ${r.sources.join(', ')}`; },
    },
    {
      name: 'open', description: 'Open a public web page and read it as text (company page, LinkedIn page, article, event programme). Use it to verify a figure, a date or a posting rhythm before reporting it.',
      args: z.object({ url: z.string().url() }),
      run: a => openPage(String(a.url), get),
    },
  ];
}
