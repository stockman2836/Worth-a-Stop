import { iconLabel } from './icons.mjs';
import { placeGroup, placeSymbols } from './map-symbols.mjs';
import { territoryLabel } from './territory.mjs';
import { referenceLink } from './place-reference-view.mjs';
import { placeName } from './place-name.mjs';

export function placeList(language, text, getItinerary, onShow, initialPage, allPlaces = false) {
  const element = document.createElement('ul'); element.className = 'places';
  const filters = document.createElement('div'); filters.className = 'place-list-filters'; filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', text.placeSelection);
  const filterCaption = document.createElement('span'); filterCaption.textContent = text.placeSelection;
  const highlights = document.createElement('button'), all = document.createElement('button'); highlights.type = all.type = 'button';
  highlights.className = 'choose-highlights'; all.className = 'choose-all-places'; filters.append(filterCaption, highlights, all);
  const empty = document.createElement('p'); empty.className = 'no-highlights'; empty.hidden = true;
  const pagination = document.createElement('nav'); pagination.className = 'place-pagination'; pagination.setAttribute('aria-label', text.pages);
  const previous = document.createElement('button'), next = document.createElement('button');
  previous.type = next.type = 'button';
  iconLabel(previous, 'arrow-left', text.previous); iconLabel(next, 'arrow-right', text.next);
  const range = document.createElement('span'); range.setAttribute('role', 'status'); pagination.append(previous, range, next);
  const km = new Intl.NumberFormat(language, { style: 'unit', unit: 'kilometer', maximumFractionDigits: 1 });
  const metres = new Intl.NumberFormat(language, { style: 'unit', unit: 'meter', maximumFractionDigits: 0 });
  let places = [], states = [], eligible = [], page = 0, selected = -1;
  let showAll = Boolean(allPlaces), onlyAvailable = false;
  let restored = Number.isSafeInteger(initialPage) && initialPage >= 0 ? initialPage : undefined;
  const size = 40;
  function render() {
    element.replaceChildren();
    const start = page * size;
    for (const index of eligible.slice(start, start + size)) {
      const place = places[index], item = document.createElement('li'); item.dataset.placeIndex = index;
      item.classList.toggle('selected', index === selected);
      const show = document.createElement('button'); show.type = 'button'; show.className = 'show-place';
      show.textContent = placeName(place, language); show.setAttribute('aria-pressed', String(index === selected));
      show.addEventListener('click', () => onShow(index));
      const link = document.createElement('a'); link.href = place.url; link.textContent = text.source;
      const info = document.createElement('span'); info.className = 'event-venue';
      info.textContent = [place.km < 1 ? metres.format(place.km * 1000) : km.format(place.km), place.hours && text.hours + ' · ' + place.hours].filter(Boolean).join(' · ');
      const badge = document.createElement('span'); badge.className = 'opening-state';
      badge.textContent = states[index]?.label || ''; badge.dataset.state = states[index]?.state || 'unknown';
      const category = document.createElement('span'); category.className = 'place-category'; category.dataset.group = placeGroup(place.category);
      iconLabel(category, placeSymbols[placeGroup(place.category)].icon, text[place.category] || place.category);
      if (place.prominence === 'highlight') {
        category.title = (place.prominenceReasons || []).map(reason => text.prominenceReasons[reason]).filter(Boolean).join(' · ');
      }
      item.append(category, show, badge, info, link); element.append(item);
      const reference = referenceLink(place, text);
      if (reference) item.append(reference);
      item.append(getItinerary().button(place, 'place'));
      if (place.territory) {
        const territory = document.createElement('a'); territory.className = 'place-territory';
        territory.href = place.territory.url; territory.textContent = territoryLabel(place.territory, language);
        info.after(territory);
      }
    }
    pagination.hidden = !eligible.length;
    previous.hidden = next.hidden = eligible.length <= size;
    previous.disabled = page === 0; next.disabled = start + size >= eligible.length;
    range.textContent = text.pageRange(start + 1, Math.min(start + size, eligible.length), eligible.length);
    const featured = places.filter(place => place.prominence === 'highlight').length;
    highlights.textContent = `${text.highlights} (${featured})`; all.textContent = `${text.allPlaces} (${places.length})`;
    highlights.setAttribute('aria-pressed', String(!showAll)); all.setAttribute('aria-pressed', String(showAll));
    empty.hidden = !places.length || showAll || eligible.length > 0;
    empty.textContent = onlyAvailable ? text.noOpenHighlights : text.noHighlights;
  }
  function applyFilter() {
    eligible = places.flatMap((place, index) => (showAll || place.prominence === 'highlight') && (!onlyAvailable || states[index]?.state === 'open') ? [index] : []);
    page = Math.max(0, Math.min(page, Math.ceil(eligible.length / size) - 1)); render();
  }
  highlights.addEventListener('click', () => { showAll = false; page = 0; applyFilter(); });
  all.addEventListener('click', () => { showAll = true; page = 0; applyFilter(); });
  previous.addEventListener('click', () => { page--; render(); element.scrollIntoView({ block: 'start' }); });
  next.addEventListener('click', () => { page++; render(); element.scrollIntoView({ block: 'start' }); });
  return { element, pagination, filters, empty,
    getPage: () => page,
    showsAll: () => showAll,
    update(items, value, availableOnly) {
      if (items !== places) {
        selected = -1;
        if (items.length && restored !== undefined) { page = restored; restored = undefined; }
      }
      places = items; states = value; onlyAvailable = availableOnly; applyFilter();
    },
    select(index) {
      selected = index;
      if (places[index]?.prominence !== 'highlight' && !showAll) { showAll = true; applyFilter(); }
      const position = eligible.indexOf(index);
      if (position >= 0) page = Math.floor(position / size);
      render();
    },
  };
}
