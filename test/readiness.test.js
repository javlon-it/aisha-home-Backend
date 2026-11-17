import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {createApp} from '../src/app.js';
import {errorHandler} from '../src/middlewares/errors.js';

test('liveness, readiness and production order gate follow connection state',async()=>{
 const server=createApp({NODE_ENV:'production',CORS_ALLOWED_ORIGINS:'https://shop.example'}).listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 const original=Object.getOwnPropertyDescriptor(mongoose.connection,'readyState');
 try{
  for(const [state,status] of [[0,503],[1,200],[0,503],[1,200]]){
   Object.defineProperty(mongoose.connection,'readyState',{value:state,configurable:true});
   assert.equal((await fetch(base+'/api/health/live')).status,200);
   const ready=await fetch(base+'/api/health/ready');assert.equal(ready.status,status);assert.equal((await ready.json()).ready,state===1);
   const order=await fetch(base+'/api/orders/',{method:'POST',headers:{Origin:'https://shop.example'}});
   assert.equal(order.status,503);assert.equal((await order.json()).error.code,'ORDERS_DISABLED');
   const extraSlash=await fetch(base+'/api/orders//',{method:'POST',headers:{Origin:'https://shop.example','Content-Type':'application/json'},body:'{}'});
   assert.equal(extraSlash.status,503);assert.equal((await extraSlash.json()).error.code,'ORDERS_DISABLED');
  }
 }finally{if(original)Object.defineProperty(mongoose.connection,'readyState',original);else delete mongoose.connection.readyState;await new Promise(r=>server.close(r))}
});

test('database network errors do not reveal configuration',()=>{
 const err=Object.assign(new Error('secret connection string'),{name:'MongoServerSelectionError'});
 let status,body;const res={headersSent:false,status(n){status=n;return this},json(v){body=v;return this}};
 errorHandler(err,{},res,()=>{});assert.equal(status,503);assert.equal(body.error.code,'DATABASE_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(body),/secret/);
});
