import { loadSecret } from '../config.ts';
import type { AccountPost } from './types.ts';

// The app reads an Instagram account on its own through the Instagram Graph API (Meta): the account
// must be a professional one linked to a Facebook Page, and the manager gives its id and a token
// in .env. Without them, the Platforms page keeps its paste box. Nothing is scraped.
export interface InstagramConfig { userId: string; token: string }
export const loadInstagram = (): InstagramConfig | null => {
  const userId = loadSecret(['INSTAGRAM_USER_ID']);
  const token = loadSecret(['INSTAGRAM_ACCESS_TOKEN']);
  return userId && token ? { userId, token } : null;
};

export interface InstagramRead { username: string; followers: number; posts: AccountPost[] }
type Fetch = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
const BASE = 'https://graph.facebook.com/v21.0';

type Media = { id: string; caption?: string; media_type: string; media_product_type?: string; timestamp: string; like_count?: number; comments_count?: number };
type Insight = { name: string; values?: Array<{ value: number }> };

// Reads the profile, then the posts (newest first, up to `limit`), then the insights of each post the API
// grants (reach, saves, shares): a post whose insights are refused keeps its public counts and 0 elsewhere.
export async function readInstagram(cfg: InstagramConfig, fetchFn: Fetch = fetch as Fetch, limit = 50): Promise<InstagramRead> {
  const get = async <T>(path: string, params: Record<string, string>): Promise<T> => {
    const q = new URLSearchParams({ ...params, access_token: cfg.token });
    const r = await fetchFn(path.startsWith('http') ? path : `${BASE}/${path}?${q}`);
    const body = await r.json() as T & { error?: { message?: string } };
    if (!r.ok || body?.error) throw new Error(`Instagram API: ${body?.error?.message ?? `HTTP ${r.status}`}`);
    return body;
  };
  const me = await get<{ username?: string; followers_count?: number }>(cfg.userId, { fields: 'username,followers_count' });
  const media: Media[] = [];
  let page = await get<{ data: Media[]; paging?: { next?: string } }>(`${cfg.userId}/media`, { fields: 'id,caption,media_type,media_product_type,timestamp,like_count,comments_count', limit: String(Math.min(limit, 50)) });
  while (true) {
    media.push(...page.data);
    if (media.length >= limit || !page.paging?.next) break;
    page = await get(page.paging.next, {});
  }
  const posts: AccountPost[] = [];
  for (const m of media.slice(0, limit)) {
    const extra = { reach: 0, saved: 0, shares: 0 };
    try {
      const ins = await get<{ data: Insight[] }>(`${m.id}/insights`, { metric: 'reach,saved,shares' });
      for (const i of ins.data) if (i.name in extra) extra[i.name as keyof typeof extra] = i.values?.[0]?.value ?? 0;
    } catch { /* older posts and some media types have no insights: keep the public counts */ }
    posts.push({
      platform: 'instagram', text: (m.caption ?? '').trim() || '(no caption)', format: formatOf(m),
      likes: m.like_count ?? 0, comments: m.comments_count ?? 0, shares: extra.shares, saves: extra.saved, views: extra.reach || undefined,
      postedAt: m.timestamp.slice(0, 10), simulated: false,
    });
  }
  return { username: me.username ?? '', followers: me.followers_count ?? 0, posts };
}

const formatOf = (m: Media) => m.media_type === 'CAROUSEL_ALBUM' ? 'carousel' : m.media_type === 'VIDEO' ? (m.media_product_type === 'REELS' ? 'reel' : 'video') : 'image';
