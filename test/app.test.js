import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp,allowedOrigins} from '../src/app.js';
test('health, CORS allowlist and errors',async()=>{
 const app=createApp({NODE_ENV:'development'}),server=app.listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));
 try {
  const url='http://127.0.0.1:'+server.address().port;
  const health=await fetch(url+'/api/health');assert.equal(health.status,200);
  const body=await health.json();assert.equal(body.database,'not_connected');assert.equal(body.databaseReady,false);assert.equal(body.businessApi,'partial');
  for(const origin of ['http://127.0.0.1:5173','http://localhost:5173']) {
   const r=await fetch(url+'/api/health',{headers:{Origin:origin}});assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),origin);assert.equal(r.headers.get('access-control-allow-credentials'),'true');
  }
  const denied=await fetch(url+'/api/health',{headers:{Origin:'https://untrusted.invalid'}});assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);assert.equal((await denied.json()).error.code,'CORS_ORIGIN_DENIED');
  const preflight=await fetch(url+'/api/health',{method:'OPTIONS',headers:{Origin:'http://localhost:5173','Access-Control-Request-Method':'GET'}});assert.equal(preflight.status,204);
  const missing=await fetch(url+'/api/unknown');assert.equal(missing.status,404);assert.equal((await missing.json()).error.code,'NOT_FOUND');
 } finally{await new Promise(r=>server.close(r))}
});
test('production CORS is closed by default and wildcard is invalid',()=>{
 assert.deepEqual(allowedOrigins({NODE_ENV:'production'}),[]);
 assert.throws(()=>allowedOrigins({CORS_ALLOWED_ORIGINS:'*'}));
 assert.throws(()=>allowedOrigins({CORS_ALLOWED_ORIGINS:'https://example.com/path'}));
 assert.throws(()=>allowedOrigins({NODE_ENV:'production',CORS_ALLOWED_ORIGINS:'http://example.com'}));
});
test('production order origin required',async()=>{
 const app=createApp({NODE_ENV:'production',CORS_ALLOWED_ORIGINS:'https://shop.example'}),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try {const url='http://127.0.0.1:'+server.address().port+'/api/orders';assert.equal((await fetch(url,{method:'POST',headers:{Origin:'https://evil.example'}})).status,403);for(const headers of [{},{Origin:'https://shop.example'}]){const response=await fetch(url,{method:'POST',headers});assert.equal(response.status,503);assert.equal((await response.json()).error.code,'ORDERS_DISABLED');}}finally{await new Promise(r=>server.close(r))}
});
