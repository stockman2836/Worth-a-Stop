import { validExtent } from './overpass-coverage.mjs';

// A first batch, never a replacement for the complete mapped city area.
export function initialCityBounds(city, boundary) {
  const box = boundary?.bounds;
  if (!validExtent(box)) return undefined;
  const cosine = Math.cos(city.latitude * Math.PI / 180);
  if (cosine < .05 || Math.max((box.maxlat - box.minlat) * 110.5, (box.maxlon - box.minlon) * 110.5 * cosine) <= 12) return undefined;
  const dy = 3 / 110.5, dx = dy / cosine;
  const result = { minlat: Math.max(box.minlat, city.latitude - dy), maxlat: Math.min(box.maxlat, city.latitude + dy),
    minlon: Math.max(box.minlon, city.longitude - dx), maxlon: Math.min(box.maxlon, city.longitude + dx) };
  return validExtent(result) ? result : undefined;
}
