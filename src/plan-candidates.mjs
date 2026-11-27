import { loadPlaces } from './saved-places.mjs';
import { findDayEvents, mergeListings, officialOnDay } from './day-agenda.mjs';

export async function loadPlanCandidates(city, day, { signal, storage, fetchResponse = fetch } = {}) {
  const results = await Promise.allSettled([
    loadPlaces(city, { signal, storage, fetchResponse }),
    findDayEvents(city, day, { signal, fetchResponse }),
    fetchResponse('/api/official-events/' + city.id + '?' + new URLSearchParams({ date: day }), { signal }).then(async response => {
      if (!response.ok) throw Error('Calendar unavailable');
      return officialOnDay(await response.json(), day, city.timezone || 'UTC');
    }),
  ]);
  signal?.throwIfAborted();
  const places = results[0].status === 'fulfilled' ? results[0].value.places : [];
  const events = mergeListings(results.slice(1).flatMap(result => result.status === 'fulfilled' ? result.value.events : []));
  return { places, events, stalePlaces: results[0].status === 'fulfilled' && results[0].value.stale,
    incomplete: results.some(result => result.status === 'rejected' || result.value.incomplete) };
}
