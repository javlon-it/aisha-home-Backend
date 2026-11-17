import express from 'express';
import cors from 'cors';
import {healthRouter} from './routes/health.js';
import {catalogRouter} from './routes/catalog.js';
import {ordersRouter} from './routes/orders.js';
import {errorHandler,notFound} from './middlewares/errors.js';
import {createOrderRateLimit} from './middlewares/order-rate-limit.js';
export function allowedOrigins(env=process.env){
 const raw=env.CORS_ALLOWED_ORIGINS ?? (env.NODE_ENV==='production'?'':'http://127.0.0.1:5173,http://localhost:5173');
 return raw.split(',').map(x=>x.trim()).filter(Boolean).map(value=>{let url;try{url=new URL(value)}catch{throw new Error('CORS_ALLOWED_ORIGINS noto‘g‘ri')}if(!['http:','https:'].includes(url.protocol)||(env.NODE_ENV==='production'&&url.protocol!=='https:')||value!==url.origin||url.username||url.password||value==='*')throw new Error('CORS_ALLOWED_ORIGINS faqat aniq originlardan iborat bo‘lsin');return value});
}
export function createApp(env=process.env){
 const app=express(),origins=new Set(allowedOrigins(env));app.disable('x-powered-by');
 app.locals.production=env.NODE_ENV==='production';
 app.set('trust proxy',false);
 app.use((req,res,next)=>{const origin=req.get('Origin');if(origin&&!origins.has(origin))return res.status(403).json({error:{code:'CORS_ORIGIN_DENIED',message:'Origin ruxsat etilmagan'}});next()});
 app.use(cors({origin:(origin,done)=>done(null,!!origin&&origins.has(origin)),credentials:true}));
 app.use((req,res,next)=>{if(app.locals.production&&req.method==='POST'&&req.path.replace(/\/$/,'').toLowerCase()==='/api/orders'&&!origins.has(req.get('Origin')))return res.status(403).json({error:{code:'ORIGIN_REQUIRED',message:'So‘rov manbasi ruxsat etilmagan.'}});next()});
 app.post('/api/orders',createOrderRateLimit(env));
 app.use(express.json({limit:'64kb'}));app.use('/api/health',healthRouter);app.use('/api/catalog',catalogRouter);app.use('/api/orders',ordersRouter);app.use(notFound);app.use(errorHandler);return app;
}
