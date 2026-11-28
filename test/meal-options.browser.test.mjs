import test from 'node:test';
import assert from 'node:assert/strict';
import { browserHarness } from '../test-support/browser.mjs';

test('meal venue choices update only the reviewed proposal, persist after applying and reject stale background results',
  { skip: !process.env.CHROME_BIN, timeout: 30000 }, async t => {
    const { evaluate, errors } = await browserHarness(t);
    const result = await evaluate(`(async()=>{
      const {itineraryPanel}=await import('/itinerary-panel.mjs');const {autoPlanPanel}=await import('/auto-plan-panel.mjs');
      const city={id:84001,name:'Test town',latitude:47.5,longitude:19,timezone:'Europe/Budapest'},day='2026-11-28';
      const places=Array.from({length:8},(_,i)=>({name:'View '+i,names:{},category:'viewpoint',latitude:47.5,longitude:19+(i+1)/1000,
        hours:'24/7',km:.1,url:'https://www.openstreetmap.org/node/'+(i+1)}));
      const venues=[{name:'Open Cafe',names:{en:'Open Cafe',ru:'Открытое кафе'},latitude:47.5001,longitude:19.0031,category:'cafe',hours:'09:00-11:30',url:'https://www.openstreetmap.org/node/1001'},
        {name:'Unknown Cafe',names:{en:'Unknown Cafe',ru:'Неизвестные часы'},latitude:47.5002,longitude:19.0032,category:'cafe',hours:null,url:'https://www.openstreetmap.org/node/1002'},
        {name:'Closed',names:{},latitude:47.5003,longitude:19.0033,category:'cafe',hours:'off',url:'https://www.openstreetmap.org/node/1003'}];
      const nativeFetch=window.fetch;let fail=false,delay=true,releaseMeals,mealCalls=0;
      window.fetch=async input=>{
        const url=String(input);
        if(url.startsWith('/api/places?'))return Response.json({places,boundary:{name:'Town',url:'https://www.openstreetmap.org/relation/1'}});
        if(url.startsWith('/api/official-events/'))return Response.json({events:[],sources:[]});
        if(url.startsWith('/api/meal-venues?')){mealCalls++;if(delay)await new Promise(resolve=>{releaseMeals=resolve;});return Response.json(fail?{status:'unavailable',venues:[],retryAt:Date.now()+60000}:{venues,checkedAt:Date.now()});}
        if(url.startsWith('/api/walking?')){const p=new URL(url,location.origin).searchParams;return Response.json({status:'ok',duration:300,distance:400,geometry:{type:'LineString',coordinates:[[+p.get('fromLon'),+p.get('fromLat')],[+p.get('toLon'),+p.get('toLat')]]}});}
        return Response.json([]);
      };
      const check=(value,message)=>{if(!value)throw Error(message);};
      const wait=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Meal options did not settle');};
      const change=(input,value)=>{input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));};
      let controller,itinerary,auto,timeline,picking,draft;
      function mount(language='en'){
        controller?.abort();controller=new AbortController();let selectedDay=day;const listeners=[];
        timeline={getDay:()=>selectedDay,setDay:value=>{selectedDay=value;for(const listener of listeners)listener(value);},onDayChange:fn=>listeners.push(fn),
          setOrigin(){},setDestination(){},cancelStartSelection(){picking=undefined;},clearAlternative(){},pickStart:(pick,cancel)=>{picking={pick,cancel};},
          setRoute(){},showRoute(){},clearDraft(){draft=undefined;},showDraft:(legs,stops)=>{draft={legs,stops};}};
        itinerary=itineraryPanel(city,language,timeline,localStorage,controller.signal);
        auto=autoPlanPanel(city,language,itinerary,timeline,localStorage,controller.signal);
        const root=document.createElement('section');root.className='city-workspace';const trip=document.createElement('div');trip.className='trip-form';
        trip.append(...Object.values(itinerary.controls),auto.controls);root.append(trip,auto.element,itinerary.element);document.body.replaceChildren(root);
      }
      const field=kind=>itinerary.controls[kind].querySelector('input'),setting=selector=>auto.controls.querySelector(selector);
      const ready=()=>!auto.element.querySelector('.itinerary-actions').hidden,choices=()=>[...auto.element.querySelectorAll('.choose-meal-venue')];
      mount();change(field('start'),'09:00');change(field('end'),'14:00');
      itinerary.controls.returnTrip.querySelector('.enable-return').click();itinerary.controls.returnTrip.querySelector('.pick-return').click();picking.pick({latitude:47.49,longitude:19});
      setting('.enable-pause').click();change(setting('.pause-from'),'10:00');change(setting('.pause-to'),'11:00');change(setting('.pause-duration'),'30');
      setting('.generate-day').click();await wait(()=>ready()&&Boolean(releaseMeals));
      check(itinerary.context().stops.length===0,'Ordinary preview must be available before the optional venue source finishes');
      delay=false;releaseMeals();await wait(()=>choices().length===2);
      check(choices()[0].textContent==='Open Cafe','Published-open option must rank first');
      check(auto.element.querySelector('[data-hours=unknown]'),'Unknown opening hours must remain explicit');
      check(!choices().some(button=>button.textContent==='Closed'),'Closed venue must not be selectable');
      choices()[0].click();check(itinerary.context().stops.length===0,'Selecting a venue must not apply the itinerary');
      check(auto.element.querySelector('.auto-plan-stops').textContent.includes('Open Cafe'),'Selected venue must replace the proposed break');
      [...auto.element.querySelectorAll('button')].find(button=>button.textContent==='Preview on map').click();
      check(draft.stops.find(stop=>stop.type==='pause').mealVenue.url===venues[0].url,'Map preview must use the selected venue coordinates');
      auto.element.querySelector('.keep-meal-break').click();check(auto.element.querySelector('.auto-plan-stops').textContent.includes('Meal break'),'Ordinary break must remain available');
      choices()[1].click();check(auto.element.querySelector('.auto-plan-stops').textContent.includes('Unknown Cafe'),'Unknown-hour option may be explicitly chosen');
      choices()[0].click();auto.element.querySelector('.apply-auto-plan').click();
      check(itinerary.context().stops.find(stop=>stop.type==='pause').mealVenue.url===venues[0].url,'Applying must save the selected venue');
      mount('ru');check(itinerary.element.textContent.includes('Открытое кафе'),'Reloaded venue must use the requested published name');
      const pauseItem=[...itinerary.element.querySelectorAll('.itinerary-stops > li')].find(item=>item.querySelector('.pause-description'));
      change(pauseItem.querySelector('input[type=number]'),'120');
      await wait(()=>pauseItem.querySelector('.visit-hours[data-state=closes-during]')||itinerary.element.querySelector('.visit-hours[data-state=closes-during]'));
      fail=true;setting('.generate-day').click();await wait(()=>ready()&&auto.element.querySelector('.meal-options').textContent.includes('временно недоступны'));
      check(itinerary.context().stops.find(stop=>stop.type==='pause').duration===120,'A failed source must not overwrite the current plan');
      fail=false;delay=true;releaseMeals=undefined;setting('.generate-day').click();await wait(()=>Boolean(releaseMeals));
      change(setting('.pause-duration'),'35');releaseMeals();await new Promise(resolve=>setTimeout(resolve,50));delay=false;
      check(!ready()&&auto.element.querySelector('.meal-options').hidden,'Late optional results must not restore an invalidated proposal');
      const count=mealCalls;change(setting('.pause-kind'),'rest');setting('.generate-day').click();await wait(ready);
      check(mealCalls===count&&auto.element.querySelector('.meal-options').hidden,'Rest breaks must not search meal venues');
      controller.abort();window.fetch=nativeFetch;return {ok:true};
    })()`);
    assert.equal(result.ok, true); assert.deepEqual(errors, []);
  });
