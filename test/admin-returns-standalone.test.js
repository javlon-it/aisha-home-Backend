import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import mongoose from 'mongoose';
import {createApp} from '../src/app.js';
import {AdminAccount,AdminSession,AdminProxyNonce,Customer,ShopReturn,ShopSale,Variant} from '../src/models/index.js';
const uri=process.env.ADMIN_RETURN_STANDALONE_MONGO,hash=value=>createHash('sha256').update(value).digest('hex');

test('standalone database rejects product return without stock or history writes',{skip:!uri,timeout:30000},async()=>{
 const u=new URL(uri);assert.equal(u.protocol,'mongodb:');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'27028');assert.match(u.pathname,/^\/aisha_admin_return_standalone_[a-z0-9]+$/);assert.equal(u.search,'');
 await mongoose.connect(uri,{serverSelectionTimeoutMS:5000});assert.equal((await mongoose.connection.db.listCollections().toArray()).length,0);
 await Promise.all([AdminAccount.init(),AdminSession.init(),AdminProxyNonce.init(),Customer.init(),ShopReturn.init(),ShopSale.init(),Variant.init()]);
 const account=await AdminAccount.create({singleton:'primary',username:'synthetic',passwordHash:'unused',role:'admin'}),raw=randomBytes(32).toString('hex');await AdminSession.create({tokenHash:hash(raw),accountId:account._id,expiresAt:new Date(Date.now()+3600000)});
 const customer=await Customer.create({name:'Synthetic',phone:'+998901234567',phoneKey:'998901234567'}),variant=await Variant.create({productId:new mongoose.Types.ObjectId(),sku:'RETURN-STANDALONE',color:'Oq',size:'M',price:100,stock:4,averageCost:50}),sale=await ShopSale.create({requestId:randomUUID(),requestHash:hash('sale'),customerId:customer._id,customerSnapshot:{name:customer.name,phone:customer.phone},paymentMethod:'cash',items:[{variantId:variant._id,name:'Synthetic',sku:variant.sku,color:variant.color,size:variant.size,quantity:2,unitPrice:100,unitCost:50}],subtotal:200,discount:0,total:200,totalCost:100});
 const origin='https://admin.example',secret=randomBytes(32).toString('hex'),server=createApp({NODE_ENV:'production',CORS_ALLOWED_ORIGINS:origin,ADMIN_PROXY_SECRET:secret}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const path='/api/admin/sales/'+sale._id+'/returns',payload=JSON.stringify({reason:'Synthetic',items:[{saleItemIndex:0,quantity:1,condition:'sellable'}]}),ts=String(Date.now()),nonce=randomBytes(16).toString('hex'),ip='192.0.2.2',cookie='aisha_admin_session='+raw,signature=createHmac('sha256',Buffer.from(secret,'hex')).update([ts,nonce,ip,'POST',path,origin,hash(cookie),hash(payload)].join('\n')).digest('hex'),response=await fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','Idempotency-Key':randomUUID(),'X-Admin-Request':'1','X-Admin-Proxy-Time':ts,'X-Admin-Proxy-Nonce':nonce,'X-Admin-Proxy-IP':ip,'X-Admin-Proxy-Signature':signature},body:payload});assert.equal(response.status,503);assert.equal((await response.json()).error.code,'TRANSACTIONS_UNAVAILABLE');assert.equal((await Variant.findById(variant._id)).stock,4);assert.equal((await ShopSale.findById(sale._id)).items[0].returnedQuantity||0,0);assert.equal(await ShopReturn.countDocuments(),0)}finally{await new Promise(r=>server.close(r));await mongoose.connection.dropDatabase();await mongoose.disconnect()}
});
