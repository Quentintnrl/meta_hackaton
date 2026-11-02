import type { AccountPost } from './types.ts';

// Facts computed from the posts themselves, with no model: the pace and its silences, the drift of the
// likes, what asking a question or writing long changes, the weekday, the words of the best posts,
// and reach against reactions where the platform gives views. Every group carries its size, so the
// console and the Analyst can say when a difference is too small to mean anything.
export interface Group { n: number; avg: number }
export interface Facts {
  n: number; first: string; last: string; perMonth: number; daysSinceLast: number;
  silences: Array<{ from: string; to: string; days: number }>;
  trend: { early: Group; late: Group; last5: Group; direction: 'up' | 'down' | 'flat' };
  question: { asked: Group; not: Group };
  length: Array<{ label: 'short' | 'medium' | 'long'; max: number } & Group>;
  weekday: Array<{ day: number } & Group>; // 0 = Monday
  hooks: Array<{ kind: 'question' | 'number' | 'you' | 'other' } & Group>; // how the first line opens
  words: Array<{ word: string; best: number; rest: number }>; // share of posts using the word, in the best third and in the others
  reach: Array<{ text: string; views: number; likes: number; shares: number; rate: number; postedAt: string }>;
  best: { text: string; likes: number; postedAt: string; platform: string };
  worst: { text: string; likes: number; postedAt: string; platform: string };
  comments: number; thin: boolean; // thin: the numbers cannot rank anything
}

