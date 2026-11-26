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
    popup.append(title, hours);
    const icon = L.divIcon({ className: 'place-marker', html: '<span></span>', iconSize: [24, 24], iconAnchor: [12, 12] });
    const marker = L.marker([place.latitude, place.longitude], { icon, title: labels.name(place), alt: labels.name(place) })
      .addTo(map).bindPopup(popup);
    marker.on('popupopen', () => onSelect(index));
    return marker;
  });
  if (markers.length) map.fitBounds(L.latLngBounds(markers.map(marker => marker.getLatLng())), { padding: [32, 32], maxZoom: 16 });
  const resize = new ResizeObserver(() => map.invalidateSize({ pan: false }));
  resize.observe(container);
  return {
    select(index) { map.setView(markers[index].getLatLng(), Math.max(16, map.getZoom())); markers[index].openPopup(); },
    destroy() { resize.disconnect(); map.remove(); message.remove(); },
  };
}
