import { placesPanel } from './places-panel.mjs';
import { calendarsPanel } from './calendar-panel.mjs';
import { itineraryPanel } from './itinerary-panel.mjs';

const copy = {
  ru: { eyebrow: 'ТВОЙ ДЕНЬ В ГОРОДЕ', change: 'Сменить город', trip: 'Когда гуляем?',
    map: 'Исследуй город', mapHint: 'Выбирай места и события, добавляй остановки в план.',
    places: 'Места', events: 'События', discover: 'Что посмотреть и чем заняться',
    preview: 'Время и фильтры на карте', start: 'Начать в', zone: 'Часовой пояс',
    date: 'Дата', hint: 'План сохраняется на этом устройстве. Время указано для часового пояса в форме.' },
  en: { eyebrow: 'YOUR DAY IN THE CITY', change: 'Change city', trip: 'When are we exploring?',
    map: 'Explore the city', mapHint: 'Find places and events, then add stops to your day.',
    places: 'Places', events: 'Events', discover: 'Things to see and do',
    preview: 'Map time and filters', start: 'Start at', zone: 'Time zone',
    date: 'Date', hint: 'Your plan is saved on this device. Times use the time zone shown above.' },
};

export function cityWorkspace(city, language, calendarCopy, storage, signal, selection, onChangeCity) {
  const text = copy[language];
  const element = document.createElement('section');
  element.className = 'city-workspace';
  const heading = document.createElement('div');
  heading.className = 'workspace-heading';
  const identity = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = text.eyebrow;
  const title = document.createElement('h1');
  title.textContent = city.name;
  const area = document.createElement('p');
  area.className = 'city-area';
  area.textContent = [city.region, city.country || city.countryCode].filter(Boolean).join(' · ');
  identity.append(eyebrow, title, area);
  const change = document.createElement('button');
  change.type = 'button';
  change.className = 'change-city';
  change.textContent = text.change;
  change.addEventListener('click', onChangeCity);
  heading.append(identity, change);

  const places = placesPanel(city, language, signal, true, selection);
  const itinerary = itineraryPanel(city, language, places, storage, signal, () => {
    selectTab(0);
    discovery.scrollIntoView({ block: 'start', behavior: 'auto' });
    tabButtons[0].focus({ preventScroll: true });
  });
  places.setItinerary(itinerary);
  const events = calendarsPanel(city, true, language, calendarCopy, storage, places.getDay(), signal, places);
  const trip = document.createElement('form');
  trip.className = 'trip-form';
  trip.setAttribute('aria-label', text.trip);
  trip.addEventListener('submit', event => event.preventDefault());
  const dateCaption = itinerary.controls.date.querySelector('span');
  dateCaption.textContent = text.date;
  itinerary.controls.start.firstChild.textContent = text.start;
  const zone = document.createElement('div');
  zone.className = 'trip-zone';
  const zoneTitle = document.createElement('span');
  zoneTitle.textContent = text.zone;
  const zoneValue = document.createElement('strong');
  zoneValue.textContent = city.timezone || 'UTC';
  zone.append(zoneTitle, zoneValue);
  trip.append(itinerary.controls.date, itinerary.controls.start, itinerary.controls.end, zone);

  const grid = document.createElement('div');
  grid.className = 'workspace-grid';
  const explore = document.createElement('div');
  explore.className = 'explore-column';
  const map = document.createElement('section');
  map.className = 'map-surface';
  const mapHeader = document.createElement('div');
  mapHeader.className = 'map-heading';
  const mapTitle = document.createElement('h2');
  mapTitle.textContent = text.map;
  mapHeader.append(mapTitle, itinerary.mapButton);
  const preview = document.createElement('details');
  preview.className = 'map-preview';
  const previewTitle = document.createElement('summary');
  previewTitle.textContent = text.preview;
  preview.append(previewTitle, ...Object.values(places.previewElements));
  map.append(mapHeader, places.mapElements.canvas, places.mapElements.picker, preview, places.mapElements.legend, places.mapElements.credit);

  const discovery = document.createElement('section');
  discovery.className = 'discovery';
  const discoveryTitle = document.createElement('h2');
  discoveryTitle.textContent = text.discover;
  const hint = document.createElement('p');
  hint.className = 'section-hint';
  hint.textContent = text.mapHint;
  const tabs = document.createElement('div');
  tabs.className = 'discovery-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', text.discover);
  const panels = [places.element, events].map(content => {
    const panel = document.createElement('div');
    panel.append(content);
    return panel;
  });
  const tabButtons = [text.places, text.events].map((label, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.id = `city-${city.id}-tab-${index}`;
    tab.textContent = label;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `city-${city.id}-panel-${index}`);
    tab.addEventListener('click', () => selectTab(index));
    tab.addEventListener('keydown', event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % panels.length :
        event.key === 'ArrowLeft' ? (index + panels.length - 1) % panels.length :
        event.key === 'Home' ? 0 : event.key === 'End' ? panels.length - 1 : undefined;
      if (next === undefined) return;
      event.preventDefault();
      selectTab(next);
      tabButtons[next].focus();
    });
    const panel = panels[index];
    panel.id = `city-${city.id}-panel-${index}`;
    panel.classList.add('discovery-panel');
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panel.tabIndex = 0;
    return tab;
  });
  function selectTab(index) {
    for (const [i, tab] of tabButtons.entries()) {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    }
  }
  tabs.append(...tabButtons);
  discovery.append(discoveryTitle, hint, tabs, ...panels);
  selectTab(selection?.tab === 'events' ? 1 : 0);
  explore.append(map, discovery);
  grid.append(explore, itinerary.element);
  const footnote = document.createElement('p');
  footnote.className = 'workspace-note';
  footnote.textContent = text.hint;
  element.append(heading, trip, grid, footnote);
  const startInput = itinerary.controls.start.querySelector('input');
  const syncPreview = () => { if (startInput.value) places.setTime(startInput.value); };
  startInput.addEventListener('change', syncPreview);
  places.onDayChange(syncPreview);
  if (!selection?.time) syncPreview();
  return {
    element,
    selection() { return { ...places.selection(), tab: panels[1].hidden ? 'places' : 'events' }; },
  };
}
