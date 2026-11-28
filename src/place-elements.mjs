import { overpassQuery } from './overpass.mjs';
import { validExtent } from './overpass-coverage.mjs';
import { tiledBounds } from './city-boundary-parts.mjs';

export const categories = {
  tourism: ['attraction', 'museum', 'viewpoint', 'gallery', 'artwork'],
  historic: ['castle', 'monument', 'ruins', 'archaeological_site', 'city_gate', 'amphitheatre', 'fort', 'palace', 'church', 'temple', 'monastery'],
  building: ['cathedral', 'basilica', 'church', 'temple', 'monastery'], leisure: ['park', 'garden'], amenity: ['marketplace', 'theatre'],
};

// Broader cultural categories need reference evidence, so adding a landmark
// does not also flood discovery with every named mural or small venue.
export const documentedCategories = { tourism: ['artwork'], amenity: ['theatre'] };

function localBounds({ latitude, longitude }) {
  const dy = 2 / 110.5, dx = dy / Math.cos(latitude * Math.PI / 180);
  return Math.abs(latitude) + dy < 90 && Math.abs(longitude) + dx < 180
    ? [latitude - dy, longitude - dx, latitude + dy, longitude + dx].map(n => n.toFixed(5)).join(',')
    : `around:2000,${latitude},${longitude}`;
}

export async function placeElements(city, boundary, { signal, fetchResponse = fetch, queryCache, onElements, queryBounds } = {}) {
  const tiled = Boolean(boundary?.segments);
  const local = localBounds(city).split(',').map(Number);
  const nearbyBox = local.length === 4 && local.every(Number.isFinite)
    ? { minlat: local[0], minlon: local[1], maxlat: local[2], maxlon: local[3] } : undefined;
  const boxes = queryBounds ? [queryBounds] : tiled ? boundary.parts.flatMap(box => tiledBounds([box],
    city.latitude >= box.minlat && city.latitude <= box.maxlat && city.longitude >= box.minlon && city.longitude <= box.maxlon ? .1 : .2)) : [boundary ? boundary.bounds : nearbyBox];
  if (tiled) {
    const distance = box => ((box.minlat + box.maxlat) / 2 - city.latitude) ** 2 +
      (((box.minlon + box.maxlon) / 2 - city.longitude) * Math.cos(city.latitude * Math.PI / 180)) ** 2;
    boxes.sort((a, b) => distance(a) - distance(b));
  }
  const elements = [], controller = new AbortController();
  signal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  async function load(box) {
    const spatialBox = validExtent(box) ? `(${box.minlat},${box.minlon},${box.maxlat},${box.maxlon})` : !boundary ? `(${localBounds(city)})` : '';
    const spatial = !tiled && spatialBox ? `nwr${spatialBox}[name]->.nearby;` : '';
    const filters = Object.entries(categories).flatMap(([tag, values]) => {
      const restricted = documentedCategories[tag] ?? [];
      const regular = values.filter(value => !restricted.includes(value));
      const conditions = [regular.length && `[${tag}~"^(${regular.join('|')})$"]`,
        ...restricted.flatMap(value => ['wikidata', 'wikipedia', 'heritage'].map(proof => `[${tag}=${value}][${proof}]`))].filter(Boolean);
      return conditions.map(condition => {
        if (tiled) return `nwr${condition}[name]${spatialBox};`;
        return spatialBox ? `nwr.nearby${condition};` : `nwr${condition}[name](${boundary ? 'area.city' : localBounds(city)});`;
      });
    });
    const membership = !tiled && boundary && spatialBox ? `->.candidates;nwr.candidates(area.city)${spatialBox}` : '';
    const area = !tiled && boundary ? `rel(${boundary.relation});map_to_area->.city;.city out tags;` : '';
    const query = `${area}${spatial}(${filters.join('')})${membership};out ${tiled ? 'body geom' : 'tags center'};`;
    const key = 'tile-v3/' + boundary?.relation + '/' + query;
    const saved = tiled ? await queryCache?.get(key).catch(() => undefined) : undefined;
    if (saved?.expires > Date.now() && Array.isArray(saved.value)) return saved.value;
    const subdivide = tiled ? Math.max(box.maxlat - box.minlat, box.maxlon - box.minlon) > .025 : Boolean(boundary && spatialBox);
    if (saved?.expires > Date.now() && saved.split && subdivide) {
      throw Object.assign(Error('Place query needs smaller tiles'), { code: 'PLACE_QUERY_TOO_LARGE' });
    }
    let result;
    try {
      result = await overpassQuery(query, {
        signal, fetchResponse, extent: box, queryTimeout: tiled ? 8 : boundary ? 20 : 8, subdivide,
        accept: elements => tiled || !boundary || elements.some(element => element.type === 'area' && element.id === 3600000000 + boundary.relation),
      });
    } catch (error) {
      if (error.code === 'PLACE_QUERY_TOO_LARGE') {
        await queryCache?.set(key, { expires: Date.now() + 3600000, split: true, value: null }).catch(() => {});
      }
      throw error;
    }
    if (tiled) await queryCache?.set(key, { expires: Date.now() + 3600000, value: result }).catch(() => {});
    return result;
  }

  // Workers take the next tile as soon as one finishes. Keep three requests at
  // most and cancel siblings on failure; completed tiles remain reusable.
  let next = 0, failure, published = 0, timer;
  function publish() {
    clearTimeout(timer); timer = undefined;
    if (!onElements || !elements.length) return;
    try { onElements(elements); published = Date.now(); }
    catch (error) { failure ??= error; controller.abort(); }
  }
  async function worker() {
    while (next < boxes.length) {
      signal.throwIfAborted();
      const box = boxes[next++];
      try {
        elements.push(...await load(box));
        if (tiled && elements.length && Date.now() - published >= 1000) {
          publish();
        } else if (tiled && onElements && !timer) timer = setTimeout(publish, 1000 - (Date.now() - published));
      }
      catch (error) {
        if (error.code !== 'PLACE_QUERY_TOO_LARGE' || !tiled) {
          failure ??= error;
          controller.abort();
          throw error;
        }
        const size = Math.max(box.maxlat - box.minlat, box.maxlon - box.minlon) / 2 + 1e-12;
        boxes.push(...tiledBounds([box], size));
      }
    }
  }
  await Promise.allSettled(Array.from({ length: Math.min(3, boxes.length) }, worker));
  clearTimeout(timer);
  if (!failure) signal.throwIfAborted();
  if (failure && (!tiled || !elements.length || failure.code !== 'PLACE_SOURCE_UNAVAILABLE')) throw failure;
  return { elements, incomplete: Boolean(failure) };
}
