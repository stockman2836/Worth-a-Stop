import * as L from './leaflet.mjs';
import { markerFace, placeGroup, placeSymbols } from './map-symbols.mjs';
import { discoveryIndex } from './discovery-index.mjs';
import { detailZoom, initialHighlights } from './discovery-visibility.mjs';

export function placesMap(container, city, places, labels, onSelect, view) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const restored = view && Number.isFinite(view.latitude) && Math.abs(view.latitude) <= 90 &&
    Number.isFinite(view.longitude) && Math.abs(view.longitude) <= 180 && Number.isFinite(view.zoom) && view.zoom >= 0 && view.zoom <= 19 ? view : undefined;
  // Leaflet 1.9 can complete a zoom after a replaced map has already been removed.
  const map = L.map(container, { scrollWheelZoom: true, zoomControl: false, zoomAnimation: false,
    fadeAnimation: !motion.matches, markerZoomAnimation: !motion.matches })
    .setView([restored?.latitude ?? city.latitude, restored?.longitude ?? city.longitude], restored?.zoom ?? 14);
  L.control.zoom({ zoomInTitle: labels.zoomIn, zoomOutTitle: labels.zoomOut }).addTo(map);
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  const message = document.createElement('p');
  message.className = 'map-status';
  message.setAttribute('role', 'status');
  container.after(message);
  let tileFailed = false;
  tiles.on('loading', () => { tileFailed = false; });
  tiles.on('tileerror', () => { tileFailed = true; message.textContent = labels.tilesError; });
  tiles.on('load', () => { if (!tileFailed) message.textContent = ''; });
  const discoveryLayer = L.layerGroup().addTo(map);
  const focusLayer = L.layerGroup().addTo(map);
  let placeItems = places.map((place, index) => ({ ...place, kind: 'place', key: 'p:' + index, index }));
  let events = [], eventItems = [], states = [], eventStates = new Map(), onlyAvailable = false;
  let index = discoveryIndex([]), focused, focusMarker, clearingFocus = false, clusterPopup;
  let pending = false, destroyed = false, fitted = Boolean(restored);
  let showEvents = false;
  let indexTier = -1;
  const stateFor = item => item.kind === 'place' ? states[item.index] : eventStates.get(events[item.index]);
  const nameFor = item => item.kind === 'place' ? labels.name(item) : item.title;
  const visibleItem = item => !onlyAvailable || (item.kind === 'place' ? stateFor(item)?.state === 'open' : stateFor(item)?.available);
  function popupContent(item) {
    const popup = document.createElement('div');
    const title = document.createElement('a');
    title.href = item.url; title.textContent = nameFor(item);
    const hours = document.createElement('p');
    hours.textContent = item.kind === 'place' ? item.hours ? labels.hours + ' · ' + item.hours : labels.unknown :
      [item.mapLabel, item.venue].filter(Boolean).join(' · ');
    const state = document.createElement('p');
    state.className = item.kind === 'place' ? 'opening-state' : 'event-state';
    state.textContent = stateFor(item)?.label || '';
    state.dataset.state = stateFor(item)?.state || 'unknown';
    popup.append(title, state, hours);
    if (item.territory && labels.territory) {
      const paragraph = document.createElement('p'), territory = document.createElement('a');
      territory.href = item.territory.url; territory.textContent = labels.territory(item.territory);
      paragraph.append(territory); popup.append(paragraph);
    }
    return popup;
  }
  function decorate(marker, item) {
    const element = marker.getElement();
    if (!element) return;
    const group = item.kind === 'place' ? placeGroup(item.category) : 'event';
    element.dataset.group = group; element.dataset.state = stateFor(item)?.state || 'unknown';
    element.dataset.prominence = item.prominence || '';
    const category = item.kind === 'place' ? labels[item.category] || labels[placeSymbols[group].label] : labels.legendEvents;
    element.title = [nameFor(item), category, item.territory && labels.territory?.(item.territory), item.mapLabel, stateFor(item)?.label].filter(Boolean).join(' · ');
    element.setAttribute('aria-label', element.title);
  }
  function markerFor(item, focus = false) {
    const place = item.kind === 'place';
    const symbol = place ? placeSymbols[placeGroup(item.category)].icon : 'calendar-days';
    const highlight = place && item.prominence === 'highlight';
    const size = focus || !place ? 30 : highlight ? 28 : item.prominence === 'local' ? 20 : 24;
    const className = (place ? 'place-marker' + (highlight ? ' highlight-marker' : '') : 'event-marker') + (focus ? ' focused-marker' : '');
    const icon = L.divIcon({ className, html: markerFace(symbol), iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    const marker = L.marker([item.latitude, item.longitude], { icon, title: nameFor(item), riseOnHover: true, zIndexOffset: focus ? 2000 : highlight ? 800 : 0 });
    marker.on('add', () => decorate(marker, item));
    if (focus) {
      marker.bindPopup(popupContent(item));
      if (place) marker.on('popupopen', () => onSelect(item.index));
    } else marker.on('click', () => selectItem(item));
    return marker;
  }
  function clearFocus(refresh = true) {
    clearingFocus = true; focused = focusMarker = undefined; focusLayer.clearLayers(); clearingFocus = false;
    if (refresh) rebuild();
  }
  function selectItem(item) {
    if (!item || !visibleItem(item)) return;
    clearFocus(false); focused = item; rebuild();
    map.setView([item.latitude, item.longitude], Math.max(17, map.getZoom()), { animate: !motion.matches });
    focusMarker = markerFor(item, true).addTo(focusLayer);
    focusMarker.on('popupclose', () => { if (!clearingFocus) clearFocus(); });
    focusMarker.openPopup();
  }
  function clusterContents(feature) {
    const snapshot = index, count = feature.properties.point_count;
    const content = document.createElement('div'); content.className = 'cluster-contents';
    const title = document.createElement('strong'); title.textContent = labels.clusterCount(feature.properties.places, feature.properties.events);
    const list = document.createElement('ul'); const more = document.createElement('button'); more.type = 'button'; more.textContent = labels.clusterMore;
    let offset = 0;
    function append() {
      for (const item of snapshot.members(feature.properties.cluster_id, offset)) {
        const row = document.createElement('li'), choose = document.createElement('button'); choose.type = 'button';
        choose.textContent = [nameFor(item), item.mapLabel, item.venue].filter(Boolean).join(' · ');
        choose.addEventListener('click', () => selectItem(item)); row.append(choose); list.append(row); offset++;
      }
      more.hidden = offset >= count;
    }
    more.addEventListener('click', append); content.append(title, list, more); append(); return content;
  }
  function renderDiscovery() {
    if (destroyed) return;
    discoveryLayer.clearLayers();
    const bounds = map.getBounds();
    const labelsUsed = [];
    for (const item of placeItems.filter(item => item.prominence === 'highlight' && visibleItem(item) && item.key !== focused?.key && bounds.contains([item.latitude, item.longitude]))) {
      const marker = markerFor(item).addTo(discoveryLayer);
      const point = map.latLngToContainerPoint([item.latitude, item.longitude]);
      const width = Math.min(160, nameFor(item).length * 6.5 + 16);
      const box = { left: point.x - width / 2, right: point.x + width / 2, top: point.y - 39, bottom: point.y - 17 };
      if (!labelsUsed.some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)) {
        labelsUsed.push(box);
        marker.bindTooltip(nameFor(item), { permanent: true, direction: 'top', offset: [0, -13], className: 'landmark-label', interactive: true });
        marker.getTooltip().on('click', () => selectItem(item));
      }
    }
    for (const feature of index.visible([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], Math.floor(map.getZoom()))) {
      if (!feature.properties.cluster) { markerFor(index.item(feature)).addTo(discoveryLayer); continue; }
      const properties = feature.properties, point = [feature.geometry.coordinates[1], feature.geometry.coordinates[0]];
      const face = document.createElement('span'); face.className = 'cluster-face';
      const count = document.createElement('strong'); count.textContent = String(properties.point_count_abbreviated ?? properties.point_count);
      const kinds = document.createElement('small'); kinds.textContent = labels.clusterKinds(properties.places, properties.events);
      face.append(count, kinds);
      const icon = L.divIcon({ className: 'map-cluster', html: face, iconSize: [48, 48], iconAnchor: [24, 24] });
      const marker = L.marker(point, { icon, title: labels.clusterCount(properties.places, properties.events), riseOnHover: true });
      marker.on('add', () => {
        const element = marker.getElement(); element.setAttribute('aria-label', marker.options.title);
        element.dataset.kind = !properties.places ? 'events' : !properties.events ? 'places' : 'mixed';
      });
      marker.on('click', () => {
        const zoom = Math.min(19, index.expansionZoom(properties.cluster_id));
        if (zoom > map.getZoom()) map.setView(point, zoom, { animate: !motion.matches });
        else {
          clusterPopup = L.popup().setLatLng(point).setContent(clusterContents(feature)).openOn(map);
          clusterPopup.getElement().querySelector('button')?.focus({ preventScroll: true });
        }
      });
      marker.addTo(discoveryLayer);
    }
  }
  function rebuild() {
    if (destroyed) return;
    clusterPopup?.remove(); clusterPopup = undefined;
    if (focused && !visibleItem(focused)) clearFocus(false);
    indexTier = map.getZoom() >= 17 ? 2 : map.getZoom() >= 15 ? 1 : 0;
    const items = [...placeItems.filter(item => item.prominence !== 'highlight' && map.getZoom() >= detailZoom(item)),
      ...(showEvents ? eventItems : [])].filter(item => visibleItem(item) && item.key !== focused?.key);
    index = discoveryIndex(items); renderDiscovery();
    if (focusMarker) { focusMarker.setPopupContent(popupContent(focused)); decorate(focusMarker, focused); }
  }
  function refresh() {
    if (pending) return;
    pending = true; queueMicrotask(() => { pending = false; rebuild(); });
  }
  function fitInitial(items) {
    if (fitted || !items.length) return;
    fitted = true;
    map.fitBounds(L.latLngBounds(items.map(item => [item.latitude, item.longitude])), { padding: [32, 32], maxZoom: 16, animate: !motion.matches });
  }
  function moved() {
    const tier = map.getZoom() >= 17 ? 2 : map.getZoom() >= 15 ? 1 : 0;
    if (tier !== indexTier) rebuild(); else renderDiscovery();
  }
  map.on('moveend', moved);
  fitInitial(initialHighlights(placeItems)); refresh();
  const resize = new ResizeObserver(() => { if (!destroyed) map.invalidateSize({ pan: false }); });
  resize.observe(container);
  const routeLayer = L.layerGroup().addTo(map);
  const previewLayer = L.layerGroup().addTo(map);
  const originLayer = L.layerGroup().addTo(map);
  let picker;
  function selectStart(latlng) {
    if (!picker) return;
    const action = picker;
    picker = undefined;
    container.classList.remove('picking-start');
    const point = latlng.wrap();
    action.pick({ latitude: point.lat, longitude: point.lng });
  }
  map.on('click', event => selectStart(event.latlng));
  function keydown(event) {
    if (!picker) return;
    if (event.key === 'Enter') { event.preventDefault(); selectStart(map.getCenter()); }
    if (event.key === 'Escape') {
      const action = picker;
      picker = undefined;
      container.classList.remove('picking-start');
      action.cancel();
    }
  }
  container.addEventListener('keydown', keydown);
  return {
    view() { const centre = map.getCenter().wrap(); return { latitude: centre.lat, longitude: centre.lng, zoom: map.getZoom() }; },
    setPlaces(value, refit = false) {
      clearFocus(false);
      placeItems = value.map((place, index) => ({ ...place, kind: 'place', key: 'p:' + index, index }));
      if (refit) fitted = false;
      fitInitial(initialHighlights(placeItems));
      refresh();
    },
    setEventsVisible(value) {
      showEvents = Boolean(value);
      if (!showEvents && focused?.kind === 'event') clearFocus(false);
      refresh();
    },
    pickStart(pick, cancel) { picker = { pick, cancel }; container.classList.add('picking-start'); container.focus(); },
    cancelStart() { picker = undefined; container.classList.remove('picking-start'); },
    setOrigin(point, title) {
      originLayer.clearLayers();
      if (!point) return;
      const content = document.createElement('span');
      content.textContent = title;
      const icon = L.divIcon({ className: 'origin-marker', html: markerFace('flag'), iconSize: [34, 34], iconAnchor: [17, 17] });
      L.marker([point.latitude, point.longitude], { icon, title, alt: title, zIndexOffset: 2500 }).bindPopup(content).addTo(originLayer);
    },
    clearPreview() { previewLayer.clearLayers(); },
    previewPlan(legs, stops) {
      previewLayer.clearLayers();
      const points = [];
      for (const leg of legs) {
        const line = leg.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
        points.push(...line);
        L.polyline(line, { className: 'draft-route', color: '#c47a43', weight: 5, dashArray: '7 9' }).addTo(previewLayer);
      }
      let number = 0;
      for (const stop of stops) {
        if (!stop.location) continue;
        points.push([stop.location.latitude, stop.location.longitude]);
        const content = document.createElement('a');
        content.href = stop.url;
        content.textContent = stop.title;
        const origin = stop.type === 'origin';
        const label = origin ? markerFace('flag') : String(++number);
        const icon = L.divIcon({ className: origin ? 'origin-marker draft-stop' : 'route-stop draft-stop', html: label,
          iconSize: origin ? [34, 34] : [28, 28], iconAnchor: origin ? [17, 17] : [14, 14] });
        L.marker([stop.location.latitude, stop.location.longitude], { icon, title: stop.title, alt: stop.title, zIndexOffset: 1800 }).bindPopup(content).addTo(previewLayer);
      }
      if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 16, animate: !motion.matches });
    },
    previewPlace(stop) {
      previewLayer.clearLayers();
      const content = document.createElement('div');
      const link = document.createElement('a');
      link.href = stop.url;
      link.textContent = stop.title;
      const hours = document.createElement('p');
      hours.textContent = stop.hours;
      content.append(link, hours);
      const icon = L.divIcon({ className: 'place-marker alternative-marker', html: markerFace('map-pin'), iconSize: [34, 34], iconAnchor: [17, 17] });
      const marker = L.marker([stop.location.latitude, stop.location.longitude], { icon, title: stop.title, alt: stop.title })
        .bindPopup(content).addTo(previewLayer);
      map.setView(marker.getLatLng(), 16, { animate: !motion.matches });
      marker.openPopup();
    },
    setRoute(legs, stops, fit = false) {
      routeLayer.clearLayers();
      for (const leg of legs.filter(leg => leg.status === 'ok')) {
        L.polyline(leg.geometry.coordinates.map(([lon, lat]) => [lat, lon]), {
          color: '#16485c', weight: 5, opacity: .8, className: 'walking-route',
        }).addTo(routeLayer);
      }
      for (const [index, stop] of stops.entries()) {
        if (!stop.location || stop.type === 'origin') continue;
        const popup = document.createElement('a');
        popup.href = stop.url;
        popup.textContent = stop.title;
        const offset = stops[0]?.type === 'origin' ? 1 : 0;
        const icon = L.divIcon({ className: 'route-stop', html: String(index + 1 - offset), iconSize: [28, 28], iconAnchor: [14, 14] });
        L.marker([stop.location.latitude, stop.location.longitude], { icon, title: stop.title, alt: stop.title, zIndexOffset: 1500 })
          .bindPopup(popup).addTo(routeLayer);
      }
      const points = legs.filter(leg => leg.status === 'ok').flatMap(leg => leg.geometry.coordinates.map(([lon, lat]) => [lat, lon]));
      points.push(...stops.filter(stop => stop.location).map(stop => [stop.location.latitude, stop.location.longitude]));
      if (fit && points.length) map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 16, animate: !motion.matches });
    },
    setStates(value, availableOnly) {
      states = value; onlyAvailable = availableOnly; refresh();
    },
    select(index) { selectItem(placeItems[index]); },
    setEvents(value) {
      if (focused?.kind === 'event') clearFocus(false);
      events = value;
      eventItems = events.flatMap((event, index) => event.location ? [{ ...event, kind: 'event', key: 'e:' + index, index, ...event.location }] : []);
      refresh();
    },
    setEventStates(value, availableOnly) {
      eventStates = value; onlyAvailable = availableOnly; refresh();
    },
    selectEvent(event) {
      selectItem(eventItems.find(item => events[item.index] === event));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; resize.disconnect();
      map.off('moveend', moved); container.removeEventListener('keydown', keydown);
      // Leaflet 1.9 removes the wheel listener but leaves its debounced zoom
      // scheduled. Cancel it before remove() deletes the map pane.
      map.scrollWheelZoom.disable(); clearTimeout(map.scrollWheelZoom._timer);
      map.stop(); map.remove(); message.remove();
    },
  };
}
