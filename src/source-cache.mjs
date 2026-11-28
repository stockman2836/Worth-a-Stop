// Coalesce active work even on refresh, and give unavailable sources time to
// recover. Both successful and failed lifetimes start after completion.
export function createSourceCache({ now = Date.now, ttl = 600000, failureTtl = 60000, limit = 80 } = {}) {
  const entries = new Map();
  return (key, load, { refresh = false } = {}) => {
    const saved = entries.get(key);
    if (saved?.pending || saved?.expires > now() && (!refresh || saved.failed)) return saved.promise;
    if (entries.size >= limit) {
      const oldest = [...entries].find(([, entry]) => !entry.pending);
      if (oldest) entries.delete(oldest[0]);
    }
    const entry = { pending: true };
    entry.promise = Promise.resolve().then(load).then(value => {
      entry.pending = false; entry.expires = now() + ttl;
      return value;
    }, error => {
      entry.pending = false; entry.failed = true;
      entry.expires = error.retryAt > now() ? error.retryAt : now() + failureTtl;
      error.retryAt = entry.expires;
      throw error;
    });
    entries.set(key, entry);
    return entry.promise;
  };
}
