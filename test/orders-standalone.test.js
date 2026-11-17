import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/app.js';
import {Product,Variant,Order} from '../src/models/index.js';
test('standalone MongoDB refuses checkout without changing stock',{skip:process.env.ORDER_STANDALONE_TEST!=='1'},async()=>{
 await mongoose.connect('mongodb://127.0.0.1:27028/aisha_order_standalone_test_'+Date.now(),{serverSelectionTimeoutMS:5000});
 await Order.init();await Variant.init();
 const p=await Product.create({name:'Synthetic product',archived:false});
 const v=await Variant.create({productId:p._id,sku:randomUUID(),color:'Oq',size:'Test',price:100,stock:1});
 const server=createApp().listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const base='http://127.0.0.1:'+server.address().port+'/api/orders';const session=await fetch(base+'/session');const cookie=session.headers.get('set-cookie').split(';')[0];const response=await fetch(base,{method:'POST',headers:{cookie,'content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify({name:'Demo User',phone:'+998901234567',method:'pickup',consent:true,items:[{variantId:String(v._id),expectedPrice:100,quantity:1}]})});assert.equal(response.status,503);assert.equal((await response.json()).error.code,'TRANSACTIONS_UNAVAILABLE');assert.equal((await Variant.findById(v._id)).stock,1);assert.equal(await Order.countDocuments(),0)}finally{await new Promise(r=>server.close(r));await mongoose.disconnect()}
});