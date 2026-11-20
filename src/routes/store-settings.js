import {Router} from 'express';
import mongoose from 'mongoose';
import {Branch,Shipping} from '../models/index.js';
import {settingFields} from './admin-settings.js';

export const storeSettingsRouter=Router();

export const publicSettingsView=(kind,doc)=>Object.fromEntries(Object.keys(settingFields[kind]).map(key=>[key,typeof doc?.[key]==='string'?doc[key]:'']));

storeSettingsRouter.use((req,res,next)=>mongoose.connection.readyState===1?next():res.status(503).json({error:{code:'DATABASE_UNAVAILABLE',message:'Do‘kon ma’lumotlari vaqtincha mavjud emas.'}}));

storeSettingsRouter.get('/',async(req,res,next)=>{try{
 const [branches,shippingRows]=await Promise.all([Branch.find().limit(2).lean(),Shipping.find().limit(2).lean()]);
 if(branches.length>1||shippingRows.length>1)return res.status(409).json({error:{code:'MULTIPLE_SETTINGS',message:'Do‘kon ma’lumotlarini tekshirish kerak.'}});
 res.set('Cache-Control','no-store').json({branch:publicSettingsView('branch',branches[0]),shipping:publicSettingsView('shipping',shippingRows[0])});
}catch(error){next(error)}});
