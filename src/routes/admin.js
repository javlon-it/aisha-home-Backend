import {Router} from 'express';
import {randomBytes,createHash,createHmac,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {isIP} from 'node:net';
import mongoose from 'mongoose';
import {AdminAccount,AdminSession,AdminLoginLimit,AdminProxyNonce} from '../models/index.js';
import {adminProductsRouter} from './admin-products.js';
import {adminOrdersRouter} from './admin-orders.js';

const scrypt=promisify(scryptCallback);
const hash=value=>createHash('sha256').update(value).digest('hex');
const params={N:131072,r:8,p:1,maxmem:160*1024*1024};
// Only one expensive derivation at a time per Node process. No unbounded queue.
let hashing=false;
async function derive(password,salt){return scrypt(password,salt,64,params)}
export async function hashPassword(password){
 const salt=randomBytes(16).toString('hex');
 const key=await derive(password,salt);
 return `scrypt$131072$8$1$${salt}$${key.toString('hex')}`;
}
async function verify(password,encoded){
 const parts=(encoded||'').split('$');
 const valid=parts.length===6&&parts[0]==='scrypt'&&parts[1]==='131072'&&parts[2]==='8'&&parts[3]==='1'&&/^[a-f0-9]{32}$/.test(parts[4])&&/^[a-f0-9]{128}$/.test(parts[5]);
 const salt=valid?parts[4]:'0'.repeat(32), expected=Buffer.from(valid?parts[5]:'0'.repeat(128),'hex');
 const derived=await derive(password,salt);
 return valid&&timingSafeEqual(derived,expected);
}
const fail=(res,status,code,message)=>res.status(status).json({error:{code,message}});
const token=req=>{const value=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('aisha_admin_session='))?.slice('aisha_admin_session='.length);return /^[a-f0-9]{64}$/.test(value||'')?value:null};
const normalizeIp=value=>{const ip=(value||'').startsWith('::ffff:')?value.slice(7):value;return isIP(ip)?ip.toLowerCase():null};

