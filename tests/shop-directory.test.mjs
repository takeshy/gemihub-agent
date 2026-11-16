import test from 'node:test';
import assert from 'node:assert/strict';
import {directoryGenres,filterDirectory,shopMapQuery,mapEmbedUrl,mapOpenUrl} from '../site/shop-directory.js';
import {validateShops} from '../scripts/shops.mjs';
import {extractShopPage} from '../scripts/shop-html.mjs';
test('genres filter the directory without mutating or conflating shops and reservation support',()=>{
 const shops=[{id:'a',cuisine:'雑貨',reservationEnabled:false},{id:'b',cuisine:'和食',reservationEnabled:true},{id:'c',cuisine:'雑貨',reservationEnabled:true}];const before=structuredClone(shops);
 assert.deepEqual(directoryGenres(shops).sort(),['和食','雑貨'].sort());assert.equal(filterDirectory(shops,'').length,3);assert.deepEqual(filterDirectory(shops,'雑貨').map(s=>s.id),['a','c']);assert.deepEqual(filterDirectory(shops,'不明'),[]);assert.deepEqual(shops,before);
});
test('the keyless map uses only the full registered address and encodes it as data',()=>{
 assert.equal(shopMapQuery({name:'架空店',area:'東京都'}),'');const query='〒222-0037 神奈川県横浜市港北区大倉山２丁目１０';const url=new URL(mapEmbedUrl(query));assert.equal(url.origin,'https://maps.google.com');assert.equal(url.searchParams.get('q'),query);assert.equal(url.searchParams.get('output'),'embed');assert.ok(!url.searchParams.has('key'));assert.equal(new URL(mapOpenUrl(query)).searchParams.get('query'),query);
});
test('full postal and street addresses survive HTML import and shop validation',()=>{
 const info=extractShopPage('<script type="application/ld+json">'+JSON.stringify({'@type':'Store',name:'雑貨店',address:{postalCode:'222-0037',addressRegion:'神奈川県',addressLocality:'横浜市港北区',streetAddress:'大倉山２丁目１０'}})+'</script>');assert.equal(info.address,'〒222-0037神奈川県横浜市港北区大倉山２丁目１０');
 const shop={id:'a',name:info.name,address:info.address,area:'神奈川県横浜市港北区',cuisine:'雑貨',pageUrl:'https://example.com/',networkUrl:'',reservationEnabled:false};assert.equal(validateShops({version:1,shops:[shop]})[0].address,info.address);assert.throws(()=>validateShops({version:1,shops:[{...shop,address:'x'.repeat(501)}]}));
});
