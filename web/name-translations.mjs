import { translationKey } from './name-translation.mjs';
import { rememberNameTranslations } from './place-name.mjs';
import { diagnostic } from './diagnostics.mjs';

const key = 'worth-a-stop.name-translations.v1', lifetime = 30 * 86400000;
const cache = new Map();
const listeners = new Set();
export function watchNameTranslations(listener, signal) {
  if (signal?.aborted) return;
  listeners.add(listener);
  signal?.addEventListener('abort', () => listeners.delete(listener), { once: true });
}
let loaded = false, retryAt = 0, reason;
export function translationAvailability() { return retryAt > Date.now() ? { state: 'paused', reason, retryAt } : { state: 'ready' }; }
function load() {
  if (loaded) return; loaded = true;
  try {
    const entries = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(entries)) for (const [id, entry] of entries.slice(-1000)) {
      if (typeof id === 'string' && typeof entry?.translation === 'string' && entry.translation.length <= 500 && entry.expires > Date.now()) cache.set(id, entry);
    }
  } catch { /* Storage is optional. */ }
}
export async function translateNames(items, target, { signal } = {}) {
  load();
  const unique = [...new Map(items.map(item => [translationKey(item, target), item])).values()].slice(0, 4);
  const saved = [], missing = [];
  for (const item of unique) {
    const value = cache.get(translationKey(item, target));
    if (value?.expires > Date.now()) saved.push({ ...item, translation: value.translation });
    else missing.push(item);
  }
  if (missing.length && retryAt <= Date.now() && !signal?.aborted) {
    try {
      const response = await fetch('/api/name-translations', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: missing, target }), signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(18000)]) });
      if (!response.ok) throw Error('Translation API HTTP ' + response.status + (response.status === 404 ? '; restart the application server after updating' : ''));
      const result = await response.json();
      if (Number.isFinite(result.retryAt)) { retryAt = Math.max(retryAt, result.retryAt); reason = result.reason || 'provider-unavailable'; }
      if (!Array.isArray(result.translations)) throw Error('Invalid translations');
      for (const item of missing) {
        const match = result.translations.find(entry => entry.text === item.text && entry.source === item.source);
        if (typeof match?.translation !== 'string' || !match.translation.trim() || match.translation.length > 500) continue;
        const entry = { ...item, translation: match.translation };
        saved.push(entry); cache.set(translationKey(item, target), { translation: entry.translation, expires: Date.now() + lifetime });
      }
      while (cache.size > 1000) cache.delete(cache.keys().next().value);
      try { localStorage.setItem(key, JSON.stringify([...cache])); } catch { /* Memory cache still works. */ }
    } catch (error) {
      if (!signal?.aborted) {
        retryAt = Date.now() + 60000; reason = 'request-failed';
        diagnostic('translation', 'request-failed', { target, message: error.message, retryAt });
      }
    }
  }
  if (signal?.aborted) return [];
  rememberNameTranslations(saved, target);
  diagnostic('translation', 'batch', { target, requested: unique.length, translated: saved.length,
    names: saved.map(item => ({ original: item.text, translation: item.translation })), ...translationAvailability() });
  if (saved.length) for (const listener of listeners) listener(target);
  return saved;
}
