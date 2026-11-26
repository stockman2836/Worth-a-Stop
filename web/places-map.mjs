import * as L from './leaflet.mjs';

export function placesMap(container, city, places, labels, onSelect) {
  const map = L.map(container, { scrollWheelZoom: false, zoomControl: false })
    .setView([city.latitude, city.longitude], 14);
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
  const markers = places.map((place, index) => {
    const popup = document.createElement('div');
    const title = document.createElement('a');
    title.href = place.url;
    title.textContent = labels.name(place);
    const hours = document.createElement('p');
    hours.textContent = place.hours ? labels.hours + ' · ' + place.hours : labels.unknown;
    const state = document.createElement('p');
    state.className = 'opening-state';
    popup.append(title, state, hours);
    const icon = L.divIcon({ className: 'place-marker', html: '<span></span>', iconSize: [24, 24], iconAnchor: [12, 12] });
    const marker = L.marker([place.latitude, place.longitude], { icon, title: labels.name(place), alt: labels.name(place) })
      .addTo(map).bindPopup(popup);
    marker.on('popupopen', () => onSelect(index));
    return marker;
  });
  if (markers.length) map.fitBounds(L.latLngBounds(markers.map(marker => marker.getLatLng())), { padding: [32, 32], maxZoom: 16 });
  const resize = new ResizeObserver(() => map.invalidateSize({ pan: false }));
  resize.observe(container);
  const eventLayer = L.layerGroup().addTo(map);
  const eventMarkers = new Map();
  return {
    setStates(states) {
      for (const [i, marker] of markers.entries()) {
        const badge = marker.getPopup().getContent().querySelector('.opening-state');
        badge.textContent = states[i].label;
        badge.dataset.state = states[i].state;
        marker.getElement().dataset.state = states[i].state;
      }
    },
    select(index) { map.setView(markers[index].getLatLng(), Math.max(16, map.getZoom())); markers[index].openPopup(); },
    setEvents(events) {
      eventLayer.clearLayers();
      eventMarkers.clear();
      for (const event of events.filter(event => event.location)) {
        const popup = document.createElement('div');
        const title = document.createElement('a');
        title.href = event.url;
        title.textContent = event.title;
        const info = document.createElement('p');
        info.textContent = [event.mapLabel, event.venue].filter(Boolean).join(' · ');
        popup.append(title, info);
        const icon = L.divIcon({ className: 'event-marker', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 13] });
        const marker = L.marker([event.location.latitude, event.location.longitude], {
          icon, title: event.title + ' · ' + event.mapLabel, alt: event.title,
        }).bindPopup(popup).addTo(eventLayer);
        eventMarkers.set(event, marker);
      }
      const points = [...markers, ...eventMarkers.values()].map(marker => marker.getLatLng());
      if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 16 });
    },
    selectEvent(event) {
      const marker = eventMarkers.get(event);
      if (marker) { map.setView(marker.getLatLng(), 16); marker.openPopup(); }
    },
    destroy() { resize.disconnect(); map.remove(); message.remove(); },
  };
}
