import { iconLabel } from './icons.mjs';
import { placeGroup, placeSymbols } from './map-symbols.mjs';

export function placeList(language, text, getItinerary, onShow, initialPage) {
  const element = document.createElement('ul'); element.className = 'places';
  const pagination = document.createElement('nav'); pagination.className = 'place-pagination'; pagination.setAttribute('aria-label', text.pages);
  const previous = document.createElement('button'), next = document.createElement('button');
  previous.type = next.type = 'button';
  iconLabel(previous, 'arrow-left', text.previous); iconLabel(next, 'arrow-right', text.next);
  const range = document.createElement('span'); range.setAttribute('role', 'status'); pagination.append(previous, range, next);
  const km = new Intl.NumberFormat(language, { style: 'unit', unit: 'kilometer', maximumFractionDigits: 1 });
  const metres = new Intl.NumberFormat(language, { style: 'unit', unit: 'meter', maximumFractionDigits: 0 });
  let places = [], states = [], eligible = [], page = 0, selected = -1;
  let restored = Number.isSafeInteger(initialPage) && initialPage >= 0 ? initialPage : undefined;
  const size = 40;
  function render() {
    element.replaceChildren();
    const start = page * size;
    for (const index of eligible.slice(start, start + size)) {
      const place = places[index], item = document.createElement('li'); item.dataset.placeIndex = index;
      item.classList.toggle('selected', index === selected);
      const show = document.createElement('button'); show.type = 'button'; show.className = 'show-place';
      show.textContent = place.names[language] || place.name; show.setAttribute('aria-pressed', String(index === selected));
      show.addEventListener('click', () => onShow(index));
      const link = document.createElement('a'); link.href = place.url; link.textContent = text.source;
      const info = document.createElement('span'); info.className = 'event-venue';
      info.textContent = [place.km < 1 ? metres.format(place.km * 1000) : km.format(place.km), place.hours && text.hours + ' · ' + place.hours].filter(Boolean).join(' · ');
      const badge = document.createElement('span'); badge.className = 'opening-state';
      badge.textContent = states[index]?.label || ''; badge.dataset.state = states[index]?.state || 'unknown';
      const category = document.createElement('span'); category.className = 'place-category'; category.dataset.group = placeGroup(place.category);
      iconLabel(category, placeSymbols[placeGroup(place.category)].icon, text[place.category] || place.category);
      item.append(category, show, badge, info, link, getItinerary().button(place, 'place')); element.append(item);
    }
    pagination.hidden = !eligible.length;
    previous.hidden = next.hidden = eligible.length <= size;
    previous.disabled = page === 0; next.disabled = start + size >= eligible.length;
    range.textContent = text.pageRange(start + 1, Math.min(start + size, eligible.length), eligible.length);
  }
  previous.addEventListener('click', () => { page--; render(); element.scrollIntoView({ block: 'start' }); });
  next.addEventListener('click', () => { page++; render(); element.scrollIntoView({ block: 'start' }); });
  return { element, pagination,
    getPage: () => page,
    update(items, value, onlyAvailable) {
      if (items !== places) {
        selected = -1;
        if (items.length && restored !== undefined) { page = restored; restored = undefined; }
      }
      places = items; states = value;
      eligible = places.flatMap((_place, index) => !onlyAvailable || states[index]?.state === 'open' ? [index] : []);
      page = Math.max(0, Math.min(page, Math.ceil(eligible.length / size) - 1)); render();
    },
    select(index) {
      selected = index;
      const position = eligible.indexOf(index);
      if (position >= 0) page = Math.floor(position / size);
      render();
    },
  };
}