export function createAdminRouter({origins,production,env={}}){
 const r=Router(), cookie={httpOnly:true,secure:production,sameSite:'strict',path:'/api/admin'};
 r.use((req,res,next)=>{res.set('Cache-Control','no-store');if(mongoose.connection.readyState!==1)return fail(res,503,'DATABASE_UNAVAILABLE','Xizmat vaqtincha mavjud emas.');next()});
 // Production accepts only requests authenticated by the Vercel function. Direct Render calls fail closed.
 r.use(async(req,res,next)=>{try{
  if(!production){req.adminClientIp=normalizeIp(req.socket.remoteAddress);return req.adminClientIp?next():fail(res,403,'PROXY_REQUIRED','So‘rov tasdiqlanmadi.')}
  const secret=env.ADMIN_PROXY_SECRET||'', ts=req.get('X-Admin-Proxy-Time')||'', nonce=req.get('X-Admin-Proxy-Nonce')||'', ip=normalizeIp(req.get('X-Admin-Proxy-IP')),signature=req.get('X-Admin-Proxy-Signature')||'';
  if(!/^[a-f0-9]{64}$/i.test(secret)||!/^[0-9]{13}$/.test(ts)||Math.abs(Date.now()-Number(ts))>30000||!/^[a-f0-9]{32}$/.test(nonce)||!ip||!/^[a-f0-9]{64}$/.test(signature))return fail(res,403,'PROXY_REQUIRED','So‘rov tasdiqlanmadi.');
  const message=[ts,nonce,ip,req.method,req.originalUrl.split('?')[0],req.get('Origin')||'',hash(req.get('Cookie')||''),hash(req.adminRawBody||Buffer.alloc(0))].join('\n');
  const expected=createHmac('sha256',Buffer.from(secret,'hex')).update(message).digest();
  if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))return fail(res,403,'PROXY_REQUIRED','So‘rov tasdiqlanmadi.');
  await AdminProxyNonce.init();
  try{await AdminProxyNonce.create({nonce,expiresAt:new Date(Date.now()+90000)})}catch(e){if(e.code===11000)return fail(res,403,'PROXY_REPLAY','So‘rov takrorlandi.');throw e}
  req.adminClientIp=ip;next();
 }catch(e){next(e)}});
 r.use((req,res,next)=>{if(!['GET','HEAD','OPTIONS'].includes(req.method)&&(!origins.has(req.get('Origin'))||req.get('X-Admin-Request')!=='1'))return fail(res,403,'ORIGIN_DENIED','So‘rov manbasi ruxsat etilmagan.');next()});
 r.post('/login',async(req,res,next)=>{
  if(hashing){res.set('Retry-After','2');return fail(res,503,'AUTH_BUSY','Kirish band. Keyinroq urinib ko‘ring.')}
  hashing=true;
  let reserved=false,limitKey;
  try{
   await Promise.all([AdminLoginLimit.init(),AdminSession.init(),AdminAccount.init()]);
   const now=Date.now(),windowMs=15*60*1000,windowEnd=(Math.floor(now/windowMs)+1)*windowMs;
   // HMAC avoids persisting IP addresses; fixed window keys isolate concurrent updates.
   const keySecret=production?Buffer.from(env.ADMIN_PROXY_SECRET,'hex'):Buffer.from('local-test-only');
   limitKey=createHmac('sha256',keySecret).update(req.adminClientIp+'|'+windowEnd).digest('hex');
   let limit;
   try{limit=await AdminLoginLimit.findOneAndUpdate({key:limitKey,count:{$lt:5}},{$inc:{count:1},$setOnInsert:{resetAt:new Date(windowEnd+60000)}},{upsert:true,new:true})}
   catch(e){if(e.code!==11000)throw e;limit=await AdminLoginLimit.findOneAndUpdate({key:limitKey,count:{$lt:5}},{$inc:{count:1}},{new:true})}
   if(!limit){res.set('Retry-After',String(Math.max(1,Math.ceil((windowEnd-now)/1000))));return fail(res,429,'LOGIN_RATE_LIMITED','Urinishlar soni cheklangan. Keyinroq urinib ko‘ring.')}
   reserved=true;
   if(limit.count>2)await new Promise(resolve=>setTimeout(resolve,Math.min(1500,(limit.count-2)*400)));
   const username=typeof req.body?.username==='string'?req.body.username.trim():'',password=typeof req.body?.password==='string'?req.body.password:'';
   if(username.length>100||password.length>256)return fail(res,401,'INVALID_CREDENTIALS','Login yoki parol noto‘g‘ri.');
   const account=await AdminAccount.findOne({singleton:'primary'}).lean();
   const passwordOk=await verify(password,account?.passwordHash);
   if(!account||account.username!==username||!passwordOk)return fail(res,401,'INVALID_CREDENTIALS','Login yoki parol noto‘g‘ri.');
   // A successful attempt is not retained as a failure; atomic decrement preserves concurrent failures.
   await AdminLoginLimit.updateOne({key:limitKey,count:{$gt:0}},{$inc:{count:-1}});reserved=false;
   const raw=randomBytes(32).toString('hex'),expiresAt=new Date(Date.now()+8*60*60*1000);
   await AdminSession.create({tokenHash:hash(raw),accountId:account._id,expiresAt});res.cookie('aisha_admin_session',raw,{...cookie,expires:expiresAt});return res.json({authenticated:true,role:'admin',expiresAt});
  }catch(e){if(reserved&&limitKey)await AdminLoginLimit.updateOne({key:limitKey,count:{$gt:0}},{$inc:{count:-1}}).catch(()=>{});next(e)}
  finally{hashing=false}
 });
 r.use(async(req,res,next)=>{try{const raw=token(req);if(!raw)return fail(res,401,'UNAUTHENTICATED','Avval tizimga kiring.');const session=await AdminSession.findOne({tokenHash:hash(raw),expiresAt:{$gt:new Date()}}).lean();if(!session)return fail(res,401,'UNAUTHENTICATED','Sessiya tugagan yoki bekor qilingan.');const account=await AdminAccount.findById(session.accountId).lean();if(!account||account.role!=='admin')return fail(res,403,'FORBIDDEN','Ruxsat mavjud emas.');req.adminSession=session;next()}catch(e){next(e)}});
 r.get('/session',(req,res)=>res.json({authenticated:true,role:'admin',expiresAt:req.adminSession.expiresAt}));
 r.post('/logout',async(req,res,next)=>{try{await AdminSession.deleteOne({_id:req.adminSession._id});res.clearCookie('aisha_admin_session',cookie);res.json({authenticated:false})}catch(e){next(e)}});
 r.use(adminProductsRouter);
 r.use(adminOrdersRouter);
 return r;
}
