// Disposable finder/editor roots; model responses are fixtures and nothing is published to dev.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtemp, readFile, writeFile, rm, stat, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';
import {chromium, expect} from 'playwright/test';
import {initializeParent} from '../infra/dev/init-parent.mjs';
import {createAdminServer} from '../admin/server.mjs';
const listen = async server => { await new Promise(r=>server.listen(0,'127.0.0.1',r)); return `http://127.0.0.1:${server.address().port}`; };
const close = async server => { server.closeAllConnections(); await new Promise(r=>server.close(r)); };
const root = await mkdtemp(join(tmpdir(),'finder-editor-browser-')), key='fixture-private-editor-key', calls=[];
let browser, admin, publicServer;
try {
 await initializeParent({root});
 const shops=[{id:'second',name:'和食の店',area:'京都',cuisine:'和食',address:'京都府京都市中京区',description:'試験',pageUrl:'https://second.example/',networkUrl:'',reservationEnabled:false},{id:'unknown',name:'住所未登録',area:'横浜',cuisine:'雑貨',pageUrl:'https://unknown.example/',networkUrl:'',reservationEnabled:false},{id:'normal',address:'神奈川県横浜市港北区大倉山２丁目１０',name:'紹介用の雑貨店',area:'横浜',cuisine:'雑貨',description:'試験用の店舗',pageUrl:'https://normal.example/',networkUrl:'',reservationEnabled:false}];
 await writeFile(join(root,'site/shops.json'),JSON.stringify({version:1,shops}));
 const registry=await readFile(join(root,'site/shops.json'));
 publicServer=createServer(async(req,res)=>{
  try {
   const path=new URL(req.url,'http://local').pathname;
   const json=value=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
   if(path==='/api/ai/config')return json({managed:true,model:'fixture-model',router:'/api/ai/v1',defaultMode:'managed'});
   if(path==='/api/ai/session')return json({token:'fixture-session',model:'fixture-model',router:'/api/ai/v1'});
   if(path==='/api/ai/v1/models')return json({data:[{id:'fixture-model'}]});
   if(path==='/shop-registry.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(`export const shops=${JSON.stringify(shops)};`);return;}
   const site=join(root,'site');let file=resolve(site,'.'+path);if(file!==site&&!file.startsWith(site+sep))throw Error('outside');if((await stat(file)).isDirectory())file=join(file,'index.html');
   res.writeHead(200,{'Content-Type':/\.m?js$/.test(file)?'text/javascript':file.endsWith('.webp')?'image/webp':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html; charset=utf-8'});res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
 });
 const publicUrl=await listen(publicServer);
 const previous=process.env.AGENT_PARENT_URL;process.env.AGENT_PARENT_URL=publicUrl;
 try {
  admin=createAdminServer({root,auth:false,geminiApiKey:key,fetch:async(_url,options)=>{
   assert.equal(options.headers['x-goog-api-key'],key);
   const parts=JSON.parse(options.body).contents[0].parts;const {current,request}=JSON.parse(parts[0].text);assert.ok(parts.some(p=>p.inlineData?.mimeType==='image/png'));const attachment=parts.find(p=>p.text?.includes('attachmentId'));calls.push({current,request,parts});
   const config=structuredClone(current);
   if(request==='青いデザインに') { config.title='青いお店さがし';config.html=config.html.replace(/(<h1\b[^>]*>)[\s\S]*?<\/h1>/,'$1街のお店との出会いを、ここから</h1>');config.css=':root{--accent:#245ba4;--paper:#edf3fb}';config.copy.greeting='お店のご相談をどうぞ。';if(attachment){const {attachmentId}=JSON.parse(attachment.text);config.html+=`<img data-image-id="${attachmentId}" alt="添付した写真">`;} }
   else { assert.equal(current.title,'青いお店さがし');config.html=config.html.replace('</main>','<section id="custom-faq"><h2>よくある質問</h2><p>雑貨店も探せます。</p></section></main>'); }
   return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({config,summary:[request==='青いデザインに'?'色と見出しを変更しました。':'よくある質問を追加しました。']})}]}}]});
  }});
 } finally { if(previous===undefined)delete process.env.AGENT_PARENT_URL;else process.env.AGENT_PARENT_URL=previous; }
 const base=await listen(admin);
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/snap/bin/chromium',args:['--no-sandbox']});
 await mkdir('test-results/site-editor',{recursive:true});
 const sharp=(await import('sharp')).default, photo=await sharp(randomBytes(1600*1400*3),{raw:{width:1600,height:1400,channels:3}}).png({compressionLevel:0}).toBuffer();assert.ok(photo.length>5*1024*1024&&photo.length<10*1024*1024);
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:1000},locale:'ja-JP'}),page=await context.newPage(),errors=[];context.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  await context.route('https://maps.google.com/**',route=>route.fulfill({contentType:'text/html',body:'<html lang="ja"><p>地図のテスト表示</p></html>'}));
  const original=await readFile(join(root,'site/index.html'));console.log('checking viewport',width);
  await page.goto(base);await page.getByRole('button',{name:'AIでページを編集',exact:true}).click();await page.waitForURL(base+'/page-editor');
  await expect(page.getByRole('heading',{name:'案内ページ',exact:true})).toBeVisible();
  await expect(page.frameLocator('iframe[title="案内ページの変更プレビュー"]').locator('#hero-title')).toBeVisible();
  if(width===390)await page.getByRole('button',{name:'スマホ',exact:true}).click();
  await page.getByRole('button',{name:'画像を添付',exact:true}).click();
  await page.getByLabel('画像をアップロード',{exact:true}).setInputFiles({name:'大きすぎる写真.png',mimeType:'image/png',buffer:Buffer.alloc(10*1024*1024+1)});
  await expect(page.getByRole('dialog',{name:'依頼の画像を選ぶ'}).getByRole('alert')).toContainText('10MB以内');
  await page.getByLabel('画像をアップロード',{exact:true}).setInputFiles({name:'紹介写真.png',mimeType:'image/png',buffer:photo});
  const picker=page.getByRole('dialog',{name:'依頼の画像を選ぶ'});await expect(picker.getByText('アップロードした画像を選択しました。内容を確認してから使用してください。')).toBeVisible();
  await picker.getByRole('button',{name:'選択した画像を使う',exact:true}).click();
  await expect(page.locator('.request-image-selection img')).toBeVisible();
  await page.getByRole('button',{name:'赤ペンで囲む',exact:true}).click();
  const canvas=page.getByLabel('変更したい箇所を囲む画面',{exact:true});await expect(canvas).toBeVisible();
  const pixelsBefore=await canvas.evaluate(n=>n.toDataURL());const box=await canvas.boundingBox();
  await page.mouse.move(box.x+box.width*.12,box.y+80);await page.mouse.down();for(let i=0;i<=24;i++){const angle=i/24*Math.PI*2;await page.mouse.move(box.x+box.width*.3+Math.cos(angle)*box.width*.15,box.y+100+Math.sin(angle)*30);}await page.mouse.up();
  const marked=await canvas.evaluate(n=>n.toDataURL());assert.notEqual(marked,pixelsBefore);
  await page.getByRole('textbox',{name:'ここをどう変えたいですか',exact:true}).fill('青いデザインに');await page.getByRole('button',{name:'送信',exact:true}).click();
  const review=page.getByRole('dialog',{name:'修正案を比較',exact:true});await expect(review).toBeVisible();
  const first=calls.at(-1);const raw=async data=>createHash('sha256').update(await sharp(Buffer.from(data,'base64')).ensureAlpha().raw().toBuffer()).digest('hex');assert.equal(await raw(first.parts.find(p=>p.inlineData?.mimeType==='image/png').inlineData.data),await raw(marked.split(',')[1]));assert.equal(first.parts.filter(p=>p.inlineData).length,2);
  await expect(page.frameLocator('iframe[title="修正案のプレビュー"]').locator('#hero-title')).toHaveText('街のお店との出会いを、ここから');
  assert.deepEqual(await readFile(join(root,'site/index.html')),original);
  await review.getByRole('button',{name:'キャンセル',exact:true}).click();await expect(page.locator('#site-design-selection')).toHaveText('公開中の内容');assert.deepEqual(await readFile(join(root,'site/index.html')),original);
  // Cancelling keeps the composed attachment and the exact marked capture available for another request.
  await page.getByRole('textbox',{name:'ここをどう変えたいですか',exact:true}).fill('青いデザインに');await page.getByRole('button',{name:'送信',exact:true}).click();await expect(review).toBeVisible();
  await review.getByRole('button',{name:'さらに変更',exact:true}).click();await review.getByLabel('さらに変更したいこと',{exact:true}).fill('よくある質問を追加して');await review.getByRole('button',{name:'修正案を更新',exact:true}).click();
  await expect(page.frameLocator('iframe[title="修正案のプレビュー"]').locator('#custom-faq')).toContainText('雑貨店も探せます。');
  assert.equal(calls.at(-1).parts.filter(p=>p.inlineData).length,2);assert.deepEqual(await readFile(join(root,'site/index.html')),original);
  await review.getByRole('button',{name:'OK',exact:true}).click();await expect(page.locator('#site-design-selection')).toHaveText('編集中 · 未公開');assert.deepEqual(await readFile(join(root,'site/index.html')),original);
  await page.getByRole('button',{name:'前の状態に戻る',exact:true}).click();await expect(page.locator('#site-design-selection')).toHaveText('公開中の内容');await page.getByRole('button',{name:'次の状態に進む',exact:true}).click();
  await page.getByRole('button',{name:'チャットを折り畳む',exact:true}).click();await expect(page.getByRole('button',{name:'画面の修正のチャットを開く'})).toBeVisible();await page.getByRole('button',{name:'画面の修正のチャットを開く'}).click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`test-results/site-editor/admin-${width}.png`,fullPage:true});
  const [published]=await Promise.all([page.waitForResponse(r=>r.url()===base+'/api/site/publish'&&r.request().method()==='POST'),page.getByRole('button',{name:'この内容を反映する',exact:true}).click()]);assert.equal(published.status(),200);await published.finished();
  const publicPage=await context.newPage();publicPage.on('pageerror',e=>errors.push(e.message));await publicPage.goto(publicUrl);
  await expect(publicPage).toHaveTitle('青いお店さがし');await expect(publicPage.locator('#hero-title')).toHaveText('街のお店との出会いを、ここから');
  await publicPage.waitForFunction(()=>!!window.__nsweb?.engine&&!document.querySelector('#ai-settings-open').disabled,{},{timeout:15000});await expect(publicPage.locator('#ns-msgs')).toContainText('お店のご相談をどうぞ。');
  await publicPage.evaluate(async()=>{const {App}=await import('./script.js');App.page.showIntroductions({shopIds:['normal']});});await expect(publicPage.locator('.shop-introduction[data-shop-id="normal"]')).toBeVisible();await expect(publicPage.locator('.candidate-button')).toHaveCount(0);
  await publicPage.locator('#shop-genre').selectOption('雑貨');await expect(publicPage.locator('#shop-list .shop-card:visible')).toHaveCount(2);await expect(publicPage.locator('#shop-visible-count')).toHaveText('2店');
  await publicPage.locator('#shop-map-select').selectOption('unknown');await expect(publicPage.locator('#shop-map-frame')).toBeHidden();await expect(publicPage.locator('#shop-map-status')).toContainText('詳しい住所はまだ登録されていません');
  await publicPage.locator('#shop-map-select').selectOption('normal');await expect(publicPage.locator('#shop-map-frame')).toBeVisible();assert.equal(new URL(await publicPage.locator('#shop-map-frame').getAttribute('src')).searchParams.get('q'),shops.find(s=>s.id==='normal').address);
  await publicPage.locator('#shop-genre').selectOption('和食');await expect(publicPage.locator('#shop-list .shop-card:visible')).toHaveCount(1);await expect(publicPage.locator('#shop-map-select')).toHaveValue('second');await expect(publicPage.locator('#shop-map-select option')).toHaveCount(2);
  await publicPage.locator('#shop-genre').selectOption('');await expect(publicPage.locator('#shop-list .shop-card:visible')).toHaveCount(3);
  assert.equal(await publicPage.locator('img[alt="添付した写真"]').evaluate(img=>img.complete&&img.naturalWidth>0),true);
  await publicPage.screenshot({path:`test-results/site-editor/published-${width}.png`,fullPage:true});await publicPage.close();
  await page.getByText('公開した履歴・変更案',{exact:true}).click();await page.getByLabel('公開した履歴',{exact:true}).selectOption('initial');await page.getByRole('button',{name:'選んだ版を確認する',exact:true}).click();
  const [restoredResponse]=await Promise.all([page.waitForResponse(r=>r.url()===base+'/api/site/publish'&&r.request().method()==='POST'),page.getByRole('button',{name:'この版に戻す',exact:true}).click()]);assert.equal(restoredResponse.status(),200);await restoredResponse.finished();
  assert.doesNotMatch(await readFile(join(root,'site/index.html'),'utf8'),/<title>青いお店さがし/);assert.deepEqual(await readFile(join(root,'site/shops.json')),registry);assert.ok(!(await page.content()).includes(key));assert.deepEqual(errors,[]);await context.close();
 }
 assert.equal(calls.length,6);console.log('PASS: shared image picker/red pen/comparison/refinement/cancel/OK/undo/redo/publication/history + genre-filtered keyless maps on desktop/mobile');
} finally { await browser?.close();if(admin)await close(admin);if(publicServer)await close(publicServer);await rm(root,{recursive:true,force:true}); }
