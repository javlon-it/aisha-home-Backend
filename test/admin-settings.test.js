import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {randomBytes,createHash} from 'node:crypto';
import {createApp} from '../src/app.js';
import {AdminAccount,AdminSession,Shipping,Branch} from '../src/models/index.js';
import {cleanSettings} from '../src/routes/admin-settings.js';
test('settings reject fee changes and invalid fields',()=>{
 assert.throws(()=>cleanSettings('shipping',{revision:0,deliveryArea:'',terms:'',fee:0}));
 assert.deepEqual(cleanSettings('shipping',{revision:0,deliveryArea:' Test ',terms:''}),{deliveryArea:'Test',terms:''});
});
test('synthetic settings persist, require admin and prevent stale writes',{skip:process.env.SETTINGS_LOCAL_TEST!=='1'},async()=>{
 await mongoose.connect('mongodb://127.0.0.1:27028/aisha_settings_synthetic_'+Date.now(),{serverSelectionTimeoutMS:5000});
 const raw=randomBytes(32).toString('hex'),account=await AdminAccount.create({singleton:'primary',username:'synthetic',passwordHash:'unused',role:'admin'});
 await AdminSession.create({tokenHash:createHash('sha256').update(raw).digest('hex'),accountId:account._id,expiresAt:new Date(Date.now()+60000)});
 const origin='http://127.0.0.1:5173',server=createApp({CORS_ALLOWED_ORIGINS:origin}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+server.address().port+'/api/admin/settings/';
 const req=(kind,body)=>fetch(url+kind,{method:body?'PATCH':'GET',headers:{Cookie:'aisha_admin_session='+raw,Origin:origin,'X-Admin-Request':'1','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal((await fetch(url+'branch')).status,401);
  const empty=(await (await req('branch')).json()).settings;assert.equal(empty.address,'');
  assert.equal((await req('branch',{...empty,address:'Synthetic address',pickupAddress:'Synthetic pickup'})).status,200);
  assert.equal((await Branch.findOne()).pickupAddress,'Synthetic pickup');assert.equal((await req('branch',empty)).status,409);
  await Shipping.create({regions:[{name:'Legacy',fee:123}],freeThreshold:456,__v:0});
  assert.equal((await req('shipping',{revision:0,deliveryArea:'Synthetic region',terms:'By agreement'})).status,200);
  const saved=await Shipping.findOne();assert.equal(saved.regions[0].fee,123);assert.equal(saved.freeThreshold,456);assert.equal(saved.terms,'By agreement');
 }finally{await new Promise(r=>server.close(r));await mongoose.connection.dropDatabase();await mongoose.disconnect()}
});