const DAY = 86_400_000;
const group = (xs: AccountPost[]): Group => ({ n: xs.length, avg: xs.length ? Math.round((xs.reduce((a, p) => a + p.likes, 0) / xs.length) * 10) / 10 : 0 });
const weekday = (iso: string) => (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7;
const STOP = new Set('le la les un une des du de d l et ou à a au aux en dans sur pour par avec sans ce cet cette ces se sa son ses leur leurs vous votre vos nous notre nos il elle ils elles on ne pas plus que qui quoi dont où est sont été être avoir fait faire comme mais donc car si tout tous toute toutes même aussi très bien peu chaque entre vers chez the and or of to in for with on at by is are be it this that your you we our from as an'.split(' '));
const SILENCE_DAYS = 21;

export function accountFacts(posts: AccountPost[], today: string): Facts | null {
  if (!posts.length) return null;
  const sorted = [...posts].sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  const first = sorted[0].postedAt, last = sorted.at(-1)!.postedAt;
  const months = Math.max(1, (Date.parse(last) - Date.parse(first)) / (30.4 * DAY));
  const silences: Facts['silences'] = [];
  for (let i = 1; i < sorted.length; i++) {
    const days = Math.round((Date.parse(sorted[i].postedAt) - Date.parse(sorted[i - 1].postedAt)) / DAY);
    if (days > SILENCE_DAYS) silences.push({ from: sorted[i - 1].postedAt, to: sorted[i].postedAt, days });
  }
  const half = Math.floor(sorted.length / 2);
  const early = group(sorted.slice(0, half)), late = group(sorted.slice(half));
  const direction = early.n && late.n ? (late.avg > early.avg * 1.2 ? 'up' : late.avg < early.avg * 0.8 ? 'down' : 'flat') : 'flat';
  const asks = (p: AccountPost) => p.text.includes('?');
  const length = ([['short', 120], ['medium', 300], ['long', Infinity]] as const).map(([label, max], i, all) => {
    const min = i ? all[i - 1][1] : 0;
    return { label, max: max === Infinity ? 0 : max, ...group(posts.filter(p => p.text.length > min && p.text.length <= max)) };
  });
  const hookOf = (p: AccountPost): 'question' | 'number' | 'you' | 'other' => { const l = p.text.split('\n')[0].trim(); return /\?\s*$/.test(l) || /^(et si|pourquoi|comment|où|quand|qui|que|what|why|how|where|when|who)\b/i.test(l) ? 'question' : /^\d/.test(l) ? 'number' : /^(vous|votre|vos|you|your|tu|ton|ta|tes)\b/i.test(l) ? 'you' : 'other'; };
  const hooks = (['question', 'number', 'you', 'other'] as const).map(kind => ({ kind, ...group(posts.filter(p => hookOf(p) === kind)) }));
  const wd = Array.from({ length: 7 }, (_, day) => ({ day, ...group(posts.filter(p => weekday(p.postedAt) === day)) }));
  const byLikes = [...posts].sort((a, b) => b.likes - a.likes);
  const third = Math.max(1, Math.floor(posts.length / 3));
  const bestThird = byLikes.slice(0, third), rest = byLikes.slice(third);
  const wordsOf = (p: AccountPost) => new Set(p.text.toLowerCase().replace(/[’']/g, ' ').match(/[a-zà-ÿ]{3,}/g) ?? []);
  const share = (xs: AccountPost[], w: string) => xs.length ? xs.filter(p => wordsOf(p).has(w)).length / xs.length : 0;
  const candidates = new Map<string, number>();
  for (const p of bestThird) for (const w of wordsOf(p)) if (!STOP.has(w)) candidates.set(w, (candidates.get(w) ?? 0) + 1);
  const words = [...candidates.keys()]
    .map(word => ({ word, best: share(bestThird, word), rest: share(rest, word) }))
    .filter(w => w.best >= 0.25 && w.best >= w.rest * 2)
    .sort((a, b) => b.best - b.rest - (a.best - a.rest) || b.best - a.best)
    .slice(0, 8)
    .map(w => ({ word: w.word, best: Math.round(w.best * 100) / 100, rest: Math.round(w.rest * 100) / 100 }));
  const reach = posts.filter(p => p.views).map(p => ({ text: p.text, views: p.views!, likes: p.likes, shares: p.shares, rate: Math.round((p.likes / p.views!) * 1000) / 10, postedAt: p.postedAt })).sort((a, b) => b.views - a.views);
  const pick = (p: AccountPost) => ({ text: p.text, likes: p.likes, postedAt: p.postedAt, platform: p.platform ?? 'instagram' });
  const comments = posts.reduce((a, p) => a + p.comments, 0);
  return {
    n: posts.length, first, last, perMonth: Math.round((posts.length / months) * 10) / 10, daysSinceLast: Math.max(0, Math.round((Date.parse(today) - Date.parse(last)) / DAY)),
    silences, trend: { early, late, last5: group(sorted.slice(-5)), direction },
    question: { asked: group(posts.filter(asks)), not: group(posts.filter(p => !asks(p))) },
    length, weekday: wd, hooks, words, reach,
    best: pick(byLikes[0]), worst: pick(byLikes.at(-1)!), comments,
    thin: byLikes[0].likes < 50 && comments < 5,
  };
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
// The same facts as a few lines for the Analyst, exact numbers, group sizes included.
export function factsText(f: Facts): string {
  const g = (x: Group) => `${x.avg} likes avg over ${x.n}`;
  const busiest = [...f.weekday].sort((a, b) => b.n - a.n)[0];
  return [
    `${f.n} posts from ${f.first} to ${f.last}, ${f.perMonth} a month, last one ${f.daysSinceLast} days ago.${f.silences.length ? ` Silences over ${SILENCE_DAYS} days: ${f.silences.map(s => `${s.days} days (${s.from} to ${s.to})`).join(', ')}.` : ''}`,
    `Likes drift: first half ${g(f.trend.early)}, second half ${g(f.trend.late)}, last five ${g(f.trend.last5)} (${f.trend.direction}).`,
    `Posts that ask a question: ${g(f.question.asked)}; posts that do not: ${g(f.question.not)}. Comments in all: ${f.comments}.`,
    `Length: ${f.length.map(l => `${l.label} ${g(l)}`).join('; ')}.`,
    `First line opens with: ${f.hooks.filter(h => h.n).map(h => `${h.kind === 'you' ? 'you/vous' : h.kind} ${g(h)}`).join('; ')}.`,
    `Weekday: most posts on ${DAYS[busiest.day]} (${busiest.n}); ${f.weekday.filter(w => w.n).map(w => `${DAYS[w.day]} ${g(w)}`).join(', ')}.`,
    f.words.length ? `Words more present in the best third of posts: ${f.words.map(w => `${w.word} (${Math.round(w.best * 100)}% vs ${Math.round(w.rest * 100)}%)`).join(', ')}.` : '',
    f.reach.length ? `Reach where known: ${f.reach.map(r => `"${r.text.slice(0, 40)}…" ${r.views} views, ${r.likes} reactions (${r.rate}%)`).join('; ')}.` : '',
    f.thin ? 'These numbers are too small to rank formats: a few likes apart is noise. Read the pace, the silence, the drift and the words, not format averages.' : '',
  ].filter(Boolean).join('\n');
}
