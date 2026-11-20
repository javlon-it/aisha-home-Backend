import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import mongoose from 'mongoose';
import {createApp} from '../src/app.js';
import {AdminAccount,AdminSession,AdminProxyNonce,Customer,Product,ShopSale,Variant} from '../src/models/index.js';
const uri=process.env.ADMIN_SALE_STANDALONE_MONGO,hash=value=>createHash('sha256').update(value).digest('hex');
test('standalone database refuses shop sale without changing stock or customers',{skip:!uri,timeout:30000},async()=>{
 const u=new URL(uri);assert.equal(u.protocol,'mongodb:');assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'27028');assert.match(u.pathname,/^\/aisha_admin_sale_standalone_[a-z0-9]+$/);assert.equal(u.search,'');
 await mongoose.connect(uri,{serverSelectionTimeoutMS:5000});assert.equal((await mongoose.connection.db.listCollections().toArray()).length,0);
 await Promise.all([AdminAccount.init(),AdminSession.init(),AdminProxyNonce.init(),Customer.init(),ShopSale.init(),Variant.init()]);
 const a=await AdminAccount.create({singleton:'primary',username:'synthetic',passwordHash:'unused',role:'admin'}),raw=randomBytes(32).toString('hex');await AdminSession.create({tokenHash:hash(raw),accountId:a._id,expiresAt:new Date(Date.now()+3600000)});
 const p=await Product.create({name:'Synthetic',category:'Test'}),v=await Variant.create({productId:p._id,sku:'STANDALONE',color:'Oq',size:'M',price:100,stock:2,averageCost:50});
 const origin='https://admin.example',secret=randomBytes(32).toString('hex'),server=createApp({NODE_ENV:'production',CORS_ALLOWED_ORIGINS:origin,ADMIN_PROXY_SECRET:secret}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const path='/api/admin/sales',body=JSON.stringify({name:'Synthetic',phone:'901234567',paymentMethod:'cash',discount:0,items:[{variantId:String(v._id),quantity:1,expectedPrice:100}]}),ts=String(Date.now()),nonce=randomBytes(16).toString('hex'),ip='192.0.2.1',cookie='aisha_admin_session='+raw,signature=createHmac('sha256',Buffer.from(secret,'hex')).update([ts,nonce,ip,'POST',path,origin,hash(cookie),hash(body)].join('\n')).digest('hex');const r=await fetch('http://127.0.0.1:'+server.address().port+path,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','Idempotency-Key':randomUUID(),'X-Admin-Request':'1','X-Admin-Proxy-Time':ts,'X-Admin-Proxy-Nonce':nonce,'X-Admin-Proxy-IP':ip,'X-Admin-Proxy-Signature':signature},body});assert.equal(r.status,503);assert.equal((await r.json()).error.code,'TRANSACTIONS_UNAVAILABLE');assert.equal((await Variant.findById(v._id)).stock,2);assert.equal(await ShopSale.countDocuments(),0);assert.equal(await Customer.countDocuments(),0)}finally{await new Promise(r=>server.close(r));await mongoose.connection.dropDatabase();await mongoose.disconnect()}
});
