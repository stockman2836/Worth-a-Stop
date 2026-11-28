import test from 'node:test';
import assert from 'node:assert/strict';
import { browserHarness } from '../test-support/browser.mjs';

test('must-visit controls persist, protect proposals and explain infeasible routes in RU and EN',
  { skip: !process.env.CHROME_BIN, timeout: 30000 }, async t => {
    const { evaluate, errors } = await browserHarness(t);
    const result = await evaluate(`(async () => {
      const { itineraryPanel } = await import('/itinerary-panel.mjs');
      const { autoPlanPanel } = await import('/auto-plan-panel.mjs');
      const { resetCityPlans } = await import('/city-plan-state.mjs');
      const city = { id: 85004, name: 'Town', latitude: 47.5, longitude: 19, timezone: 'Europe/Budapest' };
      const day = '2026-11-28';
      const places = Array.from({ length: 20 }, (_, i) => ({ name: 'View ' + i, names: { ru: 'Место ' + i }, category: 'viewpoint',
        latitude: 47.5, longitude: 19 + (i + 1) / 1000, km: .1, hours: '24/7', url: 'https://www.openstreetmap.org/node/' + (i + 1) }));
      let closed = false, delay = false, release, draft;
      window.fetch = async input => {
        const url = String(input);
        if (url.startsWith('/api/places?')) {
          if (delay) await new Promise(resolve => { release = resolve; });
          return Response.json({ places: places.map(place => ({ ...place, hours: closed && place === places[19] ? 'off' : place.hours })),
            boundary: { name: 'Town', url: 'https://www.openstreetmap.org/relation/1' } });
        }
        if (url.startsWith('/api/official-events/')) return Response.json({ events: [], sources: [] });
        if (url.startsWith('/api/walking?')) {
          const p = new URL(url, location.origin).searchParams;
          return Response.json({ status: 'ok', duration: 300, distance: 400, geometry: { type: 'LineString',
            coordinates: [[+p.get('fromLon'), +p.get('fromLat')], [+p.get('toLon'), +p.get('toLat')]] } });
        }
        return Response.json([]);
      };
      const check = (value, message) => { if (!value) throw Error(message); };
      const wait = async predicate => {
        for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
        throw Error('Required planner did not settle');
      };
      const change = (input, value) => { input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); };
      let controller, itinerary, auto, timeline;
      function mount(language = 'en') {
        controller?.abort(); controller = new AbortController(); let activeDay = day; const listeners = [];
        timeline = { getDay: () => activeDay, setDay: value => { activeDay = value; for (const listener of listeners) listener(value); },
          onDayChange: listener => listeners.push(listener), setOrigin() {}, setDestination() {}, cancelStartSelection() {}, clearAlternative() {},
          setRoute() {}, showRoute() {}, clearDraft() { draft = undefined; }, showDraft: (legs, stops) => { draft = { legs, stops }; } };
        itinerary = itineraryPanel(city, language, timeline, localStorage, controller.signal);
        auto = autoPlanPanel(city, language, itinerary, timeline, localStorage, controller.signal);
        document.body.replaceChildren(...Object.values(itinerary.controls), auto.controls, auto.element, itinerary.element);
      }
      const field = kind => itinerary.controls[kind].querySelector('input');
      const ready = () => !auto.element.querySelector('.itinerary-actions').hidden;
      const settled = () => !auto.controls.querySelector('.generate-day').disabled;
      const must = () => [...itinerary.element.querySelectorAll('.itinerary-stops > li')].find(item => item.querySelector('a').href === places[19].url);
      resetCityPlans(city.id, localStorage); mount();
      change(field('start'), '09:00'); change(field('end'), '14:00');
      itinerary.button(places[19], 'place').click();
      change(must().querySelector('input[type=number]'), '35');
      must().querySelector('.required-stop-toggle input').click();
      check(itinerary.context().stops[0].required === true, 'Pin must be stored immediately');
      check(auto.controls.querySelector('.required-stops-note').textContent.includes('Must-visit places: 1'), 'Controls must explain current selection');
      check(!must().querySelector('.alternatives'), 'Pinned place must not offer replacements');
      auto.controls.querySelector('.generate-day').click(); await wait(ready);
      check(auto.element.querySelector('.auto-plan-stops').textContent.includes('View 19'), 'Required place outside the ordinary shortlist must appear');
      check(itinerary.context().stops.length === 1, 'Preview must preserve the manual itinerary');
      [...auto.element.querySelectorAll('button')].find(button => button.textContent === 'Preview on map').click();
      check(draft.stops.some(stop => stop.required && stop.title === 'View 19'), 'Map draft must retain the required visit');
      auto.element.querySelector('.apply-auto-plan').click();
      check(itinerary.context().stops.some(stop => stop.required && stop.duration === 35), 'Applying must preserve pin and duration');
      mount('ru');
      check(must().querySelector('.required-stop-toggle input').checked, 'Language reload must retain pin');
      check(must().textContent.includes('Обязательно посетить'), 'Pin controls must be translated');
      timeline.setDay('2026-11-29'); check(!itinerary.context().stops.length, 'Pins must be scoped to the day');
      timeline.setDay(day); check(must().querySelector('.required-stop-toggle input').checked, 'Returning to day must restore pin');
      closed = true; const snapshot = JSON.stringify(itinerary.context().stops);
      auto.controls.querySelector('.generate-day').click(); await wait(settled);
      check(!ready() && auto.element.textContent.includes('закрыто к прибытию'), 'Closed required place must explain conflict without Apply');
      check(auto.element.textContent.includes('Место 19'), 'Conflict must identify the required place');
      auto.element.querySelector('.apply-auto-plan').click();
      check(JSON.stringify(itinerary.context().stops) === snapshot, 'Conflict cannot apply a partial plan');
      closed = false; delay = true; release = undefined;
      auto.controls.querySelector('.generate-day').click(); await wait(() => Boolean(release));
      must().querySelector('.required-stop-toggle input').click(); release();
      await new Promise(resolve => setTimeout(resolve, 80)); delay = false;
      check(!ready() && settled(), 'Changing pins must reject a late old result');
      must().querySelector('.required-stop-toggle input').click();
      auto.controls.querySelector('.generate-day').click(); await wait(ready);
      must().querySelector('.required-stop-toggle input').click();
      check(!ready(), 'Unpinning must invalidate a completed proposal');
      resetCityPlans(city.id, localStorage); mount();
      check(!itinerary.context().stops.length, 'City reset must clear pins with the itinerary');
      controller.abort(); return { ok: true };
    })()`);
    assert.equal(result.ok, true); assert.deepEqual(errors, []);
  });
