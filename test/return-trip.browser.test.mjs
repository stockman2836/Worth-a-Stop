import test from 'node:test';
import assert from 'node:assert/strict';
import { browserHarness } from '../test-support/browser.mjs';

test('return settings persist in RU/EN, previews include the final walk, and manual changes expose a late return',
  { skip: !process.env.CHROME_BIN, timeout: 30000 }, async t => {
    const { evaluate, errors } = await browserHarness(t);
    const result = await evaluate(`(async()=>{
      const {itineraryPanel}=await import('/itinerary-panel.mjs');
      const {autoPlanPanel}=await import('/auto-plan-panel.mjs');
      const city={id:80001,name:'Test town',latitude:47.5,longitude:19,timezone:'Europe/Budapest'};
      const day='2026-11-28', origin={latitude:47.49,longitude:19};
      const places=[1,2].map(id=>({name:'View '+id,names:{},category:'viewpoint',latitude:47.5,longitude:19+id/1000,
        km:.1,hours:'24/7',url:'https://www.openstreetmap.org/node/'+id}));
      let delay=false, releasePlaces;
      const nativeFetch=window.fetch;
      window.fetch=async input=>{
        const url=String(input);
        if(url.startsWith('/api/places?')) {if(delay)await new Promise(resolve=>{releasePlaces=resolve;});return Response.json({places,boundary:{name:'Town',url:'https://www.openstreetmap.org/relation/1'}});}
        if(url.startsWith('/api/official-events/'))return Response.json({events:[],sources:[]});
        if(url.startsWith('/api/walking?')){
          const p=new URL(url,location.origin).searchParams;
          return Response.json({status:'ok',duration:600,distance:700,geometry:{type:'LineString',coordinates:[[+p.get('fromLon'),+p.get('fromLat')],[+p.get('toLon'),+p.get('toLat')]]}});
        }
        return Response.json([]);
      };
      const check=(value,message)=>{if(!value)throw Error(message);};
      const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Return plan did not settle');};
      const change=(input,value)=>{input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));};
      let controller,itinerary,auto,timeline,picking,lastRoute,draft;
      function mount(language='en',selectedCity=city){
        controller?.abort();controller=new AbortController();let selectedDay=day;const listeners=[];
        timeline={getDay:()=>selectedDay,setDay:value=>{selectedDay=value;for(const listener of listeners)listener(value);},onDayChange:fn=>listeners.push(fn),
          setOrigin(){},setDestination(){},cancelStartSelection(){picking=undefined;},clearAlternative(){},
          pickStart:(pick,cancel,purpose)=>{picking={pick,cancel,purpose};},setRoute:(legs,stops)=>{lastRoute={legs,stops};},
          showRoute(){},clearDraft(){draft=undefined;},showDraft:(legs,stops)=>{draft={legs,stops};}};
        itinerary=itineraryPanel(selectedCity,language,timeline,localStorage,controller.signal);
        auto=autoPlanPanel(selectedCity,language,itinerary,timeline,localStorage,controller.signal);
        const root=document.createElement('section');root.className='city-workspace';
        const trip=document.createElement('div');trip.className='trip-form';trip.append(...Object.values(itinerary.controls),auto.controls);
        root.append(trip,auto.element,itinerary.element);document.body.replaceChildren(root);
      }
      mount();
      const input=kind=>itinerary.controls[kind].querySelector('input');
      const returns=()=>itinerary.controls.returnTrip;
      change(input('start'),'09:00');change(input('end'),'10:00');
      returns().querySelector('.enable-return').click();
      returns().querySelector('.pick-return').click();picking.pick(origin);
      check(itinerary.context().returnTrip.point.latitude===origin.latitude,'Return to start must resolve the saved origin');
      auto.controls.querySelector('.generate-day').click();
      const ready=()=>!auto.element.querySelector('.itinerary-actions').hidden;
      await wait(ready);
      check(auto.element.querySelectorAll('.auto-plan-stops li').length===2,'Preview needs one visit and its return');
      check(!itinerary.element.querySelectorAll('.itinerary-stops li').length,'Preview must not replace the manual itinerary');
      [...auto.element.querySelectorAll('button')].find(button=>button.textContent==='Preview on map').click();
      check(draft.stops.at(-1).type==='return'&&draft.legs.at(-1).to.type==='return','Map preview must include the return leg and flag');
      auto.element.querySelector('.apply-auto-plan').click();
      await wait(()=>returns().querySelector('.return-trip-status').dataset.state==='fits');
      check(lastRoute.stops.at(-1).type==='return'&&lastRoute.legs.length===2,'Applied walking schedule must include the return');
      check(itinerary.element.querySelectorAll('.itinerary-stops > li').length===1,'Return point must not become an editable visit');
      change(itinerary.element.querySelector('.itinerary-stops input[type=number]'),'40');
      await wait(()=>returns().querySelector('.return-trip-status').dataset.state==='late');
      check(itinerary.element.querySelector('.trip-window-status').dataset.state==='overrun','Manual edits must expose a missed departure buffer');
      auto.controls.querySelector('.generate-day').click();await wait(ready);
      change(returns().querySelector('.return-buffer'),'20');
      check(!ready(),'Changing the buffer must invalidate a reviewed proposal');
      auto.element.querySelector('.apply-auto-plan').click();
      check(itinerary.context().stops[0].duration===40,'Stale proposal must not apply');
      change(returns().querySelector('.return-mode'),'point');
      returns().querySelector('.pick-return').click();check(picking.purpose==='return','Map picker must explain return-point selection');
      const destination={latitude:47.48,longitude:19.005};picking.pick(destination);
      check(itinerary.context().returnTrip.point.longitude===destination.longitude,'Separate destination must be retained');
      await wait(()=>returns().querySelector('.return-trip-status').dataset.state==='late');
      returns().querySelector('.pick-return').click();picking.cancel();
      check(returns().querySelector('.return-trip-status').dataset.state==='late','Cancelling point selection must retain the known return timing');
      delay=true;auto.controls.querySelector('.generate-day').click();await wait(()=>Boolean(releasePlaces));
      change(returns().querySelector('.return-buffer'),'15');releasePlaces();
      await new Promise(resolve=>setTimeout(resolve,50));delay=false;
      check(!ready()&&!auto.controls.querySelector('.generate-day').disabled,'Old async work must not restore a stale return proposal');
      mount('ru');
      check(returns().querySelector('.enable-return').checked&&returns().querySelector('.return-buffer').value==='15','Language changes must restore return settings');
      check(returns().textContent.includes('Запас до отправления'),'Return controls must be translated');
      check(itinerary.context().returnTrip.point.longitude===destination.longitude,'Language changes must preserve the destination');
      change(input('date'),'2026-11-29');check(itinerary.context().returnTrip===null,'Another day must not inherit the return settings');
      change(input('date'),day);check(itinerary.context().returnTrip.point.longitude===destination.longitude,'Returning to the day must restore its settings');
      mount('en',{...city,id:80002});check(!returns().querySelector('.enable-return').checked,'Another city must start without a return constraint');
      controller.abort();window.fetch=nativeFetch;
      return {ok:true};
    })()`);
    assert.equal(result.ok, true);
    assert.deepEqual(errors, []);
  });
