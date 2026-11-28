import test from 'node:test';
import assert from 'node:assert/strict';
import { browserHarness } from '../test-support/browser.mjs';

test('the RU/EN places workspace shows an empty settlement neighbourhood without requiring a boundary link',
  { skip: !process.env.CHROME_BIN, timeout: 30000 }, async t => {
    const { evaluate, errors } = await browserHarness(t);
    const result = await evaluate(`(async()=>{
      const {placesPanel}=await import('/places-panel.mjs');
      const nativeFetch=window.fetch;
      window.fetch=async(input,options)=>{
        if(String(input).startsWith('/api/places?')) {
          const p=new URL(String(input),location.origin).searchParams;
          return Response.json({places:[],searchArea:{kind:'nearby',radiusKm:2,latitude:Number(p.get('lat')),longitude:Number(p.get('lon'))}});
        }
        if(String(input).startsWith('https://tiles.openfreemap.org/styles/'))return Response.json({version:8,sources:{},layers:[{id:'background',type:'background'}]});
        return nativeFetch(input,options);
      };
      const wait=async predicate=>{for(let i=0;i<160;i++){if(predicate())return;await new Promise(r=>setTimeout(r,25));}throw Error('Settlement workspace did not settle');};
      const statuses=[];
      for(const language of ['ru','en']) {
        const controller=new AbortController();
        const city={id:2661247,name:language==='ru'?'Ко':'Caux',latitude:46.43241,longitude:6.93855,timezone:'Europe/Zurich'};
        const panel=placesPanel(city,language,controller.signal,true);
        panel.setItinerary({button:()=>document.createElement('button'),setPlaceNames:()=>{}});
        const mapSurface=document.createElement('section');mapSurface.className='map-surface';
        mapSurface.append(...Object.values(panel.mapElements));
        document.body.replaceChildren(mapSurface,panel.element);
        await wait(()=>panel.mapElements.canvas.dataset.basemap==='vector'&&panel.mapElements.notice.textContent.includes('2'));
        statuses.push(panel.mapElements.notice.textContent);
        if(panel.mapElements.notice.querySelector('a'))throw Error('An invented boundary link was displayed');
        controller.abort();
      }
      window.fetch=nativeFetch;
      return statuses;
    })()`);
    assert.match(result[0], /Контур поселения не найден/);
    assert.match(result[0], /Подходящих мест в источнике не найдено/);
    assert.match(result[1], /No settlement boundary found/);
    assert.match(result[1], /No matching places found/);
    assert.deepEqual(errors, []);
  });
