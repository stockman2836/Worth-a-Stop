import test from 'node:test';
import assert from 'node:assert/strict';
import { browserHarness } from '../test-support/browser.mjs';

test('a reviewed break is saved in the itinerary, survives RU/EN, and invalidates when its settings change',
  { skip: !process.env.CHROME_BIN, timeout: 30000 }, async t => {
    const { evaluate, errors } = await browserHarness(t);
    const result = await evaluate(`(async()=>{
      const {itineraryPanel}=await import('/itinerary-panel.mjs');const {autoPlanPanel}=await import('/auto-plan-panel.mjs');
      const city={id:82001,name:'Test town',latitude:47.5,longitude:19,timezone:'Europe/Budapest'},day='2026-11-28';
      const places=Array.from({length:8},(_,i)=>({name:'View '+i,names:{},category:'viewpoint',latitude:47.5,longitude:19+(i+1)/1000,
        hours:'24/7',km:.1,url:'https://www.openstreetmap.org/node/'+(i+1)}));
      const nativeFetch=window.fetch;let delay=false,releasePlaces,placeCalls=0,zeroRequests=0;
      window.fetch=async input=>{
        const url=String(input);
        if(url.startsWith('/api/places?')){placeCalls++;if(delay)await new Promise(resolve=>{releasePlaces=resolve;});return Response.json({places,boundary:{name:'Town',url:'https://www.openstreetmap.org/relation/1'}});}
        if(url.startsWith('/api/official-events/'))return Response.json({events:[],sources:[]});
        if(url.startsWith('/api/walking?')){
          const p=new URL(url,location.origin).searchParams;
          if(p.get('fromLat')===p.get('toLat')&&p.get('fromLon')===p.get('toLon'))zeroRequests++;
          return Response.json({status:'ok',duration:600,distance:700,geometry:{type:'LineString',coordinates:[[+p.get('fromLon'),+p.get('fromLat')],[+p.get('toLon'),+p.get('toLat')]]}});
        }
        return Response.json([]);
      };
      const check=(value,message)=>{if(!value)throw Error(message);};
      const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Break plan did not settle');};
      const change=(input,value)=>{input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));};
      let controller,itinerary,auto,timeline,picking,lastRoute,draft;
      function mount(language='en',selectedCity=city,storage=localStorage){
        controller?.abort();controller=new AbortController();let selectedDay=day;const listeners=[];
        timeline={getDay:()=>selectedDay,setDay:value=>{selectedDay=value;for(const listener of listeners)listener(value);},onDayChange:fn=>listeners.push(fn),
          setOrigin(){},setDestination(){},cancelStartSelection(){picking=undefined;},clearAlternative(){},
          pickStart:(pick,cancel)=>{picking={pick,cancel};},setRoute:(legs,stops)=>{lastRoute={legs,stops};},showRoute(){},clearDraft(){draft=undefined;},
          showDraft:(legs,stops)=>{draft={legs,stops};}};
        itinerary=itineraryPanel(selectedCity,language,timeline,storage,controller.signal);
        auto=autoPlanPanel(selectedCity,language,itinerary,timeline,storage,controller.signal);
        const root=document.createElement('section');root.className='city-workspace';const trip=document.createElement('div');trip.className='trip-form';
        trip.append(...Object.values(itinerary.controls),auto.controls);root.append(trip,auto.element,itinerary.element);document.body.replaceChildren(root);
      }
      const pause=selector=>auto.controls.querySelector(selector),ready=()=>!auto.element.querySelector('.itinerary-actions').hidden;
      const input=kind=>itinerary.controls[kind].querySelector('input');
      mount();change(input('start'),'09:00');change(input('end'),'14:00');
      itinerary.controls.returnTrip.querySelector('.enable-return').click();itinerary.controls.returnTrip.querySelector('.pick-return').click();picking.pick({latitude:47.49,longitude:19});
      pause('.enable-pause').click();change(pause('.pause-from'),'10:00');change(pause('.pause-to'),'11:00');change(pause('.pause-duration'),'30');
      pause('.generate-day').click();await wait(ready);
      check(auto.element.querySelectorAll('[data-hours=pause]').length===1,'Exactly one break must be proposed');
      check(auto.element.textContent.includes('Meal break')&&auto.element.textContent.includes('not verified'),'Preview must identify the reserved break and unverified venue');
      check(itinerary.context().stops.length===0,'Preview must leave the manual plan intact');
      [...auto.element.querySelectorAll('button')].find(button=>button.textContent==='Preview on map').click();
      check(draft.stops.some(stop=>stop.type==='pause')&&draft.stops.at(-1).type==='return','Map preview must include the break and return');
      auto.element.querySelector('.apply-auto-plan').click();
      await wait(()=>itinerary.controls.returnTrip.querySelector('.return-trip-status').dataset.state==='fits');
      check(itinerary.context().stops.filter(stop=>stop.type==='pause').length===1,'Applied itinerary must preserve its break');
      check(lastRoute.legs.some(leg=>leg.to.type==='pause'&&leg.duration===0),'A break at the preceding stop must not invent a walk');
      check(zeroRequests===0,'Co-located pause legs must not call the router');
      const first=itinerary.element.querySelector('.itinerary-stops > li input[type=number]');change(first,'180');
      await wait(()=>itinerary.element.querySelector('.stop-timing[data-reason=pause-window]'));
      check(itinerary.controls.returnTrip.querySelector('.return-trip-status').dataset.state==='late','Manual delays must expose a missed return');
      pause('.generate-day').click();await wait(ready);change(pause('.pause-duration'),'35');
      check(!ready(),'Changing break settings must invalidate the reviewed suggestion');
      auto.element.querySelector('.apply-auto-plan').click();check(itinerary.context().stops[0].duration===180,'Stale suggestions must not overwrite manual edits');
      change(pause('.pause-duration'),'0');const requests=placeCalls;pause('.generate-day').click();
      check(placeCalls===requests&&!ready(),'Invalid breaks must fail before source requests');
      change(pause('.pause-duration'),'30');change(pause('.pause-kind'),'rest');pause('.generate-day').click();await wait(ready);
      check(auto.element.textContent.includes('Rest break'),'Rest purpose must appear in the proposal');
      mount('ru');check(pause('.enable-pause').checked&&pause('.pause-kind').value==='rest','RU must restore saved break settings');
      check(itinerary.element.textContent.includes('Обеденная пауза'),'The applied break must survive reload and be localized');
      change(input('date'),'2026-11-29');check(!pause('.enable-pause').checked,'Other dates must not inherit the break');
      change(input('date'),day);check(pause('.enable-pause').checked&&pause('.pause-duration').value==='30','The original day must restore its break');
      delay=true;pause('.generate-day').click();await wait(()=>Boolean(releasePlaces));change(pause('.pause-to'),'11:15');releasePlaces();
      await new Promise(resolve=>setTimeout(resolve,50));delay=false;check(!ready()&&!pause('.generate-day').disabled,'Cancelled work must not restore a stale break proposal');
      mount('en',{...city,id:82002});check(!pause('.enable-pause').checked,'Other cities must not inherit the break');
      const blocked={getItem(){throw Error('Blocked');},setItem(){throw Error('Blocked');}};
      mount('en',{...city,id:82003},blocked);pause('.enable-pause').click();check(auto.controls.textContent.includes('could not be saved'),'Blocked storage must be visible');
      mount('ru',{...city,id:82003},blocked);check(pause('.enable-pause').checked,'Temporary settings must survive language changes');
      controller.abort();window.fetch=nativeFetch;return {ok:true};
    })()`);
    assert.equal(result.ok, true);
    assert.deepEqual(errors, []);
  });
