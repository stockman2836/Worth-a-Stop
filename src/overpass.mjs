// Shared transport keeps area discovery and place queries on the same fallback policy.
export async function overpassQuery(query, { signal, fetchResponse = fetch } = {}) {
  const data = `[out:json][timeout:20];${query}`;
  const endpoints = ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  for (const [index, endpoint] of endpoints.entries()) {
    signal?.throwIfAborted();
    try {
      const url = new URL(endpoint);
      const post = index === 2;
      if (!post) url.searchParams.set('data', data);
      const timeout = AbortSignal.timeout(26000);
      const response = await fetchResponse(url, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { 'User-Agent': 'Worth-a-Stop/0.1 (city travel planner)', ...(post && { 'Content-Type': 'application/x-www-form-urlencoded' }) },
        ...(post && { method: 'POST', body: new URLSearchParams({ data }).toString() }),
      });
      if (!response.ok) throw Error('Place search unavailable');
      const { elements, remark } = await response.json();
      if (remark || !Array.isArray(elements)) throw Error('Incomplete place search');
      signal?.throwIfAborted();
      return elements;
    } catch (error) {
      signal?.throwIfAborted();
      if (index === endpoints.length - 1) throw error;
    }
  }
}
