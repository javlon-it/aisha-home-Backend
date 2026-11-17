import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createOrderRateLimit} from '../src/middlewares/order-rate-limit.js';
import {createApp} from '../src/app.js';

function attempt(limit,ip,headers={}) {
 const result={status:200,headers:{}};
 const res={set(k,v){result.headers[k]=v;return this},status(s){result.status=s;return this},json(body){result.body=body;return this}};
 limit({socket:{remoteAddress:ip},headers},res,()=>{result.allowed=true});
 return result;
}
test('independent peers, spoofed headers, expiry, IPv6 grouping and bounded storage',()=>{
 let time=0;
 const limit=createOrderRateLimit({ORDER_RATE_LIMIT_MAX:2,ORDER_RATE_LIMIT_WINDOW_MS:1000,ORDER_RATE_LIMIT_MAX_KEYS:3},{now:()=>time});
 assert.equal(attempt(limit,'127.0.0.1').allowed,true);
 assert.equal(attempt(limit,'::ffff:127.0.0.1').allowed,true);
 const blocked=attempt(limit,'127.0.0.1',{'x-forwarded-for':'203.0.113.2',cookie:'new-session'});
 assert.equal(blocked.status,429);assert.equal(blocked.headers['Retry-After'],'1');
 assert.equal(attempt(limit,'127.0.0.2').allowed,true);
 assert.equal(attempt(limit,'2001:db8:1:2::1').allowed,true);
 assert.equal(attempt(limit,'2001:db8:1:2::2').allowed,true);
 assert.equal(attempt(limit,'2001:0db8:0001:0002::3').status,429);
 assert.equal(attempt(limit,'127.0.0.3').status,429);
 time=1000;assert.equal(attempt(limit,'127.0.0.3').allowed,true);
 assert.equal(attempt(limit,'127.0.0.1').allowed,true);
});
test('invalid configuration fails without echoing configuration values',()=>{
 for(const value of ['0','-1','1.5','secret'])assert.throws(()=>createOrderRateLimit({ORDER_RATE_LIMIT_MAX:value}),/^Error: ORDER_RATE_LIMIT_MAX must be a positive integer$/);
});
test('HTTP limiter precedes JSON parsing, ignores forwarding headers and leaves GET untouched',async()=>{
 const app=createApp({ORDER_RATE_LIMIT_MAX:2});assert.equal(app.get('trust proxy'),false);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url=`http://127.0.0.1:${server.address().port}`;
 try{
  for(let i=0;i<3;i++){
   const response=await fetch(url+'/api/ORDERS/',{method:'POST',headers:{'content-type':'application/json','x-forwarded-for':`203.0.113.${i}`,'x-real-ip':`203.0.113.${i}`,forwarded:`for=203.0.113.${i}`},body:'{"phone":"PRIVATE-PHONE","address":"PRIVATE-ADDRESS",'});
   assert.equal(response.status,i<2?400:429);
   const body=await response.text();assert.equal(body.includes('PRIVATE'),false);
   if(i===2){assert.equal(response.headers.get('retry-after'),'600');assert.equal(response.headers.get('cache-control'),'no-store');}
  }
  assert.equal((await fetch(url+'/api/health')).status,200);
  assert.notEqual((await fetch(url+'/api/orders/session')).status,429);
  // A different transport peer is not blocked by the exhausted first peer.
  const secondStatus=await new Promise((resolve,reject)=>{
   const request=http.request(url+'/api/orders',{method:'POST',localAddress:'127.0.0.2',headers:{'content-type':'application/json'}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});
   request.on('error',reject);request.end('{');
  });
  assert.equal(secondStatus,400);
 }finally{await new Promise(r=>server.close(r));}
});
