import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { atomicFile } from './site-design.mjs';
const fail = (status, message) => { throw Object.assign(new Error(message), {status}); };
export const imageId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function imageIds(value = []) {
  if (!Array.isArray(value) || value.length > 15 || value.some(id => !imageId(id)) || new Set(value).size !== value.length) fail(400, '添付画像を確認してください。画像は15枚まで選べます。');
  return value;
}
function bytes(input, pngOnly = false) {
  const maxMB = pngOnly ? 5 : 10, limit = maxMB * 1024 * 1024;
  if (!input || typeof input !== 'object' || typeof input.data !== 'string') fail(400, '画像の形式を確認してください。');
  if (input.data.length > Math.ceil(limit / 3) * 4) fail(400, `画像は1枚${maxMB}MB以内にしてください。`);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.data)) fail(400, '画像の形式を確認してください。');
  const data = Buffer.from(input.data, 'base64');
  if (!data.length || data.length > limit || data.toString('base64') !== input.data) fail(400, `画像は1枚${maxMB}MB以内にしてください。`);
  if (!(pngOnly ? ['image/png'] : ['image/png','image/jpeg','image/webp','image/gif']).includes(input.mimeType)) fail(400, 'PNG・JPEG・GIF・WebP画像を選んでください。');
  return data;
}
export async function annotationMedia(input) {
  if (input === undefined) return undefined;
  const data = bytes(input, true);
  try {
    const image = sharp(data, {limitInputPixels: 12_000_000}); const info = await image.metadata();
    if (info.format !== 'png' || info.width > 1440 || info.height > 6000) fail(400, '画面の画像が大きすぎます。画面を取り直してください。');
    return {mimeType:'image/png', data:(await image.png().toBuffer()).toString('base64')};
  } catch (e) { if (e.status) throw e; fail(400, '画面の画像を読み込めませんでした。'); }
}
export function createSiteImages({root}) {
  const directory = join(root, 'admin/site-images');
  const metadata = async id => { if (!imageId(id)) fail(400, '画像IDを確認してください。'); try { return JSON.parse(await readFile(join(directory, id+'.json'), 'utf8')); } catch (e) { if (e.code === 'ENOENT') fail(404, '画像が見つかりません。'); throw e; } };
  async function read(id) { const item = await metadata(id); return {...item, data:(await readFile(join(directory,id+'.webp'))).toString('base64')}; }
  return {
    async list() { let names; try { names = await readdir(directory); } catch(e) { if(e.code === 'ENOENT') return []; throw e; } return Promise.all(names.filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(n=>metadata(n.slice(0,-5)))); },
    async upload(input) {
      if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 255 || /[\x00-\x1f\x7f]/.test(input.name)) fail(400, '画像の名前を確認してください。');
      const raw=bytes(input); let data;
      try { const image=sharp(raw,{limitInputPixels:20_000_000}); const info=await image.metadata(); if(!['png','jpeg','webp','gif'].includes(info.format) || 'image/'+(info.format==='jpeg'?'jpeg':info.format)!==input.mimeType) fail(400,'画像の形式を確認してください。'); data=await image.rotate().webp({quality:90}).toBuffer(); }
      catch(e) { if(e.status) throw e; fail(400,'画像を読み込めませんでした。'); }
      if(data.length>10*1024*1024)fail(400,'画像は1枚10MB以内にしてください。');
      const id=createHash('sha256').update(data).digest('hex'); await mkdir(directory,{recursive:true});
      try { await metadata(id); } catch(e) { if(e.status!==404)throw e; await atomicFile(join(directory,id+'.webp'),data,0o600); await atomicFile(join(directory,id+'.json'),JSON.stringify({id,name:input.name.trim(),mimeType:'image/webp',size:data.length,source:'upload',createdAt:new Date().toISOString(),usedBy:[]}),0o600); }
      return {imageId:id};
    },
    read,
    async inline(ids) { return Promise.all(imageIds(ids).map(async id=>{ const item=await read(id); const data=await sharp(Buffer.from(item.data,'base64')).resize({width:1400,height:1400,fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer();return {id,name:item.name,mimeType:'image/jpeg',data:data.toString('base64')}; })); },
    async url(id) { const item=await read(id); return `data:${item.mimeType};base64,${item.data}`; },
    async publish(ids) {
      const created=[];
      try { for(const id of new Set(ids)) {
        const item=await read(id),path=join(root,'site/page-images',id+'.webp');
        try { await stat(path); } catch(e) { if(e.code!=='ENOENT')throw e; await atomicFile(path,Buffer.from(item.data,'base64'));created.push(path); }
      } return created; }
      catch(e) { await Promise.all(created.map(path=>rm(path,{force:true})));throw e; }
    },
    async rollback(paths) { await Promise.all(paths.map(path=>rm(path,{force:true}))); },
  };
}
