// A normal shop explicitly denies embedding. No real model or reservation is used.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join,sep} from 'node:path';
import {chromium,expect} from 'playwright/test';
const root=resolve(fileURLToPath(new URL('../site/',import.meta.url)));
const normal={id:'normal',name:'普通の店舗',area:'横浜',cuisine:'雑貨',pageUrl:'https://normal.example/',networkUrl:'',reservationEnabled:true,reservationUrl:'https://normal.example/?pane=reserve'};
const agent={...normal,id:'agent',name:'予約連携店',pageUrl:'https://agent.example/s/agent/',networkUrl:'https://agent.example/s/agent/agent/shop_guide',reservationUrl:'https://agent.example/s/agent/reserve'};
const infoAgent={...agent,id:'information',name:'紹介だけのエージェント',pageUrl:'https://agent.example/s/information/',reservationEnabled:false,reservationUrl:undefined};
const shops=[normal,agent,infoAgent];
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://local').pathname;
  const json=value=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(path==='/api/ai/config')return json({managed:true,model:'fixture-model',router:'/api/ai/v1',defaultMode:'managed'});
  if(path==='/api/ai/session')return json({token:'fixture-session',model:'fixture-model',router:'/api/ai/v1'});
  if(path==='/api/ai/v1/models')return json({data:[{id:'fixture-model'}]});
  if(path==='/shop-registry.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end('export const shops='+JSON.stringify(shops)+';');return;}
  let file=resolve(root,'.'+path);if(file!==root&&!file.startsWith(root+sep))throw new Error('outside');if((await stat(file)).isDirectory())file=join(file,'index.html');
  res.writeHead(200,{'Content-Type':/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html'});res.end(await readFile(file));
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;let browser;
try{
 await mkdir('test-results/reservation-links',{recursive:true});
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/snap/bin/chromium',args:['--no-sandbox']});
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:1000},locale:'ja-JP'}),page=await context.newPage(),errors=[],embeddedNormal=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().startsWith(normal.pageUrl)&&r.isNavigationRequest()&&r.frame().parentFrame())embeddedNormal.push(r.url());});
  await context.route('https://normal.example/**',route=>route.fulfill({headers:{'X-Frame-Options':'DENY','Content-Security-Policy':"frame-ancestors 'none'"},contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><title>普通の店舗</title><p>店舗サイト</p>'}));
  await context.route('https://agent.example/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><title>予約連携店</title><p>予約画面</p>'}));
  await page.goto(base);await page.waitForFunction(()=>!!window.__nsweb?.engine&&!document.querySelector('#ai-settings-open').disabled);
  await page.evaluate(async()=>{const {App}=await import('./script.js');App.page.showIntroductions({shopIds:['normal','agent','information']});});
  const plain=page.locator('.shop-introduction[data-shop-id="normal"]');await expect(plain).toBeVisible();await expect(plain.locator('.candidate-button')).toHaveCount(0);await expect(plain).not.toContainText('予約ページあり');
  const links=await plain.locator('a').evaluateAll(links=>links.map(a=>a.href));assert.deepEqual(links,[normal.pageUrl]);
  const popupPromise=page.waitForEvent('popup');await plain.getByRole('link',{name:'店舗サイトを開く'}).click();const popup=await popupPromise;await popup.waitForLoadState('domcontentloaded');assert.equal(popup.url(),normal.pageUrl);assert.equal(await popup.title(),'普通の店舗');await popup.close();assert.deepEqual(embeddedNormal,[]);
  await expect(page.locator('.shop-introduction[data-shop-id="information"] .candidate-button')).toHaveCount(0);
  await page.locator('.shop-introduction[data-shop-id="agent"]').getByRole('button',{name:'予約ページへ'}).click();await expect(page.locator('#shop-page-frame')).toHaveAttribute('src',agent.reservationUrl);await expect(page.frameLocator('#shop-page-frame').getByText('予約画面')).toBeVisible();
  await page.locator('#shop-close').click();
  const date=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
  await page.evaluate(async date=>{const {App}=await import('./script.js');App.page.setConditions({date,time:'19:00',partySize:2});App.page.showCandidates({candidates:[{shopId:'agent',status:'unknown',summary:'取得できませんでした'}],expectedVersion:App.page.version});},date);
  await expect(page.locator('.finder-results[data-current="true"] .candidate-button')).toHaveCount(0);
  await page.evaluate(async()=>{const {App}=await import('./script.js');App.page.showCandidates({candidates:[{shopId:'agent',status:'available',summary:'予約情報を確認しました'}],expectedVersion:App.page.version});});
  await expect(page.locator('.finder-results[data-current="true"] .candidate-button')).toHaveCount(1);
  const refused=await page.evaluate(async()=>{const {App}=await import('./script.js');return App.shopFrame.open('normal',{target:'reserve'});});assert.equal(refused.ok,false);await expect(page.locator('#shop-page-frame')).not.toHaveAttribute('src',/.+/);
  await page.screenshot({path:`test-results/reservation-links/finder-${width}.png`,fullPage:true});assert.deepEqual(errors,[]);
  await page.goto(`${base}/?shop=normal&view=reserve`);await page.waitForFunction(()=>!!window.__nsweb?.engine&&!document.querySelector('#ai-settings-open').disabled);await expect(page.locator('#shop-page-frame')).not.toHaveAttribute('src',/.+/);assert.deepEqual(embeddedNormal,[]);
  console.log(`${width}px: unlinked bookings hidden; normal site opens in a tab despite DENY; linked bookings work; unknown availability and restored unsupported routes have no booking frame.`);await context.close();
 }
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
