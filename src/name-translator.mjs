import { translationKey } from './name-translation.mjs';

const day = 86400000;
// One shared queue and budget per server, including concurrent city requests.
export function createNameTranslator({ fetchResponse = fetch, cache, now = Date.now, dailyLimit = 4500 } = {}) {
  const memory = new Map();
  let queue = Promise.resolve(), budget, blockedUntil = 0, pending = 0;
  async function translate(items, target, signal) {
    const translations = [], deadline = now() + 6000;
    for (const item of items) {
      if (signal?.aborted) break;
      const key = 'name-translation-v1/' + translationKey(item, target);
      let saved = memory.get(key) || await cache?.get(key);
      if (saved?.expires > now() && typeof saved.value === 'string') {
        memory.set(key, saved); translations.push({ ...item, translation: saved.value }); continue;
      }
      if (blockedUntil > now()) continue;
      if (deadline - now() < 100) break;
      const date = new Date(now()).toISOString().slice(0, 10);
      if (budget?.date !== date) {
        const stored = await cache?.get('name-translation-budget-v1');
        budget = { date, used: stored?.value?.date === date ? stored.value.used : 0 };
        if (!Number.isFinite(budget.used) || budget.used < 0) budget.used = dailyLimit;
      }
      if (budget.used + item.text.length > dailyLimit) {
        blockedUntil = Date.parse(date) + day; continue;
      }
      // Reserve before sending: failed upstream requests may also consume quota.
      budget.used += item.text.length;
      await cache?.set('name-translation-budget-v1', { value: budget, expires: now() + 2 * day });
      try {
        const url = new URL('https://api.mymemory.translated.net/get');
        url.searchParams.set('q', item.text); url.searchParams.set('langpair', item.source + '|' + target);
        const response = await fetchResponse(url, { signal: AbortSignal.timeout(Math.min(3500, deadline - now())) });
        if (!response.ok) throw Error('Translation unavailable');
        const result = await response.json();
        if (result.quotaFinished || Number(result.responseStatus) === 429) {
          blockedUntil = Date.parse(date) + day; continue;
        }
        const value = result.responseData?.translatedText;
        if (Number(result.responseStatus) !== 200 || typeof value !== 'string' || !value.trim() || value.length > 500 ||
            /[<>]|MYMEMORY WARNING|INVALID LANGUAGE PAIR/i.test(value)) throw Error('Invalid translation');
        saved = { value: value.trim(), expires: now() + 30 * day };
        memory.set(key, saved);
        if (memory.size > 2000) memory.delete(memory.keys().next().value);
        await cache?.set(key, saved);
        translations.push({ ...item, translation: saved.value });
      } catch { blockedUntil = now() + 60000; }
    }
    return { translations, ...(blockedUntil > now() && { retryAt: blockedUntil }) };
  }
  return (items, target, signal) => {
    if (pending >= 16) return Promise.resolve({ translations: [], retryAt: now() + 60000 });
    pending++;
    const job = queue.then(() => translate(items, target, signal)).finally(() => { pending--; });
    queue = job.catch(() => {});
    return job;
  };
}
