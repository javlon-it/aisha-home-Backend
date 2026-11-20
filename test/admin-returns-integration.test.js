import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import mongoose from 'mongoose';
import {createApp} from '../src/app.js';
import {AdminAccount,AdminSession,AdminProxyNonce,Customer,Product,ShopReturn,ShopSale,Variant} from '../src/models/index.js';
const uri=process.env.ADMIN_RETURN_TEST_MONGO,hash=value=>createHash('sha256').update(value).digest('hex');

test('shop returns atomically refund actual net price, restock, preserve history and stop excess returns',{skip:!uri,timeout:120000},async()=>{
 const u=new URL(uri);assert.equal(u.protocol,'mongodb:');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'27029');assert.match(u.pathname,/^\/aisha_admin_return_test_[a-z0-9]+$/);assert.equal(u.search,'?replicaSet=aishaOrdersTest');
 await mongoose.connect(uri,{serverSelectionTimeoutMS:10000});assert.equal((await mongoose.connection.db.listCollections().toArray()).length,0,'Synthetic database must be empty');
 await Promise.all([AdminAccount.init(),AdminSession.init(),AdminProxyNonce.init(),Customer.init(),ShopSale.init(),ShopReturn.init(),Variant.init()]);
 const account=await AdminAccount.create({singleton:'primary',username:'synthetic',passwordHash:'unused',role:'admin'}),raw=randomBytes(32).toString('hex');await AdminSession.create({tokenHash:hash(raw),accountId:account._id,expiresAt:new Date(Date.now()+3600000)});
 const customer=await Customer.create({name:'Synthetic Return Buyer',phone:'+998901234567',phoneKey:'998901234567'}),product=await Product.create({name:'Synthetic Return Product',category:'Test'}),variant=await Variant.create({productId:product._id,sku:'RETURN-1',color:'Oq',size:'M',price:1500,stock:5,averageCost:400.125});
 const sale=await ShopSale.create({requestId:randomUUID(),requestHash:hash('sale'),customerId:customer._id,customerSnapshot:{name:customer.name,phone:customer.phone},paymentMethod:'cash',items:[{variantId:variant._id,name:product.name,sku:variant.sku,color:variant.color,size:variant.size,quantity:3,unitPrice:1000,unitCost:400.125}],subtotal:3000,discount:1,total:2999,totalCost:1200.375});
 await ShopSale.collection.updateOne({_id:sale._id},{$unset:{returnVersion:'',returnsTotal:'','items.0.returnedQuantity':'','items.0.returnedAmount':''}});
 const origin='https://admin.example',secret=randomBytes(32).toString('hex'),cookie='aisha_admin_session='+raw,server=createApp({NODE_ENV:'production',CORS_ALLOWED_ORIGINS:origin,ADMIN_PROXY_SECRET:secret}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 function req(path,{method='GET',body,key,withCookie=true}={}){const payload=body?JSON.stringify(body):'',ts=String(Date.now()),nonce=randomBytes(16).toString('hex'),ip='192.0.2.78',c=withCookie?cookie:'';const signature=createHmac('sha256',Buffer.from(secret,'hex')).update([ts,nonce,ip,method,path,origin,hash(c),hash(payload)].join('\n')).digest('hex');return fetch(base+path,{method,headers:{Origin:origin,'X-Admin-Request':'1','X-Admin-Proxy-Time':ts,'X-Admin-Proxy-Nonce':nonce,'X-Admin-Proxy-IP':ip,'X-Admin-Proxy-Signature':signature,...(c?{Cookie:c}:{}),...(key?{'Idempotency-Key':key}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:payload}:{})})}
 const path='/api/admin/sales/'+sale._id+'/returns',body=(quantity,condition='sellable',reason='Synthetic return')=>({reason,items:[{saleItemIndex:0,quantity,condition}]});
 try{
  assert.equal((await req('/api/admin/returns',{withCookie:false})).status,401);
  let key=randomUUID(),r=await req(path,{method:'POST',body:body(1),key});assert.equal(r.status,201);let result=await r.json();assert.equal(result.refundTotal,999);
  const first=await ShopReturn.findById(result.returnId).lean();assert.equal(first.customerId.toString(),customer._id.toString());assert.equal(first.items[0].unitPrice,1000);assert.equal(first.items[0].unitCost,400.125);assert.equal(first.items[0].condition,'sellable');assert.ok(first.returnedAt instanceof Date);
  r=await req(path,{method:'POST',body:body(1),key});assert.equal(r.status,200);const duplicate=await r.json();assert.equal(duplicate.returnId,result.returnId);assert.equal(duplicate.refundTotal,999);assert.equal((await Variant.findById(variant._id)).stock,6);assert.equal(await ShopReturn.countDocuments(),1);
  assert.equal((await req(path,{method:'POST',body:body(2),key})).status,409);
  r=await req(path,{method:'POST',body:body(1,'damaged'),key:randomUUID()});assert.equal(r.status,201);assert.equal((await r.json()).refundTotal,1000);assert.equal((await Variant.findById(variant._id)).stock,6);
  r=await req(path,{method:'POST',body:body(2),key:randomUUID()});assert.equal(r.status,409);assert.equal((await r.json()).error.code,'RETURN_LIMIT');
  const concurrentBody=body(1),two=await Promise.all([req(path,{method:'POST',body:concurrentBody,key:randomUUID()}),req(path,{method:'POST',body:concurrentBody,key:randomUUID()})]);assert.deepEqual(two.map(x=>x.status).sort(),[201,409]);assert.equal((await Variant.findById(variant._id)).stock,7);
  const stored=await ShopSale.findById(sale._id).lean();assert.equal(stored.total,2999);assert.equal(stored.totalCost,1200.375);assert.equal(stored.returnsTotal,2999);assert.equal(stored.items[0].returnedQuantity,3);assert.equal(stored.items[0].returnedAmount,2999);
  const history=await (await req('/api/admin/returns')).json();assert.equal(history.returns.length,3);assert.equal(history.returns.reduce((sum,x)=>sum+x.refundTotal,0),stored.total);assert.ok(history.returns.every(x=>String(x.customerId)===String(customer._id)));
  const publicOrder=await fetch(base+'/api/orders',{method:'POST',headers:{Origin:origin}});assert.equal(publicOrder.status,503);assert.equal((await publicOrder.json()).error.code,'ORDERS_DISABLED');
 }finally{await new Promise(r=>server.close(r));await mongoose.connection.dropDatabase();await mongoose.disconnect()}
});
