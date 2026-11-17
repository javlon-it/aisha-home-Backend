import test from 'node:test';
import assert from 'node:assert/strict';
const base=process.env.CATALOG_TEST_URL;
test('real local MongoDB catalog integration',{skip:!base},async()=>{
 const parsed=new URL(base);
 if(!['127.0.0.1','localhost'].includes(parsed.hostname)||parsed.protocol!=='http:')throw Error('Only local test API is allowed');
 const health=await(await fetch(base+'/api/health')).json();assert.equal(health.database,'connected');
 const list=await(await fetch(base+'/api/catalog')).json();assert.equal(list.products.length,3);assert.equal(list.products.reduce((n,p)=>n+p.variants.length,0),8);
 for(const p of list.products){const r=await fetch(base+'/api/catalog/'+p.id);assert.equal(r.status,200);const value=await r.json();assert.equal(value.product.id,p.id);assert.equal(value.product.variants.length,p.variants.length);assert.ok(!('sku' in value.product.variants[0]));}
 assert.equal((await fetch(base+'/api/catalog/not-valid')).status,404);
 assert.equal((await fetch(base+'/api/catalog/012345678901234567890123')).status,404);
 assert.equal((await fetch(base+'/api/admin/products',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,404);
});
