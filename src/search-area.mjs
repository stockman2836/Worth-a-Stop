export function validNearbySearchArea(area, city) {
  return area?.kind === 'nearby' && area.radiusKm === 2 &&
    Number.isFinite(area.latitude) && Math.abs(area.latitude) <= 90 &&
    Number.isFinite(area.longitude) && Math.abs(area.longitude) <= 180 &&
    area.latitude === city.latitude && area.longitude === city.longitude;
}

// A missing polygon is not a missing settlement. Verify the geocoder identity
// before offering explicitly labelled surroundings; never borrow a larger district.
export async function settlementSearchArea(city, { fetchResponse = fetch, signal } = {}) {
  let place;
  try {
    const response = await fetchResponse(new URL(`https://geocoding-api.open-meteo.com/v1/get?id=${city.id}&language=en`), {
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(6000)]),
    });
    if (!response.ok) throw Error('Settlement identity HTTP ' + response.status);
    place = await response.json();
  } catch (cause) {
    signal?.throwIfAborted();
    throw Object.assign(Error('Settlement identity unavailable', { cause }), { code: 'PLACE_SOURCE_UNAVAILABLE' });
  }
  if (place?.id !== city.id || !place.feature_code?.startsWith('PPL') ||
      Math.abs(place.latitude - city.latitude) > 0.00001 || Math.abs(place.longitude - city.longitude) > 0.00001 ||
      !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) {
    throw Object.assign(Error('Settlement identity not confirmed'), { code: 'CITY_BOUNDARY_UNAVAILABLE' });
  }
  return { kind: 'nearby', radiusKm: 2, latitude: city.latitude, longitude: city.longitude };
}
