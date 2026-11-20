import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createProductStorage,createSupabaseClient,checkProductBucket,reportSupabaseConnection} from '../src/config/supabase.js';
import {createApp} from '../src/app.js';

const valid={SUPABASE_URL:'https://example.invalid',SUPABASE_SECRET_KEY:'synthetic-secret',SUPABASE_STORAGE_BUCKET:'products'};

test('product storage requires an HTTPS origin, a key and the products bucket',()=>{
 for(const env of [{},{...valid,SUPABASE_URL:'http://example.invalid'},{...valid,SUPABASE_URL:'https://user:pass@example.invalid'},{...valid,SUPABASE_URL:'https://example.invalid/path'},{...valid,SUPABASE_SECRET_KEY:''},{...valid,SUPABASE_STORAGE_BUCKET:'other'}])assert.equal(createProductStorage(env),null);
 const storage=createProductStorage(valid);assert.ok(storage);assert.equal(typeof storage.upload,'function');
});

test('bucket check uses a read-only GET and handles failures without exposing details',async()=>{
 const original=globalThis.fetch;let calls=[];
 try{
  globalThis.fetch=async(url,options)=>{calls.push({url:String(url),method:options?.method||'GET'});return new Response(JSON.stringify({id:'products'}),{status:200,headers:{'content-type':'application/json'}})};
  assert.equal(await checkProductBucket(createSupabaseClient(valid)),true);
  assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');assert.equal(new URL(calls[0].url).pathname,'/storage/v1/bucket/products');
  globalThis.fetch=async()=>new Response(JSON.stringify({message:'synthetic private details'}),{status:403,headers:{'content-type':'application/json'}});
  assert.equal(await checkProductBucket(createSupabaseClient(valid)),false);assert.equal(await checkProductBucket(null),false);
 }finally{globalThis.fetch=original}
});

test('startup check logs one safe result on success, failure and timeout',async()=>{
 for(const [client,expected] of [[{storage:{getBucket:async()=>({data:{id:'products'}})}},'Supabase connection: PASS'],[null,'Supabase connection: FAIL (CONFIG_INVALID)'],[{storage:{getBucket:async()=>{throw Error('private synthetic secret')}}},'Supabase connection: FAIL (NETWORK_OR_CLIENT_ERROR)'],[{storage:{getBucket:()=>new Promise(()=>{})}},'Supabase connection: FAIL (TIMEOUT)'],[{storage:{getBucket:async()=>({data:{id:'other'}})}},'Supabase connection: FAIL (INVALID_RESPONSE)']]){
  const logs=[];await reportSupabaseConnection(client,{timeoutMs:15,log:message=>logs.push(message)});assert.deepEqual(logs,[expected]);
 }
});

test('actual SDK HTTP errors produce only safe status and classification',async()=>{
 const original=globalThis.fetch;
 try{for(const [status,reason] of [[401,'AUTH_OR_PERMISSION'],[403,'AUTH_OR_PERMISSION'],[404,'BUCKET_OR_ENDPOINT_NOT_FOUND'],[500,'HTTP_ERROR']]){
  globalThis.fetch=async()=>new Response(JSON.stringify({message:'private synthetic secret'}),{status,headers:{'content-type':'application/json'}});
  const logs=[];await reportSupabaseConnection(createSupabaseClient(valid),{log:message=>logs.push(message)});
  assert.deepEqual(logs,[`Supabase connection: FAIL (${reason}, HTTP ${status})`]);
 }}finally{globalThis.fetch=original}
});

test('startup listens before the Supabase check and does not await it',()=>{
 const events=[];const source=readFileSync(new URL('../server.js',import.meta.url),'utf8').split(/\r?\n/).filter(line=>!line.startsWith('import ')).join('\n');
 const context={process:{env:{PORT:'5000'}},console:{log:()=>events.push('log'),error:()=>{}},setTimeout,connectDatabase:async()=>{},startOrderExpiryWorker:()=>events.push('worker'),createSupabaseClient:()=>({}),reportSupabaseConnection:()=>{events.push('check');return new Promise(()=>{})},createApp:()=>({listen:(port,host,callback)=>{events.push('listen');callback();events.push('listen-returned')}})};
 runInNewContext(source,context);assert.deepEqual(events,['listen','log','worker','check','listen-returned']);
});

test('synthetic Storage HTTP responses exercise SDK upload and removal',async()=>{
 const original=globalThis.fetch,calls=[];
 try{
  globalThis.fetch=async(url,options)=>{calls.push({path:new URL(String(url)).pathname,method:options.method});return new Response(options.method==='DELETE'?'[]':'{"Key":"products/synthetic.png"}',{status:200,headers:{'content-type':'application/json'}})};
  const storage=createProductStorage(valid);const upload=await storage.upload('synthetic.png',Buffer.from('synthetic'),{contentType:'image/png',upsert:false});assert.equal(upload.error,null);
  assert.match(storage.getPublicUrl('synthetic.png').data.publicUrl,/\/storage\/v1\/object\/public\/products\/synthetic\.png$/);
  const removed=await storage.remove(['synthetic.png']);assert.equal(removed.error,null);
  assert.deepEqual(calls,[{path:'/storage/v1/object/products/synthetic.png',method:'POST'},{path:'/storage/v1/object/products',method:'DELETE'}]);
 }finally{globalThis.fetch=original}
});

test('missing, invalid or unavailable storage does not block existing application routes',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({message:'synthetic failure'}),{status:503,headers:{'content-type':'application/json'}})};
  const app=createApp({...valid,NODE_ENV:'production'});assert.ok(app.locals.productStorage);assert.equal(calls,0);
  const result=await app.locals.productStorage.list();assert.ok(result.error);assert.equal(calls,1);
  assert.equal(createApp({SUPABASE_URL:'invalid'}).locals.productStorage,null);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{const base='http://127.0.0.1:'+server.address().port;const response=await original(base+'/api/health/live');assert.equal(response.status,200);const order=await original(base+'/api/orders',{method:'POST'});assert.equal(order.status,503);assert.equal((await order.json()).error.code,'ORDERS_DISABLED')}finally{await new Promise(r=>server.close(r))}
 }finally{globalThis.fetch=original}
});
