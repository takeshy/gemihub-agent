import { chromium } from 'playwright';
export function createSiteCapture({executablePath=process.env.CHROMIUM || process.env.CHROMIUM_PATH || '/snap/bin/chromium'}={}) {
  let busy=false;
  return async ({html,width})=>{
    if(![390,1280].includes(width))throw Object.assign(new Error('プレビューの幅を確認してください。'),{status:400});
    if(busy)throw Object.assign(new Error('画面を取り込んでいます。少し待ってからお試しください。'),{status:429});
    busy=true;let browser;
    try {
      browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage'],timeout:20000});
      const context=await browser.newContext({javaScriptEnabled:false,serviceWorkers:'block',viewport:{width,height:1000},deviceScaleFactor:1});
      // Captures use server-rendered, inert HTML; never navigate to a client-supplied URL.
      await context.route('**/*',route=>route.abort());
      const page=await context.newPage();page.setDefaultTimeout(15000);await page.setContent(html,{waitUntil:'load',timeout:15000});
      const height=await page.evaluate(()=>Math.min(6000,Math.max(1000,document.documentElement.scrollHeight)));
      const buffer=await page.screenshot({type:'png',clip:{x:0,y:0,width,height},timeout:15000});
      if(buffer.length>5*1024*1024)throw Error('too large');
      return {mimeType:'image/png',data:buffer.toString('base64')};
    } catch { throw Object.assign(new Error('画面を取り込めませんでした。少し待ってからお試しください。'),{status:502}); }
    finally { try { await browser?.close(); } finally { busy=false; } }
  };
}
