import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import mongoose from 'mongoose';
import {createApp} from '../src/app.js';
import {AdminAccount,AdminSession,AdminLoginLimit,AdminProxyNonce} from '../src/models/index.js';
import {hashPassword} from '../src/routes/admin.js';
const uri=process.env.ADMIN_SYNTHETIC_MONGO;
const digest=value=>createHash('sha256').update(value).digest('hex');
test('admin security with isolated MongoDB and signed synthetic proxy',{skip:!uri,timeout:120000},async t=>{
 const baseline=process.memoryUsage().rss;let peak=baseline;const monitor=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().rss)},20);
 const parsed=new URL(uri);assert.equal(parsed.protocol,'mongodb:');assert.equal(parsed.hostname,'127.0.0.1');assert.match(parsed.pathname,/^\/aisha_admin_test_[a-z0-9]+$/);assert.equal(parsed.search,'');
 await mongoose.connect(uri,{serverSelectionTimeoutMS:5000});assert.equal((await mongoose.connection.db.listCollections().toArray()).length,0,'Synthetic database must be empty');
 await Promise.all([AdminAccount.init(),AdminSession.init(),AdminLoginLimit.init(),AdminProxyNonce.init()]);
 const username='synthetic-admin',password='a7b8c9',secret=randomBytes(32).toString('hex');
 const stored=await hashPassword(password);assert.match(stored,/^scrypt\$131072\$8\$1\$/);await AdminAccount.create({singleton:'primary',username,passwordHash:stored,role:'admin'});
 const origin='https://admin.example',server=createApp({NODE_ENV:'production',CORS_ALLOWED_ORIGINS:origin,ADMIN_PROXY_SECRET:secret}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 function signed(path,{method='GET',ip='192.0.2.1',cookie='',body,header=true,requestOrigin=origin,nonce=randomBytes(16).toString('hex'),forwarded}={}){
  const raw=body?JSON.stringify(body):'',ts=String(Date.now());const message=[ts,nonce,ip,method,path,requestOrigin,digest(cookie),digest(raw)].join('\n');
  const headers={'X-Admin-Proxy-Time':ts,'X-Admin-Proxy-Nonce':nonce,'X-Admin-Proxy-IP':ip,'X-Admin-Proxy-Signature':createHmac('sha256',Buffer.from(secret,'hex')).update(message).digest('hex'),Origin:requestOrigin};
  if(header)headers['X-Admin-Request']='1';if(cookie)headers.Cookie=cookie;if(body)headers['Content-Type']='application/json';if(forwarded){headers['X-Forwarded-For']=forwarded;headers['X-Real-IP']=forwarded}
  return {method,headers,...(body?{body:raw}:{})};
 }
 const req=(path,options)=>fetch(base+path,signed(path,options));
 try{
  const path='/api/admin/login';assert.equal((await fetch(base+path,{method:'POST',headers:{Origin:origin,'X-Admin-Request':'1','X-Forwarded-For':'192.0.2.8'}})).status,403);
  assert.equal((await req('/api/admin/session')).status,401);
  assert.equal((await req('/api/admin/session',{cookie:'aisha_demo_owner='+ 'a'.repeat(64)})).status,401);
  assert.equal((await req(path,{method:'POST',body:{username,password},header:false})).status,403);
  assert.equal((await req(path,{method:'POST',body:{username,password:'wrong'}})).status,401);
  let login=await req(path,{method:'POST',body:{username,password}});assert.equal(login.status,200);let cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/Secure/);assert.match(login.headers.get('set-cookie'),/SameSite=Strict/);
  assert.equal((await req('/api/admin/session',{cookie})).status,200);
  assert.equal((await req('/api/admin/logout',{method:'POST',cookie})).status,200);assert.equal((await req('/api/admin/session',{cookie})).status,401);
  login=await req(path,{method:'POST',body:{username,password}});cookie=login.headers.get('set-cookie').split(';')[0];await AdminSession.updateMany({},{$set:{expiresAt:new Date(Date.now()-1000)}});assert.equal((await req('/api/admin/session',{cookie})).status,401);
  await AdminLoginLimit.deleteMany({});
  for(let i=0;i<5;i++)assert.equal((await req(path,{method:'POST',body:{username,password:'wrong'},forwarded:'198.51.100.'+(i+1)})).status,401);
  assert.equal((await req(path,{method:'POST',body:{username,password},forwarded:'203.0.113.55'})).status,429);
  assert.equal((await req(path,{method:'POST',ip:'192.0.2.2',body:{username,password}})).status,200,'one IP must not block another');
  const records=await AdminLoginLimit.find({}).lean();assert.ok(records.some(x=>x.count===5));assert.ok(records.some(x=>x.count===0));assert.ok(records.every(x=>!x.key.includes('192.0.2')));
  const replay=signed('/api/admin/session');assert.equal((await fetch(base+'/api/admin/session',replay)).status,401);assert.equal((await fetch(base+'/api/admin/session',replay)).status,403);
  const forged=signed(path,{method:'POST',ip:'192.0.2.4',body:{username,password}});forged.headers['X-Admin-Proxy-IP']='192.0.2.5';assert.equal((await fetch(base+path,forged)).status,403);
  const concurrent=await Promise.all(Array.from({length:8},()=>req(path,{method:'POST',ip:'192.0.2.3',body:{username,password:'wrong'}})));
  const statuses=concurrent.map(x=>x.status);assert.ok(statuses.includes(401));assert.ok(statuses.every(x=>[401,503].includes(x)));assert.ok(statuses.filter(x=>x===401).length===1);
 }finally{clearInterval(monitor);t.diagnostic(`process RSS baseline ${(baseline/1048576).toFixed(1)} MiB, peak ${(peak/1048576).toFixed(1)} MiB`);await new Promise(r=>server.close(r));await mongoose.connection.dropDatabase();await mongoose.disconnect()}
});
