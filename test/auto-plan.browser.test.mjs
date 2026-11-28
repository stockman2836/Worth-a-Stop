import test from 'node:test';
import assert from 'node:assert/strict';
import { browserHarness } from '../test-support/browser.mjs';

test('interest controls persist across cities and languages, personalize previews and reject stale proposals',
  { skip: !process.env.CHROME_BIN, timeout: 30000 }, async t => {
    const { evaluate, errors } = await browserHarness(t);
    const result = await evaluate(`(async () => {
      const { autoPlanPanel } = await import('/auto-plan-panel.mjs');
      const { interestKey } = await import('/travel-interests.mjs');
      const check = (value, message) => { if (!value) throw Error(message); };
      const wait = async predicate => {
        for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
        throw Error('Planner did not settle');
      };
      localStorage.removeItem(interestKey);
      const city = { id: 1, name: 'Town', latitude: 47.5, longitude: 19, timezone: 'Europe/Budapest' };
      const place = (id, category) => ({ name: category === 'park' ? 'Park' : 'Museum ' + id, names: {}, category,
        url: 'https://www.openstreetmap.org/node/' + id, latitude: 47.5, longitude: 19 + id / 1000, km: .1, hours: '24/7' });
      const places = [...Array.from({ length: 25 }, (_, i) => place(i + 1, 'museum')), place(100, 'park')];
      let delayPlaces = false, releasePlaces;
      window.fetch = async input => {
        const url = String(input);
        if (url.startsWith('/api/places?')) {
          if (delayPlaces) await new Promise(resolve => { releasePlaces = resolve; });
          return Response.json({ places, boundary: { name: 'Town', url: 'https://www.openstreetmap.org/relation/1' } });
        }
        if (url.startsWith('/api/official-events/')) return Response.json({ events: [], sources: [] });
        if (url.startsWith('/api/walking?')) {
          const params = new URL(url, location.origin).searchParams;
          return Response.json({ status: 'ok', duration: 600, distance: 700, geometry: { type: 'LineString',
            coordinates: [[+params.get('fromLon'), +params.get('fromLat')], [+params.get('toLon'), +params.get('toLat')]] } });
        }
        return Response.json([]);
      };
      const state = { day: '2026-11-28', startTime: '09:00', endTime: '10:30', origin: null, stops: [] };
      const listeners = [], applied = [];
      const element = document.createElement('section'); element.innerHTML = '<h2>Plan</h2>';
      const itinerary = { element, context: () => structuredClone(state), onChange: listener => listeners.push(listener),
        applyPlan: stops => { applied.push(stops); state.stops = stops; for (const listener of listeners) listener(); } };
      const timeline = { clearDraft() {}, showDraft() {} };
      let controller, panel;
      function mount(language = 'en', selectedCity = city, storage = localStorage) {
        controller?.abort(); panel?.controls.remove(); panel?.element.remove();
        controller = new AbortController();
        panel = autoPlanPanel(selectedCity, language, itinerary, timeline, storage, controller.signal);
        document.body.replaceChildren(panel.controls, panel.element, element);
      }
      const input = id => panel.controls.querySelector('input[value="' + id + '"]');
      const ready = () => !panel.element.querySelector('.itinerary-actions').hidden;
      mount(); input('nature').click();
      check(JSON.parse(localStorage.getItem(interestKey))[0] === 'nature', 'Interest must persist');
      panel.controls.querySelector('.generate-day').click(); await wait(ready);
      check(panel.element.querySelector('.auto-plan-stops a').textContent === 'Park', 'Preferred park outside initial twelve must be considered');
      check(panel.element.textContent.includes('Matches your interests: Nature'), 'Preview must explain the match');
      check(applied.length === 0, 'Preview must not modify the manual plan');
      input('history').click();
      check(!ready() && !panel.element.querySelector('.auto-plan-stops').children.length, 'Changing interests must invalidate a proposal');
      panel.element.querySelector('.apply-auto-plan').click(); check(applied.length === 0, 'Stale proposal must not apply');
      mount('ru');
      check(input('nature').checked && input('history').checked, 'Language changes must retain choices');
      check(panel.controls.textContent.includes('Природа'), 'Controls must be translated');
      mount('en', { ...city, id: 2 });
      check(input('nature').checked && input('history').checked, 'Personal interests must follow the traveller to another city');
      localStorage.setItem(interestKey, JSON.stringify(['museums']));
      window.dispatchEvent(new StorageEvent('storage', { key: interestKey }));
      check(input('museums').checked && !input('nature').checked, 'Storage changes must update the controls');
      panel.controls.querySelector('.clear-interests').click(); input('nature').click();
      panel.controls.querySelector('.generate-day').click(); await wait(ready);
      panel.element.querySelector('.apply-auto-plan').click();
      check(applied.length === 1 && applied[0][0].title === 'Park', 'Reviewed personalized proposal must apply');
      delayPlaces = true;
      panel.controls.querySelector('.generate-day').click(); await wait(() => Boolean(releasePlaces));
      input('art').click(); releasePlaces();
      await new Promise(resolve => setTimeout(resolve, 30));
      check(!ready() && !panel.controls.querySelector('.generate-day').disabled, 'Cancelled old work must not restore a stale preview');
      const blocked = { getItem() { throw Error('Blocked'); }, setItem() { throw Error('Blocked'); } };
      mount('en', city, blocked); input('art').click();
      check(panel.controls.textContent.includes('could not be saved'), 'Unavailable storage must be explicit');
      mount('ru', city, blocked);
      check(input('art').checked, 'Unsaved choices must survive view recreation');
      controller.abort();
      return { personalized: applied[0][0].title, staleApplied: applied.length > 1 };
    })()`);
    assert.equal(result.personalized, 'Park');
    assert.equal(result.staleApplied, false);
    assert.deepEqual(errors, []);
  });
