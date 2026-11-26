export function eventLocation(latitude, longitude) {
  if (latitude === null || latitude === undefined || latitude === '' ||
      longitude === null || longitude === undefined || longitude === '') return undefined;
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180) {
    return { latitude: lat, longitude: lon };
  }
}
