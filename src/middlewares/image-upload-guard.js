import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
import mongoose from 'mongoose';
import {AdminAccount,AdminSession} from '../models/index.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const deny=(res,status,code)=>res.status(status).json({error:{code,message:'Rasm yuklashga ruxsat berilmadi.'}});
export function imageUploadGuard(env,origins){return async(req,res,next)=>{
 if(req.method!=='PUT')return next();
 try{
  if(!origins.has(req.get('Origin'))||req.get('X-Admin-Request')!=='1')return deny(res,403,'ORIGIN_DENIED');
  if(mongoose.connection.readyState!==1)return deny(res,503,'DATABASE_UNAVAILABLE');
  if(env.NODE_ENV==='production'){
   const secret=env.ADMIN_PROXY_SECRET||'',ts=req.get('X-Admin-Proxy-Time')||'',nonce=req.get('X-Admin-Proxy-Nonce')||'',ip=(req.get('X-Admin-Proxy-IP')||'').toLowerCase(),signature=req.get('X-Admin-Proxy-Signature')||'',bodyHash=req.get('X-Admin-Body-Hash')||'';
   if(!/^[a-f0-9]{64}$/i.test(secret)||!/^[0-9]{13}$/.test(ts)||Math.abs(Date.now()-Number(ts))>30000||!/^[a-f0-9]{32}$/.test(nonce)||!isIP(ip)||!/^[a-f0-9]{64}$/.test(signature)||!/^[a-f0-9]{64}$/.test(bodyHash))return deny(res,403,'PROXY_REQUIRED');
   const message=[ts,nonce,ip,req.method,req.originalUrl.split('?')[0],req.get('Origin')||'',hash(req.get('Cookie')||''),bodyHash].join('\n');
   const expected=createHmac('sha256',Buffer.from(secret,'hex')).update(message).digest();
   if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))return deny(res,403,'PROXY_REQUIRED');
   req.imageExpectedHash=bodyHash;
  }
  const raw=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('aisha_admin_session='))?.slice('aisha_admin_session='.length);
  if(!/^[a-f0-9]{64}$/.test(raw||''))return deny(res,401,'UNAUTHENTICATED');
  const session=await AdminSession.findOne({tokenHash:hash(raw),expiresAt:{$gt:new Date()}}).lean();
  if(!session)return deny(res,401,'UNAUTHENTICATED');
  const account=await AdminAccount.findById(session.accountId).lean();if(!account||account.role!=='admin')return deny(res,403,'FORBIDDEN');
  next();
 }catch(e){next(e)}
}}
