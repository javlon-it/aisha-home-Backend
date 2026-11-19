import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import mongoose from 'mongoose';
import {createApp} from '../src/app.js';
import {AdminAccount,AdminSession,AdminLoginLimit,AdminProxyNonce} from '../src/models/index.js';
import {hashPassword} from '../src/routes/admin.js';

test('synthetic admin cookie and logout invalidate the old session',async()=>{
 const username='synthetic',password='a7b8c9',secret=randomBytes(32).toString('hex'),origin='https://admin.example';
 const account={_id:'synthetic-id',username,role:'admin',passwordHash:await hashPassword(password)};
 let session=null;const seen=new Set(),originals=[];
 function stub(obj,key,value){originals.push([obj,key,obj[key]]);obj[key]=value}
 const state=Object.getOwnPropertyDescriptor(mongoose.connection,'readyState');
 Object.defineProperty(mongoose.connection,'readyState',{value:1,configurable:true});
 for(const model of [AdminAccount,AdminSession,AdminLoginLimit,AdminProxyNonce])stub(model,'init',async()=>{});
 stub(AdminAccount,'findOne',()=>({lean:async()=>account}));stub(AdminAccount,'findById',()=>({lean:async()=>account}));
 stub(AdminLoginLimit,'findOneAndUpdate',async()=>({count:1}));stub(AdminLoginLimit,'updateOne',async()=>({}));
 stub(AdminProxyNonce,'create',async({nonce})=>{if(seen.has(nonce))throw Object.assign(new Error('duplicate'),{code:11000});seen.add(nonce)});
 stub(AdminSession,'create',async value=>{session={...value,_id:'session-id'};return session});
 stub(AdminSession,'findOne',query=>({lean:async()=>session&&session.tokenHash===query.tokenHash&&session.expiresAt>new Date()?session:null}));
 stub(AdminSession,'deleteOne',async()=>{session=null});
 const server=createApp({NODE_ENV:'production',CORS_ALLOWED_ORIGINS:origin,ADMIN_PROXY_SECRET:secret}).listen(0,'127.0.0.1');
 await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const digest=x=>createHash('sha256').update(x).digest('hex');
 function options(path,{method='GET',cookie='',body}={}){const raw=body?JSON.stringify(body):'',ts=String(Date.now()),nonce=randomBytes(16).toString('hex'),ip='192.0.2.1';const msg=[ts,nonce,ip,method,path,origin,digest(cookie),digest(raw)].join('\n');const headers={Origin:origin,'X-Admin-Request':'1','X-Admin-Proxy-Time':ts,'X-Admin-Proxy-Nonce':nonce,'X-Admin-Proxy-IP':ip,'X-Admin-Proxy-Signature':createHmac('sha256',Buffer.from(secret,'hex')).update(msg).digest('hex')};if(cookie)headers.Cookie=cookie;if(body)headers['Content-Type']='application/json';return {method,headers,...(body?{body:raw}:{})}}
 try{
  const login=await fetch(base+'/api/admin/login',options('/api/admin/login',{method:'POST',body:{username,password}}));assert.equal(login.status,200);
  const header=login.headers.get('set-cookie');assert.match(header,/HttpOnly/i);assert.match(header,/Secure/i);assert.match(header,/SameSite=Strict/i);assert.match(header,/Path=\/api\/admin/i);assert.doesNotMatch(header,/;\s*Domain=/i);
  const cookie=header.split(';')[0];assert.equal((await fetch(base+'/api/admin/session',options('/api/admin/session',{cookie}))).status,200);
  assert.equal((await fetch(base+'/api/admin/session',options('/api/admin/session',{cookie}))).status,200);
  const logout=await fetch(base+'/api/admin/logout',options('/api/admin/logout',{method:'POST',cookie}));assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Expires=Thu, 01 Jan 1970/i);
  assert.equal((await fetch(base+'/api/admin/session',options('/api/admin/session',{cookie}))).status,401);
  assert.equal((await fetch(base+'/api/admin/session')).status,403);
 }finally{await new Promise(r=>server.close(r));for(const [obj,key,value] of originals)obj[key]=value;if(state)Object.defineProperty(mongoose.connection,'readyState',state);else delete mongoose.connection.readyState}
});
