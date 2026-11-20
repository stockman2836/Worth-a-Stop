const directory = 'https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/evenements-publics-openagenda/records';
const day = 24 * 60 * 60 * 1000;

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
  const { latitude, longitude } = city;
  if (!Number.isSafeInteger(city.id) || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      !Number.isFinite(longitude) || Math.abs(longitude) > 180) throw new Error('Invalid city.');

  const key = `worth-a-stop.sources.v1.${city.id}`;
  let cached;
  try {
    const saved = JSON.parse(storage?.getItem(key) ?? 'null');
    if (saved && Number.isFinite(saved.checkedAt) && saved.checkedAt >= 0 && saved.checkedAt <= Date.now()) {
      cached = { checkedAt: saved.checkedAt, sources: readSources(saved.rows) };
    }
  } catch { /* Missing, unavailable or outdated storage can be replaced by a live result. */ }
  if (!refresh && cached && Date.now() - cached.checkedAt < day) return { ...cached, stale: false };

  const group = 'originagenda_uid,originagenda_title,location_uid,location_name';
  const url = new URL(directory);
  url.search = new URLSearchParams({
    where: `within_distance(location_coordinates,geom'POINT(${longitude} ${latitude})',5km) AND lastdate_end >= now() AND originagenda_uid IS NOT NULL AND location_uid IS NOT NULL AND originagenda_title IS NOT NULL AND location_name IS NOT NULL`,
    select: `${group},count(*) as listings`, group_by: group,
    order_by: 'listings desc,originagenda_uid,location_uid', limit: '25',
  });

  try {
    const response = await fetchResponse(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Calendar directory returned HTTP ${response.status}.`);
    const { results } = await response.json();
    const sources = readSources(results);
    const checkedAt = Date.now();
    try {
      storage?.setItem(key, JSON.stringify({ rows: results, checkedAt }));
    } catch { /* A storage failure still leaves usable live results. */ }
    return { sources, checkedAt, stale: false };
  } catch (error) {
    if (cached) return { ...cached, stale: true };
    throw error;
  }
}
