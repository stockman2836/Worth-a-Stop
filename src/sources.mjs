export const openAgendaDataset = 'https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/evenements-publics-openagenda';
const directory = openAgendaDataset + '/records';
const day = 24 * 60 * 60 * 1000;

export function nearbyVenues({ latitude, longitude }, radiusKm) {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    throw new Error('Invalid city coordinates.');
  }
  return `within_distance(location_coordinates,geom'POINT(${longitude} ${latitude})',${radiusKm}km)`;
}

function readSources(rows) {
  if (!Array.isArray(rows)) throw new Error('Invalid calendar directory response.');
  const sources = new Map();
  for (const row of rows) {
    const { originagenda_uid: agendaId, originagenda_title: agenda, location_uid: venueId, location_name: venue } = row;
    if (!/^\d+$/.test(agendaId) || !/^\d+$/.test(venueId) || typeof venue !== 'string' || typeof agenda !== 'string') {
      throw new Error('Invalid calendar directory entry.');
    }
    const pageUrl = new URL(`https://openagenda.com/agendas/${agendaId}`);
    const calendarUrl = new URL(pageUrl.href + '/events.v2.ics');
    calendarUrl.search = new URLSearchParams({
      'locationUid[0]': venueId, 'relative[0]': 'current', 'relative[1]': 'upcoming',
    });
    pageUrl.searchParams.set('locationUid[0]', venueId);
    if (!sources.has(calendarUrl.href)) {
      sources.set(calendarUrl.href, { agenda, venue, pageUrl: pageUrl.href, calendarUrl: calendarUrl.href });
    }
  }
  return [...sources.values()];
}

export async function findSources(city, { refresh = false, storage, fetchResponse = fetch } = {}) {
  if (!Number.isSafeInteger(city.id)) throw new Error('Invalid city.');
  const innerArea = nearbyVenues(city, 5);

  const key = `worth-a-stop.sources.v1.${city.id}`;
  let cached;
  try {
    const saved = JSON.parse(storage?.getItem(key) ?? 'null');
    if (saved && Number.isFinite(saved.checkedAt) && saved.checkedAt >= 0 && saved.checkedAt <= Date.now()) {
      cached = { checkedAt: saved.checkedAt, sources: readSources(saved.rows), radiusKm: saved.radiusKm ?? 5 };
    }
  } catch { /* Missing, unavailable or outdated storage can be replaced by a live result. */ }
  if (!refresh && cached && (cached.sources.length || cached.radiusKm === 25) &&
      Date.now() - cached.checkedAt < day) return { ...cached, stale: false };

  const group = 'originagenda_uid,originagenda_title,location_uid,location_name';
  const url = new URL(directory);
  url.search = new URLSearchParams({
    select: `${group},count(*) as listings`, group_by: group,
    order_by: 'listings desc,originagenda_uid,location_uid', limit: '25',
  });

  async function nearby(radiusKm, area) {
    url.searchParams.set('where', `${area} AND lastdate_end >= now() AND originagenda_uid IS NOT NULL AND location_uid IS NOT NULL AND originagenda_title IS NOT NULL AND location_name IS NOT NULL`);
    const response = await fetchResponse(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Calendar directory returned HTTP ${response.status}.`);
    const { results } = await response.json();
    return { rows: results, sources: readSources(results), radiusKm };
  }
  try {
    let result = await nearby(5, innerArea);
    if (!result.sources.length) result = await nearby(25, nearbyVenues(city, 25));
    const { rows, sources, radiusKm } = result;
    const checkedAt = Date.now();
    try {
      storage?.setItem(key, JSON.stringify({ rows, checkedAt, radiusKm }));
    } catch { /* A storage failure still leaves usable live results. */ }
    return { sources, checkedAt, radiusKm, stale: false };
  } catch (error) {
    if (cached) return { ...cached, stale: true };
    throw error;
  }
}

export async function featuredCities(fetchResponse = fetch) {
  const url = new URL(directory);
  url.search = new URLSearchParams({
    where: 'lastdate_end >= now() AND location_city IS NOT NULL AND location_countrycode IS NOT NULL AND location_coordinates IS NOT NULL AND originagenda_uid IS NOT NULL AND location_uid IS NOT NULL',
    group_by: 'location_city,location_countrycode',
    select: 'location_city,location_countrycode,count(*) as listings',
    order_by: 'listings desc,location_city', limit: '40',
  });
  const response = await fetchResponse(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`City directory returned HTTP ${response.status}.`);
  const { results } = await response.json();
  const cities = results.filter(row => typeof row.location_city === 'string' && /^[A-Z]{2}$/.test(row.location_countrycode))
    .map(row => ({ name: row.location_city, countryCode: row.location_countrycode }));
  // Give each represented country a turn before filling the remaining slots.
  const first = cities.filter((city, i) => cities.findIndex(other => other.countryCode === city.countryCode) === i);
  return [...first, ...cities.filter(city => !first.includes(city))].slice(0, 4);
}
