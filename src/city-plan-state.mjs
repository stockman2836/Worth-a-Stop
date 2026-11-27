// Tab-local fallbacks must be reset together with persisted planning data.
export const itineraryMemory = new Map();
export const originMemory = new Map();
export const timeMemory = new Map();

export function resetCityPlans(cityId, storage) {
  if (!Number.isSafeInteger(cityId) || cityId < 1) throw Error('Invalid city');
  const prefixes = ['v1', 'origin.v1', 'start.v1', 'end.v1'].map(kind => `worth-a-stop.itinerary.${kind}.${cityId}.`);
  const exact = [`worth-a-stop.itinerary.day.${cityId}`, `worth-a-stop.auto-plan.pace.${cityId}`];
  const matches = key => typeof key === 'string' && (exact.includes(key) || prefixes.some(prefix => key.startsWith(prefix)));
  if (storage) {
    // Snapshot before deleting; a read failure must not produce a partial reset.
    const snapshot = [];
    const length = storage.length;
    if (!Number.isSafeInteger(length) || length < 0) throw Error('Storage unavailable');
    for (let index = 0; index < length; index++) {
      const key = storage.key(index);
      if (matches(key)) {
        const value = storage.getItem(key);
        if (value != null) snapshot.push([key, value]);
      }
    }
    const attempted = [];
    try {
      for (const [key, value] of snapshot) {
        attempted.push([key, value]);
        storage.removeItem(key);
        if (storage.getItem(key) != null) throw Error('Plan deletion failed');
      }
    } catch (error) {
      let partial = false;
      for (const [key, value] of attempted) {
        try { storage.setItem(key, value); } catch { partial = true; }
      }
      throw Object.assign(Error('City reset failed', { cause: error }), { partial });
    }
  }
  for (const memory of [itineraryMemory, originMemory, timeMemory]) {
    for (const key of memory.keys()) if (matches(key)) memory.delete(key);
  }
  return { saved: Boolean(storage) };
}
