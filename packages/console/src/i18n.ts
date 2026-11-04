// The interface in English or in French. The English string is the key: t('Yes, write it') returns the
// French line when the manager chose French, the string itself otherwise, so a line without a translation
// still reads. The choice lives in this browser; switching reloads the page.
// Translations: one file per screen in ./i18n/fr-*.ts, each exporting `fr: Record<string, string>`.
// Variables: t('{n} posts', { n }) replaces {n} in the key and in its translation.
// The content the agents produce is not touched here: its language is the project's, set in Settings.
export type Lang = 'en' | 'fr';

const read = (): Lang => {
  // ?lang=fr in the URL wins once and is remembered (handy for a demo link).
  try { const q = new URLSearchParams(location.search).get('lang'); if (q === 'fr' || q === 'en') { localStorage.setItem('lang', q); return q; } } catch { /* no window */ }
  try { const l = localStorage.getItem('lang'); if (l === 'fr' || l === 'en') return l; } catch { /* private window */ }
  return typeof navigator !== 'undefined' && (navigator.language ?? '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
};
export const lang: Lang = read();
// For dates and numbers.
export const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';

export function setLang(l: Lang) {
  if (l === lang) return;
  try { localStorage.setItem('lang', l); } catch { /* private window: the choice lasts for this tab */ }
  location.reload();
}

const mods = import.meta.glob('./i18n/fr-*.ts', { eager: true }) as Record<string, { fr: Record<string, string> }>;
const FR: Record<string, string> = Object.assign({}, ...Object.values(mods).map(m => m.fr));

export function t(s: string, vars?: Record<string, string | number>): string {
  let out = lang === 'fr' ? (FR[s] ?? s) : s;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

// Plural in one call: t2(n, 'piece', 'pieces') → "1 piece", "3 pieces" (both forms are keys, translated on their own).
export const t2 = (n: number, one: string, many: string, vars: Record<string, string | number> = {}) => t(n === 1 ? one : many, { n, ...vars });
