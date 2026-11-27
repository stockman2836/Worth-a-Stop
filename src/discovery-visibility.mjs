export function detailZoom(place) {
  return place.prominence === 'highlight' ? 0 : place.prominence === 'notable' ? 15 : 17;
}

export function initialHighlights(places) {
  const highlights = places.filter(place => place.prominence === 'highlight');
  if (!highlights.length) return [];
  const distances = highlights.map(place => place.km).filter(Number.isFinite).sort((a, b) => a - b);
  const typical = distances[Math.floor((distances.length - 1) * .75)];
  // Frame the city's main visitor area; remote highlights remain available on map/list.
  return highlights.filter(place => !Number.isFinite(place.km) || place.km <= Math.max(1, typical * 2));
}
