import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import mongoose from 'mongoose';
import {createApp} from '../src/app.js';
import {AdminAccount,AdminSession,AdminProxyNonce,CrmNote,Customer,Order,ShopReturn,ShopSale} from '../src/models/index.js';
const uri=process.env.ADMIN_CRM_TEST_MONGO,hash=value=>createHash('sha256').update(value).digest('hex');

test('CRM protects customer search, aggregates orders and sales, shows returns and stores notes',{skip:!uri,timeout:60000},async()=>{
 const u=new URL(uri);assert.equal(u.protocol,'mongodb:');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'27029');assert.match(u.pathname,/^\/aisha_admin_crm_test_[a-z0-9]+$/);assert.equal(u.search,'?replicaSet=aishaOrdersTest');
 await mongoose.connect(uri,{serverSelectionTimeoutMS:10000});assert.equal((await mongoose.connection.db.listCollections().toArray()).length,0,'Synthetic database must be empty');
 await Promise.all([AdminAccount.init(),AdminSession.init(),AdminProxyNonce.init(),CrmNote.init(),Customer.init(),Order.init(),ShopReturn.init(),ShopSale.init()]);
 const account=await AdminAccount.create({singleton:'primary',username:'synthetic',passwordHash:'unused',role:'admin'}),raw=randomBytes(32).toString('hex');await AdminSession.create({tokenHash:hash(raw),accountId:account._id,expiresAt:new Date(Date.now()+3600000)});
 const customer=await Customer.create({name:'Synthetic CRM Buyer',phone:'+998901234567',phoneKey:'998901234567'}),sale=await ShopSale.create({requestId:randomUUID(),requestHash:hash('sale'),customerId:customer._id,customerSnapshot:{name:customer.name,phone:customer.phone},paymentMethod:'cash',items:[{variantId:new mongoose.Types.ObjectId(),name:'Towel',sku:'CRM-1',color:'Oq',size:'M',quantity:1,unitPrice:200,unitCost:80}],subtotal:200,discount:0,total:200,totalCost:80});
  await ShopReturn.create({requestId:randomUUID(),requestHash:hash('return'),shopSaleId:sale._id,customerId:customer._id,customerSnapshot:sale.customerSnapshot,reason:'Synthetic reason',returnedAt:new Date(),items:[{variantId:sale.items[0].variantId,name:'Towel',sku:'CRM-1',color:'Oq',size:'M',quantity:1,condition:'damaged',unitPrice:200,unitCost:80,refundAmount:20}],refundTotal:20});
  const orderDoc=fields=>({ownerHash:hash(randomUUID()),requestId:randomUUID(),requestHash:hash(randomUUID()),customerId:customer._id,customerSnapshot:{name:customer.name,phone:customer.phone},status:'Yakunlangan',items:[{variantId:new mongoose.Types.ObjectId(),name:'Online towel',color:'Bej',size:'L',price:300,quantity:1}],subtotal:300,total:300,inventoryReserved:true,paid:false,...fields});
  await Order.create(orderDoc({}));await Order.create(orderDoc({status:'Bekor qilingan',total:999,subtotal:999}));await CrmNote.create({customerId:customer._id,text:'Synthetic prior note'});
  const origin='https://admin.example',secret=randomBytes(32).toString('hex'),cookie='aisha_admin_session='+raw,server=createApp({NODE_ENV:'production',CORS_ALLOWED_ORIGINS:origin,ADMIN_PROXY_SECRET:secret}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  function req(path,{method='GET',body,withCookie=true}={}){const payload=body?JSON.stringify(body):'',ts=String(Date.now()),nonce=randomBytes(16).toString('hex'),ip='192.0.2.89',c=withCookie?cookie:'';const signedPath=path.split('?')[0],signature=createHmac('sha256',Buffer.from(secret,'hex')).update([ts,nonce,ip,method,'/api/admin'+signedPath,origin,hash(c),hash(payload)].join('\n')).digest('hex');return fetch(base+'/api/admin'+path,{method,headers:{Origin:origin,'X-Admin-Request':'1','X-Admin-Proxy-Time':ts,'X-Admin-Proxy-Nonce':nonce,'X-Admin-Proxy-IP':ip,'X-Admin-Proxy-Signature':signature,...(c?{Cookie:c}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:payload}:{})})}
  try{
   assert.equal((await req('/customers',{withCookie:false})).status,401);
   let response=await req('/customers?q=901234567');assert.equal(response.status,200);let listing=await response.json();assert.equal(listing.customers.length,1);assert.equal(listing.customers[0].salesCount,1);assert.equal(listing.customers[0].ordersCount,1);assert.equal(listing.customers[0].totalPurchases,500);assert.equal(listing.customers[0].totalReturns,20);
   assert.equal((await req('/customers?q=Synthetic%20CRM%20Buyer')).status,200);assert.equal((await req('/customers?q='+encodeURIComponent('x'.repeat(101)))).status,400);
   response=await req('/customers/'+customer._id);assert.equal(response.status,200);const profile=await response.json();assert.equal(profile.customer._id.toString(),customer._id.toString());assert.equal(profile.purchases.length,3);assert.ok(profile.purchases.some(item=>item.type==='online_order'));assert.ok(profile.purchases.some(item=>item.type==='physical_sale'));assert.equal(profile.totalPurchases,500);assert.equal(profile.returns.length,1);assert.equal(profile.notes.length,1);assert.equal('ownerHash' in profile.purchases[0],false);
   response=await req('/customers/'+customer._id+'/notes',{method:'POST',body:{text:'New synthetic note'}});assert.equal(response.status,201);assert.equal((await CrmNote.countDocuments({customerId:customer._id})),2);
   response=await req('/customers/'+customer._id+'/notes',{method:'POST',body:{text:'x'.repeat(2001)}});assert.equal(response.status,400);
  }finally{await new Promise(r=>server.close(r));await mongoose.connection.dropDatabase();await mongoose.disconnect()}
});
