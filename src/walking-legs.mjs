export async function walkingLegs(stops, { signal, fetchResponse = fetch, onProgress = () => {} } = {}) {
  const legs = [];
  for (let i = 1; i < stops.length; i++) {
    signal?.throwIfAborted();
    const from = stops[i - 1];
    const to = stops[i];
    let leg = { from, to, status: 'missing-location' };
    if (from.location && to.location) {
      try {
        const params = new URLSearchParams({
          fromLat: from.location.latitude, fromLon: from.location.longitude,
          toLat: to.location.latitude, toLon: to.location.longitude,
        });
        const timeout = AbortSignal.timeout(30000);
        const response = await fetchResponse('/api/walking?' + params, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
        if (!response.ok) throw Error('Walking route unavailable');
        const result = await response.json();
        leg = { from, to, ...result };
      } catch {
        signal?.throwIfAborted();
        leg = { from, to, status: 'unavailable' };
      }
    }
    signal?.throwIfAborted();
    legs.push(leg);
    onProgress([...legs]);
  }
  return legs;
}
