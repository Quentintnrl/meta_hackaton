import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Secrets come from the environment or the repo-root .env, never from code.
// Tolerates `NAME=value`, `NAME="value"` and the malformed `NAME "value"`.
export function loadSecret(names: string[], root = resolve(import.meta.dirname, '../../..')): string | null {
  for (const n of names) if (process.env[n]) return process.env[n]!;
  const file = resolve(root, '.env');
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    for (const n of names) {
      const m = line.match(new RegExp(`^\\s*${n}\\s*[=\\s]\\s*"?([^"\\s]+)"?\\s*$`));
      if (m) return m[1];
    }
  }
  return null;
}

export const loadApiKey = () => loadSecret(['MODEL_API_KEY', 'META_API_KEY']);
export const loadFigmaToken = () => loadSecret(['FIGMA_TOKEN']);
