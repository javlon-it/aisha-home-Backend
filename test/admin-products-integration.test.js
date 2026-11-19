import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import mongoose from 'mongoose';
import sharp from 'sharp';
import {createApp} from '../src/app.js';
import {AdminAccount,InventoryReceipt,Product,Variant} from '../src/models/index.js';
import {hashPassword} from '../src/routes/admin.js';

const uri=process.env.PRODUCT_TEST_MONGO;
const hash=value=>createHash('sha256').update(value).digest('hex');
test('admin product, receipt and image flow with isolated replica set and synthetic storage',{skip:!uri,timeout:120000},async()=>{
 const parsed=new URL(uri);assert.equal(parsed.protocol,'mongodb:');assert.equal(parsed.hostname,'127.0.0.1');assert.equal(parsed.port,'27029');assert.match(parsed.pathname,/^\/aisha_product_test_[a-z0-9]+$/);assert.equal(parsed.search,'?replicaSet=aishaOrdersTest');
 mongoose.set('autoIndex',false);mongoose.set('autoCreate',false);await mongoose.connect(uri,{serverSelectionTimeoutMS:5000});const db=mongoose.connection.db;assert.equal((await db.listCollections().toArray()).length,0);
 await Promise.all([AdminAccount.createIndexes(),InventoryReceipt.createIndexes(),Variant.createIndexes()]);
 const user='synthetic-admin',password='synthetic-password-123',secret=randomBytes(32).toString('hex'),origin='https://admin.example';
 await AdminAccount.create({singleton:'primary',username:user,passwordHash:await hashPassword(password),role:'admin'});
 const stored=new Map();let failUpload=false,failRemove=false;const storage={async upload(key,data){if(failUpload)return {error:{}};stored.set(key,data);return {data:{path:key}}},getPublicUrl:key=>({data:{publicUrl:'https://example.invalid/'+key}}),async remove(keys){if(failRemove)return {error:{}};for(const k of keys)stored.delete(k);return {error:null}}};
 const app=createApp({NODE_ENV:'production',CORS_ALLOWED_ORIGINS:origin,ADMIN_PROXY_SECRET:secret});app.locals.productStorage=storage;const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 function options(path,{method='GET',cookie='',body,key}={}){const raw=Buffer.isBuffer(body)?body:body?Buffer.from(JSON.stringify(body)):Buffer.alloc(0),ts=String(Date.now()),nonce=randomBytes(16).toString('hex'),ip='192.0.2.1';const message=[ts,nonce,ip,method,path,origin,hash(cookie),hash(raw)].join('\n');const headers={Origin:origin,'X-Admin-Request':'1','X-Admin-Proxy-Time':ts,'X-Admin-Proxy-Nonce':nonce,'X-Admin-Proxy-IP':ip,'X-Admin-Proxy-Signature':createHmac('sha256',Buffer.from(secret,'hex')).update(message).digest('hex')};if(cookie)headers.Cookie=cookie;if(Buffer.isBuffer(body))headers['X-Admin-Body-Hash']=hash(raw);if(body)headers['Content-Type']=Buffer.isBuffer(body)?'application/octet-stream':'application/json';if(key)headers['Idempotency-Key']=key;return {method,headers,...(body?{body:raw}:{})}}
 const req=(path,opts)=>fetch(base+path,options(path,opts));
 try{
  assert.equal((await req('/api/admin/products')).status,401);
  let r=await req('/api/admin/login',{method:'POST',body:{username:user,password}});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];
  r=await req('/api/admin/products',{method:'POST',cookie,body:{name:'Synthetic',category:'Test',description:'Demo'}});assert.equal(r.status,201);const product=(await r.json()).product;
  r=await req('/api/admin/products/'+product._id,{method:'PATCH',cookie,body:{name:'Updated',category:'Test',description:'New'}});assert.equal(r.status,200);
  r=await req('/api/admin/products/'+product._id+'/variants',{method:'POST',cookie,body:{sku:'SKU-1',color:'Oq',size:'S',price:1200}});assert.equal(r.status,201);const variant=(await r.json()).variant;
  r=await req('/api/admin/variants/'+variant._id,{method:'PATCH',cookie,body:{sku:'SKU-1',color:'Oq',size:'S',price:1500}});assert.equal(r.status,200);
  const path='/api/admin/variants/'+variant._id+'/receipts',key=randomUUID(),body={quantity:10,unitCost:100,receivedAt:'2026-01-01'};
  const [a,b]=await Promise.all([req(path,{method:'POST',cookie,body,key}),req(path,{method:'POST',cookie,body,key})]);assert.equal(a.status,200);assert.equal(b.status,200);
  assert.equal((await Variant.findById(variant._id)).stock,10);assert.equal(await InventoryReceipt.countDocuments(),1);
  assert.equal((await req(path,{method:'POST',cookie,body:{...body,unitCost:101},key})).status,409);
  const [c,d]=await Promise.all([req(path,{method:'POST',cookie,body:{...body,unitCost:200},key:randomUUID()}),req(path,{method:'POST',cookie,body:{...body,unitCost:300},key:randomUUID()})]);assert.equal(c.status,200);assert.equal(d.status,200);const saved=await Variant.findById(variant._id);assert.equal(saved.stock,30);assert.ok(Math.abs(saved.averageCost-200)<0.0001);
  const old=await Variant.create({productId:product._id,sku:'OLD-1',color:'Bej',size:'L',price:900,stock:4});const oldPath='/api/admin/variants/'+old._id+'/receipts';
  assert.equal((await req(oldPath,{method:'POST',cookie,body:{...body,quantity:2,unitCost:400},key:randomUUID()})).status,409);
  r=await req(oldPath,{method:'POST',cookie,body:{...body,quantity:2,unitCost:400,openingUnitCost:100},key:randomUUID()});assert.equal(r.status,200);const receipt=(await r.json()).receipt;assert.equal(receipt.openingStock,4);assert.equal(receipt.openingUnitCost,100);assert.equal(receipt.averageCostAfter,200);
  const list=await (await fetch(base+'/api/catalog')).json();const visible=list.products.find(p=>p.id===product._id),publicVariant=visible.variants.find(v=>v.id===variant._id);assert.equal(visible.name,'Updated');assert.equal(publicVariant.price,1500);assert.ok(visible.variants.every(v=>!('stock' in v)&&!('averageCost' in v)));
  const imagePath='/api/admin/products/'+product._id+'/image';const image=sharp({create:{width:2,height:2,channels:3,background:'#ccaa99'}}),png=await image.clone().png().toBuffer();
  assert.equal((await fetch(base+imagePath,{method:'PUT',headers:{Origin:origin,'X-Admin-Request':'1','Content-Type':'application/octet-stream'},body:png})).status,403);
  assert.equal((await req(imagePath,{method:'PUT',body:png})).status,401);
  const tampered=options(imagePath,{method:'PUT',cookie,body:png});tampered.body=Buffer.from('tampered');assert.equal((await fetch(base+imagePath,tampered)).status,403);
  r=await req(imagePath,{method:'PUT',cookie,body:png});assert.equal(r.status,200);assert.equal(stored.size,1);const first=(await Product.findById(product._id)).imageKey;
  failUpload=true;r=await req(imagePath,{method:'PUT',cookie,body:png});assert.equal(r.status,503);assert.equal((await Product.findById(product._id)).imageKey,first);failUpload=false;
  r=await req(imagePath,{method:'PUT',cookie,body:png});assert.equal(r.status,200);assert.equal(stored.size,1);assert.notEqual((await Product.findById(product._id)).imageKey,first);
  assert.equal((await req(imagePath,{method:'PUT',cookie,body:Buffer.from('not an image')})).status,400);
  assert.equal((await req(imagePath,{method:'PUT',cookie,body:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>')})).status,400);
  assert.equal((await req(imagePath,{method:'PUT',cookie,body:Buffer.alloc(4*1024*1024+1)})).status,413);
  for(const format of ['jpeg','webp']){const bytes=await image.clone().toFormat(format).toBuffer();assert.equal((await req(imagePath,{method:'PUT',cookie,body:bytes})).status,200);assert.equal(stored.size,1)}
  failRemove=true;const retained=(await Product.findById(product._id)).imageKey;assert.equal((await req(imagePath,{method:'DELETE',cookie})).status,503);assert.equal((await Product.findById(product._id)).imageKey,retained);failRemove=false;
  assert.equal((await req(imagePath,{method:'DELETE',cookie})).status,200);assert.equal(stored.size,0);assert.equal((await Product.findById(product._id)).imageUrl,undefined);
  assert.equal((await req('/api/admin/products/'+product._id+'/archive',{method:'POST',cookie})).status,200);assert.equal((await (await fetch(base+'/api/catalog')).json()).products.length,0);
 }finally{await new Promise(r=>server.close(r));assert.match(mongoose.connection.name,/^aisha_product_test_[a-z0-9]+$/);await mongoose.connection.dropDatabase();await mongoose.disconnect()}
});
