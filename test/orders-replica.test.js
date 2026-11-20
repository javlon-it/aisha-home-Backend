import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {randomUUID} from 'node:crypto';
import dns from 'node:dns';
import 'dotenv/config';
import {createApp} from '../src/app.js';
import {Product,Variant,Order,Customer} from '../src/models/index.js';

test('real replica-set transaction, idempotency, inventory and customer isolation', {skip:process.env.ORDER_REPLICA_TEST!=='1'}, async t=>{
 const db='aisha_order_test_'+Date.now()+'_'+Math.floor(Math.random()*1000000);
 if(process.env.ATLAS_TEST==='1'){
  if(!process.env.MONGODB_URI?.startsWith('mongodb+srv://'))throw Error('Atlas test URI required');
  if(process.env.MONGODB_DNS_SERVERS)dns.setServers(process.env.MONGODB_DNS_SERVERS.split(',').map(x=>x.trim()).filter(Boolean));
  await mongoose.connect(process.env.MONGODB_URI,{dbName:db,serverSelectionTimeoutMS:10000});
 }else await mongoose.connect('mongodb://127.0.0.1:27029/'+db+'?replicaSet=aishaOrdersTest',{serverSelectionTimeoutMS:5000});
 assert.equal(mongoose.connection.name,db);
 assert.match(db,/^aisha_order_test_/);
 assert.notEqual(db,process.env.MONGODB_DB_NAME);
 await Order.init();await Variant.init();
 const p=await Product.create({name:'Synthetic towel',category:'Test',archived:false});
 const v=await Variant.create({productId:p._id,sku:'test-'+randomUUID(),color:'Oq',size:'50x90',price:39000,stock:2});
 const server=createApp({CORS_ALLOWED_ORIGINS:'http://127.0.0.1:5173'}).listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port+'/api';
 try{
  const list=await (await fetch(base+'/catalog')).json(); const detail=await (await fetch(base+'/catalog/'+p._id)).json(); for(const product of [list.products[0],detail.product]){assert.equal(product.variants[0].isAvailable,true);assert.equal('stock' in product.variants[0],false)}
  const session=await fetch(base+'/orders/session');const cookie=session.headers.get('set-cookie').split(';')[0];
  assert.match(session.headers.get('set-cookie'),/HttpOnly/);assert.match(session.headers.get('set-cookie'),/SameSite=Strict/);assert.doesNotMatch(session.headers.get('set-cookie'),/; Secure/);
  const prodServer=createApp({NODE_ENV:'production',CORS_ALLOWED_ORIGINS:'https://shop.example'}).listen(0,'127.0.0.1');await new Promise(resolve=>prodServer.once('listening',resolve));
  try{const response=await fetch('http://127.0.0.1:'+prodServer.address().port+'/api/orders/session',{headers:{Origin:'https://shop.example'}});const header=response.headers.get('set-cookie');assert.match(header,/HttpOnly/);assert.match(header,/; Secure/);assert.match(header,/SameSite=None/);assert.equal(response.headers.get('access-control-allow-credentials'),'true');}finally{await new Promise(resolve=>prodServer.close(resolve));}
  const body={name:'Demo User',phone:'+998901234567',method:'pickup',consent:true,items:[{variantId:String(v._id),expectedPrice:39000,quantity:1}]};
  const request=(payload,key,c=cookie)=>fetch(base+'/orders',{method:'POST',headers:{'content-type':'application/json','idempotency-key':key,cookie:c},body:JSON.stringify(payload)});
  const stale=await request({...body,items:[{variantId:String(v._id),quantity:1,expectedPrice:1}]},randomUUID());assert.equal(stale.status,409);assert.equal((await stale.json()).error.code,'PRICE_CHANGED');assert.equal((await Variant.findById(v._id)).stock,2);
  const key=randomUUID();const [a,b]=await Promise.all([request(body,key),request(body,key)]);
  assert.ok([200,201].includes(a.status));assert.ok([200,201].includes(b.status));const x=await a.json(),y=await b.json();assert.equal(x.orderId,y.orderId);
  assert.equal((await Variant.findById(v._id)).stock,1);assert.equal(await Order.countDocuments(),1);assert.equal(await Customer.countDocuments(),1);assert.ok((await Order.findById(x.orderId)).customerId);
  const conflict=await request({...body,name:'Other User'},key);assert.equal(conflict.status,409);
  const other=await fetch(base+'/orders/'+x.orderId);assert.equal(other.status,404);
  const mine=await fetch(base+'/orders/'+x.orderId,{headers:{cookie}});assert.equal(mine.status,200);const saved=(await mine.json()).order;assert.equal(saved.total,39000);assert.equal(saved.shippingSnapshot.fee,0);
  const secondCookie=(await fetch(base+'/orders/session')).headers.get('set-cookie').split(';')[0];assert.equal((await fetch(base+'/orders/'+x.orderId,{headers:{cookie:secondCookie}})).status,404);
  const [c,d]=await Promise.all([request(body,randomUUID()),request(body,randomUUID(),secondCookie)]);assert.deepEqual([c.status,d.status].sort(),[201,409]);assert.equal((await Variant.findById(v._id)).stock,0);
  const sold=await (await fetch(base+'/catalog/'+p._id)).json();assert.equal(sold.product.variants[0].isAvailable,false);assert.equal('stock' in sold.product.variants[0],false);
  const rollbackVariant=await Variant.create({productId:p._id,sku:'rollback-'+randomUUID(),color:'Test',size:'Test',price:100,stock:2});
  const rollback=await request({...body,items:[{variantId:String(rollbackVariant._id),expectedPrice:100,quantity:1},{variantId:String(v._id),expectedPrice:39000,quantity:1}]},randomUUID());assert.equal(rollback.status,409);const failure=await rollback.json();assert.equal(failure.error.code,'STOCK_UNAVAILABLE');assert.equal(JSON.stringify(failure).includes('stock'),false);assert.equal((await Variant.findById(rollbackVariant._id)).stock,2);assert.equal(await Order.countDocuments(),2);
  const invalid=await request({...body,items:[{variantId:String(v._id),expectedPrice:39000,quantity:-1}]},randomUUID());assert.equal(invalid.status,400);
  const fractional=await request({...body,items:[{variantId:String(v._id),expectedPrice:39000,quantity:1.5}]},randomUUID());assert.equal(fractional.status,400);
  const deliveryVariant=await Variant.create({productId:p._id,sku:'delivery-'+randomUUID(),color:'Bej',size:'70x140',price:89000,stock:1});
  const delivered=await request({...body,method:'delivery',address:'Demo manzil 123',items:[{variantId:String(deliveryVariant._id),expectedPrice:89000,quantity:1,price:1}]},randomUUID());assert.equal(delivered.status,201);const deliveryId=(await delivered.json()).orderId;const delivery=await Order.findById(deliveryId).lean();assert.equal(delivery.total,null);assert.equal(delivery.shippingSnapshot.fee,null);assert.equal(delivery.shippingSnapshot.feeConfirmed,false);assert.equal(delivery.items[0].price,89000);
  assert.equal(await Order.countDocuments(),3);
  // Real order + throttled retry use only this isolated synthetic database.
  assert.match(mongoose.connection.name,/^aisha_order_test_/);
  assert.notEqual(mongoose.connection.name,process.env.MONGODB_DB_NAME);
  const limitedServer=createApp({ORDER_RATE_LIMIT_MAX:1}).listen(0,'127.0.0.1');
  await new Promise(resolve=>limitedServer.once('listening',resolve));
  try{
   const limitedUrl='http://127.0.0.1:'+limitedServer.address().port+'/api/orders';
   const limitedBody={...body,items:[{variantId:String(rollbackVariant._id),expectedPrice:100,quantity:1}]};
   const limitedRequest=forwarded=>fetch(limitedUrl,{method:'POST',headers:{'content-type':'application/json','idempotency-key':randomUUID(),cookie,'x-forwarded-for':forwarded},body:JSON.stringify(limitedBody)});
   assert.equal((await limitedRequest('203.0.113.1')).status,201);
   const denied=await limitedRequest('203.0.113.2');assert.equal(denied.status,429);
   const deniedText=await denied.text();assert.equal(deniedText.includes(body.phone),false);assert.equal(deniedText.includes(body.name),false);
   assert.equal(await Order.countDocuments(),4);assert.equal((await Variant.findById(rollbackVariant._id)).stock,1);
  }finally{await new Promise(resolve=>limitedServer.close(resolve));}
  const discountedProduct=await Product.create({name:'Discounted synthetic towel',category:'Test',discountPercent:15});
  const discountedVariant=await Variant.create({productId:discountedProduct._id,sku:'discount-'+randomUUID(),color:'Oq',size:'50x90',price:1001,stock:3});
  for(const product of [(await (await fetch(base+'/catalog')).json()).products.find(item=>item.id===String(discountedProduct._id)),(await (await fetch(base+'/catalog/'+discountedProduct._id)).json()).product]){
   assert.equal(product.discountPercent,15);assert.equal(product.variants[0].price,1001);assert.equal(product.variants[0].discountAmount,150);assert.equal(product.variants[0].finalPrice,851);assert.equal('stock' in product.variants[0],false);
  }
  const discountBody={...body,phone:'+998901234568',items:[{variantId:String(discountedVariant._id),expectedPrice:1001,expectedDiscountPercent:15,quantity:2}]};
  const staleDiscount=await request({...discountBody,items:[{...discountBody.items[0],expectedDiscountPercent:10}]},randomUUID());assert.equal(staleDiscount.status,409);assert.equal((await Variant.findById(discountedVariant._id)).stock,3);
  const discountedResponse=await request(discountBody,randomUUID());assert.equal(discountedResponse.status,201);const discountedOrder=await Order.findById((await discountedResponse.json()).orderId).lean();
  assert.equal(discountedOrder.originalSubtotal,2002);assert.equal(discountedOrder.discountTotal,300);assert.equal(discountedOrder.subtotal,1702);assert.equal(discountedOrder.total,1702);
  assert.deepEqual({originalPrice:discountedOrder.items[0].originalPrice,discountPercent:discountedOrder.items[0].discountPercent,discountAmount:discountedOrder.items[0].discountAmount,price:discountedOrder.items[0].price},{originalPrice:1001,discountPercent:15,discountAmount:150,price:851});
  assert.equal((await Variant.findById(discountedVariant._id)).stock,1);
  assert.equal((await fetch(base+'/health/ready')).status,200);
  await mongoose.disconnect();
  assert.equal((await fetch(base+'/health/live')).status,200);
  assert.equal((await fetch(base+'/health/ready')).status,503);
  assert.equal((await fetch(base+'/catalog')).status,503);
  assert.equal((await fetch(base+'/catalog/'+p._id)).status,503);
  if(process.env.ATLAS_TEST==='1')await mongoose.connect(process.env.MONGODB_URI,{dbName:db,serverSelectionTimeoutMS:10000});
  else await mongoose.connect('mongodb://127.0.0.1:27029/'+db+'?replicaSet=aishaOrdersTest',{serverSelectionTimeoutMS:5000});
  assert.equal((await fetch(base+'/health/ready')).status,200);
  assert.equal((await fetch(base+'/catalog')).status,200);
  assert.equal((await fetch(base+'/catalog/'+p._id)).status,200);
 }finally{await new Promise(resolve=>server.close(resolve));await mongoose.disconnect()}
});
