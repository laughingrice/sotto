import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const index=process.argv.indexOf('--chrome');
const browser=await chromium.launch({headless:true,executablePath:index<0?process.env.CHROME_PATH:process.argv[index+1],args:['--autoplay-policy=no-user-gesture-required']});
const score=await readFile(new URL('../public/scores/prototypes/guitar.sotto',import.meta.url));
const base=process.env.BASE_URL||'http://localhost:4174/', syncPath='/Apps/Sotto/practice-settings-v1.json';
let cloud=null, rev=0, uploads=0, codes=0, failed=false, scoreDownloads=0;
const grants=new Map(), errors=[], writtenPaths=[];
const metadata=(id,name,folder=false)=>({id:'id:'+id,name,'.tag':folder?'folder':'file',size:score.length});
async function setup(page){
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.route('https://www.dropbox.com/oauth2/authorize*',async route=>{
  const url=new URL(route.request().url()),code='code'+(++codes),scope=url.searchParams.get('scope');
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');grants.set(code,scope);
  const callback=new URL(url.searchParams.get('redirect_uri'));callback.searchParams.set('code',code);callback.searchParams.set('state',url.searchParams.get('state'));
  await route.fulfill({status:302,headers:{Location:callback.href}});
 });
 await page.route('https://*.dropboxapi.com/**',async route=>{
  const request=route.request(),url=new URL(request.url()),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type,dropbox-api-arg','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Expose-Headers':'Dropbox-API-Result','Content-Type':'application/json'};
  const reply=(data,status=200,extra={})=>route.fulfill({status,headers:{...headers,...extra},body:JSON.stringify(data)});
  if(request.method()==='OPTIONS')return reply({});assert.equal(request.method(),'POST');
  if(url.pathname==='/oauth2/token'){
   const args=new URLSearchParams(request.postData()),scope=grants.get(args.get('code'))||(args.get('refresh_token')==='refresh-sync'?'account_info.read files.metadata.read files.content.read files.content.write':'account_info.read files.metadata.read files.content.read');
   assert.ok(!args.has('client_secret'));const sync=scope.includes('files.content.write');
   return reply({access_token:sync?'token-sync':'token-read',refresh_token:sync?'refresh-sync':'refresh-read',account_id:'dbid:account',scope,expires_in:14400});
  }
  const token=request.headers().authorization;assert.ok(['Bearer token-sync','Bearer token-read'].includes(token));
  if(url.pathname==='/2/users/get_current_account')return reply({account_id:'dbid:account',email:'person@example.test'});
  if(url.pathname==='/2/files/download'){
   const args=JSON.parse(request.headers()['dropbox-api-arg']);
   if(args.path===syncPath){
    assert.equal(token,'Bearer token-sync');if(failed)return reply({},503);
    if(!cloud)return reply({error:{'.tag':'path',path:{'.tag':'not_found'}}},409);
    return reply(cloud,200,{'Dropbox-API-Result':JSON.stringify({rev:String(rev)})});
   }
   assert.equal(args.path,'id:piece');scoreDownloads++;
   return route.fulfill({headers:{...headers,'Content-Type':'application/octet-stream','Dropbox-API-Result':JSON.stringify(metadata('piece','piece.sotto'))},body:score});
  }
  if(url.pathname==='/2/files/upload'){
   const args=JSON.parse(request.headers()['dropbox-api-arg']);writtenPaths.push(args.path);assert.equal(args.path,syncPath);assert.equal(token,'Bearer token-sync');assert.equal(args.autorename,false);assert.equal(args.strict_conflict,true);
   if(failed)return reply({},503);
   if(cloud?args.mode['.tag']!=='update'||args.mode.update!==String(rev):args.mode['.tag']!=='add')return reply({},409);
   cloud=JSON.parse(request.postData());rev++;uploads++;assert.ok(!/token-|refresh-|<svg|"pages"|"beat"|microphone|person@example/.test(JSON.stringify(cloud)));
   return reply({rev:String(rev)});
  }
  if(url.pathname==='/2/files/list_folder'){
   const args=request.postDataJSON();assert.equal(args.recursive,false);
   const entries=args.path===''?[metadata('scores','Scores',true)]:args.path==='id:scores'?[metadata('guitar','Guitar',true)]:args.path==='id:guitar'?[metadata('piece','piece.sotto')]:null;
   assert.ok(entries);return reply({entries,has_more:false});
  }
  throw new Error('Unexpected Dropbox endpoint '+url.pathname);
 });
}
const button=(page,name)=>page.getByRole('button',{name,exact:true});
const title=page=>page.getByRole('heading',{name:'Guitar · four-bar tab prototype',exact:true});
async function openLibrary(page){if(!await page.getByRole('heading',{name:'Score library',exact:true}).isVisible())await button(page,'Score library').click();}
async function panel(page){const box=page.locator('.dropbox-panel');if(await box.getAttribute('open')===null)await box.locator('summary').first().click();return box;}
async function initialize(context,nested){
 const page=await context.newPage();await setup(page);await page.goto(base);await page.getByRole('heading',{name:'Étude Op. 60 No. 1',exact:true}).waitFor();await openLibrary(page);await panel(page);
 await page.getByRole('textbox',{name:'Dropbox App key',exact:true}).fill('testAppKey123');await button(page,'Sign in to Dropbox').click();await button(page,'Browse Dropbox folders').waitFor();

 await button(page,'Browse Dropbox folders').click();await page.locator('.dropbox-folders').getByRole('button',{name:'Scores',exact:true}).click();
 if(nested)await page.locator('.dropbox-folders').getByRole('button',{name:'Guitar',exact:true}).click();
 await button(page,'Connect this Dropbox folder').click();await page.getByText(/1 Dropbox score bookmarks/).waitFor();await page.getByRole('textbox',{name:'Search library',exact:true}).fill('piece');
 await page.locator('.library-open').click();await title(page).waitFor();await page.getByRole('heading',{name:'Score library',exact:true}).waitFor({state:'hidden'});return page;
}
async function enable(page){await openLibrary(page);await panel(page);await button(page,'Enable settings sync').click();await button(page,'Disable settings sync').waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('[role="status"]')].some(node=>(node.textContent.includes('up to date')||node.textContent.includes('will apply when paused'))));}
async function syncNow(page){await openLibrary(page);await panel(page);await button(page,'Sync settings now').click();await page.waitForFunction(()=>[...document.querySelectorAll('[role="status"]')].some(node=>(node.textContent.includes('up to date')||node.textContent.includes('will apply when paused'))));}
async function closeLibrary(page){await button(page,'Close library').click();}
async function stored(page){return page.evaluate(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('sotto-library');r.onsuccess=()=>resolve(r.result)});const data=await new Promise(resolve=>{const r=db.transaction('library').objectStore('library').get('index');r.onsuccess=()=>resolve(r.result)});db.close();const entry=data.entries.find(e=>e.dropbox?.itemId==='id:piece');return {entry,settings:JSON.parse(localStorage.getItem('sotto.practice.library:'+entry.id)||'{}')};});}
let a,b,ca,cb;
try{
 ca=await browser.newContext({viewport:{width:1440,height:1000}});a=await initialize(ca,false);
 const originalBpm=Number((await a.locator('.tempo-control strong').innerText()).replace('BPM',''));
 await button(a,'Faster').click();await a.getByRole('combobox',{name:'Loop start measure',exact:true}).selectOption('1');await a.getByRole('combobox',{name:'Loop end measure',exact:true}).selectOption('2');await a.getByRole('switch',{name:'Practice loop',exact:true}).click();
 await openLibrary(a);await a.getByRole('textbox',{name:'Search library',exact:true}).fill('piece');await a.locator('.favorite-button').click();await enable(a);
 assert.equal(cloud.songs['id:piece'].favorite.value,true);assert.equal(cloud.songs['id:piece'].practice.bpm.value,originalBpm+1);
 cb=await browser.newContext({viewport:{width:768,height:1024}});
 // Initializing the second profile is still read-only despite the first profile enabling sync.
 b=await initialize(cb,true);
 await enable(b);await closeLibrary(b);
 await b.waitForFunction(expected=>document.querySelector('.tempo-control strong')?.textContent===expected+'BPM',originalBpm+1);
 assert.equal(await b.getByRole('combobox',{name:'Loop start measure',exact:true}).inputValue(),'1');assert.equal(await b.getByRole('combobox',{name:'Loop end measure',exact:true}).inputValue(),'2');assert.equal(await b.getByRole('switch',{name:'Practice loop',exact:true}).getAttribute('aria-checked'),'true');
 assert.equal((await stored(b)).entry.favorite,true);
 const idA=(await stored(a)).entry.id,idB=(await stored(b)).entry.id;assert.notEqual(idA,idB,'Different library roots yield different local bookmark keys');
 await button(b,'Faster').click();await syncNow(b);await syncNow(a);await closeLibrary(a);
 await a.waitForFunction(expected=>document.querySelector('.tempo-control strong')?.textContent===expected+'BPM',originalBpm+2);
 // Unfavoriting is explicit and must travel back, too.
 await openLibrary(b);await b.getByRole('textbox',{name:'Search library',exact:true}).fill('piece');await b.locator('.favorite-button').click();await syncNow(b);await syncNow(a);assert.equal((await stored(a)).entry.favorite,false);
 // Offline edits survive an unsuccessful sync and merge on reconnection.
 failed=true;await closeLibrary(b);await button(b,'Faster').click();await openLibrary(b);await panel(b);await button(b,'Sync settings now').click();await b.getByText(/Dropbox is temporarily unavailable/).first().waitFor();
 failed=false;await syncNow(b);await syncNow(a);assert.equal((await stored(a)).settings.bpm,originalBpm+3);
 // Incoming settings wait while playing and keep the selected tablature view.
 await closeLibrary(a);await a.getByRole('combobox',{name:'Score notation view',exact:true}).selectOption('tabs');await button(a,'Play score').click();await button(a,'Pause playback').waitFor();
 await closeLibrary(b);await button(b,'Faster').click();await syncNow(b);await syncNow(a);await closeLibrary(a);
 assert.equal(await a.locator('.tempo-control strong').innerText(),(originalBpm+3)+'BPM','Remote tempo is deferred during playback');assert.ok(await button(a,'Pause playback').isVisible());
 await button(a,'Pause playback').click();await a.waitForFunction(expected=>document.querySelector('.tempo-control strong')?.textContent===expected+'BPM',originalBpm+4);
 assert.equal(await a.getByRole('combobox',{name:'Score notation view',exact:true}).inputValue(),'tabs','Sync preserves the score display');
 // Screen/mic/position data and score files are absent from the dedicated cloud file.
 assert.ok(writtenPaths.every(path=>path===syncPath));assert.ok(scoreDownloads>=2);assert.ok(JSON.stringify(cloud).length<10000);
 // Disabling sync preserves score reading and prevents subsequent uploads.
 await button(b,'Disable settings sync').click();await button(b,'Enable settings sync').waitFor();const written=uploads;await closeLibrary(b);await button(b,'Faster').click();await b.waitForTimeout(2200);assert.equal(uploads,written);
 await mkdir('test-results',{recursive:true});await openLibrary(a);await panel(a);await a.screenshot({path:'test-results/dropbox-settings-sync.png'});
 assert.deepEqual(errors,[]);console.log('PASS: two browser profiles, explicit optional write consent, per-file identity across different roots, favorites/unfavorites, tempo/loops, offline retry, bounded metadata-only cloud file and disabling sync. Dropbox itself is simulated.');
}catch(error){for(const [name,page]of[['computer',a],['tablet',b]])if(page&&!page.isClosed()){console.log(name,(await page.locator('body').innerText()).slice(-5000));await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/dropbox-sync-'+name+'-failure.png'});}throw error;}finally{await browser.close();}
