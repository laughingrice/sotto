import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const option=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]};
const browser=await chromium.launch({headless:true,executablePath:option('--chrome')||process.env.CHROME_PATH,args:['--autoplay-policy=no-user-gesture-required']});
const base=process.env.BASE_URL||'http://localhost:4174/';
function fixture(){
 const voices=[{id:'v1',name:'Violin I',color:'#31745e',instrument:'violin'},{id:'v2',name:'Violin II',color:'#657db1',instrument:'violin'}];
 const notes=voices.flatMap((voice,v)=>Array.from({length:4},(_,bar)=>({id:`${voice.id}-${bar}`,voice:voice.id,beat:bar*4,grace:0,midi:72-v*12+bar,duration:4,bar:bar+1,tie:false,measure:bar})).filter(note=>!(v===0&&note.measure===1)));
 function page(view){let body='';const ys=view==='both'?[18,29,47,58]:[20,38],step=view==='both'?72:53;
  for(let system=0;system<2;system++)for(let i=0;i<ys.length;i++){
   const v=view==='both'?Math.floor(i/2):i,center=ys[i]+system*step,lines=view==='both'&&i%2===1||view==='tabs'?6:5,top=center-(lines-1)/2;
   body+=`<g class="sotto-staff-geometry" data-system="${system}">`;
   for(let l=0;l<lines;l++)body+=`<line x1="18" x2="108" y1="${top+l}" y2="${top+l}" stroke="black" stroke-width=".1"/>`;
   body+='</g>';
   for(let b=0;b<3;b++)body+=`<rect class="sotto-bar-boundary" data-system="${system}" data-boundary="${system*2+b}" x="${18+b*45}" y="${top}" width=".15" height="${lines-1}"/>`;
   body+=`<text x="3" y="${center+1}" font-size="2.8">Vln ${v+1}</text>`;
   for(let b=system*2;b<system*2+2;b++){const note=notes.find(n=>n.voice===voices[v].id&&n.measure===b);if(!note)continue;body+=`<g id="${note.id}-${i}" class="score-note" data-event-id="${note.id}" data-voice="${note.voice}"><ellipse cx="${26+(b%2)*45}" cy="${center}" rx="1.2" ry=".75"/><rect x="${27+(b%2)*45}" y="${center-4}" width=".12" height="4"/></g>`;}
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 ${view==='both'?145:110}"><text x="30" y="7" font-size="4">Two-part CC0 test</text>${body}</svg>`;
 }
 return {format:'sotto-score',version:1,title:'Parts and practice fixture',composer:'Sotto test',subtitle:'',description:'Original synthetic CC0 exercise',bpm:100,beatUnit:1,beatsPerBar:4,voices,notes,bars:Array.from({length:4},(_,i)=>({index:i,label:String(i+1),start:i*4,duration:4,meter:[4,4]})),sequence:[0,1,2,3],pages:[page('notation')],renderings:Object.fromEntries(['notation','tabs','both'].map(view=>[view,{pages:[page(view)]}]))};
}
let page;const errors=[];
try{
 page=await browser.newPage({viewport:{width:1366,height:1050}});page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.getByRole('heading',{name:'Étude Op. 60 No. 1',exact:true}).waitFor();
 const source=fixture();await page.locator('[data-score-input]').setInputFiles({name:'parts.sotto.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});await page.getByRole('heading',{name:source.title,exact:true}).waitFor();
 const button=name=>page.getByRole('button',{name,exact:true});
 assert.equal(await page.getByRole('checkbox',{name:'Practice Violin I',exact:true}).isChecked(),true);
 await page.getByRole('combobox',{name:'Parts playback',exact:true}).selectOption('accompaniment');assert.equal(await button('Unmute violin i').count(),1);assert.equal(await button('Mute violin ii').count(),1);
 for(const view of ['notation','tabs','both']){
  await page.getByRole('combobox',{name:'Score notation view',exact:true}).selectOption(view);const original=await page.locator('.score-page svg').first().getAttribute('viewBox');
  await button('Hide Violin II staff').click();
  assert.equal(await page.locator('.score-note[data-voice="v2"]').evaluateAll(es=>es.every(e=>e.closest('[data-part-hidden]'))),true);
  assert.equal(await page.locator('.score-note[data-voice="v1"]').evaluateAll(es=>es.every(e=>!e.closest('[data-part-hidden]'))),true);
  assert.ok(Number((await page.locator('.score-page svg').first().getAttribute('viewBox')).split(/\s+/)[3])<Number(original.split(/\s+/)[3]));
  assert.equal(await page.locator('.current-bar-highlight').count(),4,'Rest-only measure keeps its highlight');
  assert.equal(await button('Mute violin ii').count(),1,'Hiding accompaniment does not mute it');
  await button('Rhythm feedback').click();assert.equal(await page.locator('.score-feedback-lane').count(),4);await button('Rhythm feedback').click();
  await button('Show all parts').click();assert.equal(await page.locator('.score-page svg').first().getAttribute('viewBox'),original,'Show all restores the exact original layout');
 }
 await page.getByRole('checkbox',{name:'Practice Violin II',exact:true}).check();assert.equal(await button('Unmute violin ii').count(),1,'All selected practice parts are silent in accompaniment mode');
 await page.getByRole('checkbox',{name:'Practice Violin I',exact:true}).uncheck();await button('Show practice parts').click();assert.equal(await button('Show Violin I staff').count(),1);assert.equal(await button('Mute violin i').count(),1);
 await button('Hide controls').click();await button('Parts and practice').click();assert.ok(await page.getByRole('dialog',{name:'Parts & practice',exact:true}).isVisible());await page.getByRole('combobox',{name:'Parts playback',exact:true}).selectOption('all');await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
 await button('Show controls').click();await button('Show all parts').click();await button('Hide Violin II staff').click();await page.waitForTimeout(650);await page.reload();await page.getByRole('heading',{name:source.title,exact:true}).waitFor();assert.equal(await button('Show Violin II staff').count(),1);assert.ok(await page.getByRole('checkbox',{name:'Practice Violin II',exact:true}).isChecked());
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Part controls fit portrait phones');await button('Hide controls').click();await button('Parts and practice').click();await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/parts-phone.png'});await button('Close parts').click();
 if(option('--score')){
  await button('Show controls').click();await page.locator('[data-score-input]').setInputFiles({name:'spring.sotto',mimeType:'application/octet-stream',buffer:await readFile(option('--score'))});await page.getByRole('heading',{name:'Spring -- From The Four Seasons',exact:true}).waitFor();await page.setViewportSize({width:1366,height:1050});
  const before=await page.locator('.score-page svg').first().getAttribute('viewBox');await button('Hide Violin II staff').click();assert.ok(await page.locator('.score-note[data-voice="violinIIvoice"]').evaluateAll(es=>es.every(e=>e.closest('[data-part-hidden]'))));await page.screenshot({path:'test-results/parts-spring-violin-i.png'});
  await button('Show all parts').click();assert.equal(await page.locator('.score-page svg').first().getAttribute('viewBox'),before);await button('Hide Violin I staff').click();assert.ok(await page.locator('.score-note[data-voice="violinIvoice"]').evaluateAll(es=>es.every(e=>e.closest('[data-part-hidden]'))));await page.screenshot({path:'test-results/parts-spring-violin-ii.png'});
 }
 assert.deepEqual(errors,[]);console.log('PASS: practice multi-selection, accompaniment vs all, independent staff visibility, vertical compaction/rest bars, Notes/Tabs/Both, feedback geometry, exact restore, saved settings and portrait access. Optional local Spring check never uploads or copies the score.');
}catch(error){if(page&&!page.isClosed()){console.log((await page.locator('body').innerText()).slice(-5500));await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/parts-failure.png'});}throw error;}finally{await browser.close();}
