import {Router} from 'express';
import {Branch,Shipping} from '../models/index.js';
export const adminSettingsRouter=Router();
export const settingFields={branch:{name:120,address:500,phone:40,email:120,hours:200,pickupAddress:500},shipping:{deliveryArea:2000,terms:3000}};
export function cleanSettings(kind,body){
 const fields=settingFields[kind];
 if(!body||!Number.isSafeInteger(body.revision)||body.revision<0||Object.keys(body).some(k=>k!=='revision'&&!Object.hasOwn(fields,k)))throw Error('INVALID_SETTINGS');
 const values={};for(const [key,max] of Object.entries(fields)){if(typeof body[key]!=='string'||body[key].length>max)throw Error('INVALID_SETTINGS');values[key]=body[key].trim();}
 if(values.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))throw Error('INVALID_SETTINGS');
 return values;
}
for(const [kind,Model] of Object.entries({branch:Branch,shipping:Shipping})){
 const view=doc=>({...Object.fromEntries(Object.keys(settingFields[kind]).map(k=>[k,doc?.[k]||''])),revision:doc?.__v??0});
 adminSettingsRouter.route('/settings/'+kind).get(async(req,res,next)=>{try{const rows=await Model.find().limit(2).lean();if(rows.length>1)return res.status(409).json({error:{code:'MULTIPLE_SETTINGS',message:'Bir nechta yozuv mavjud. Avval ularni tekshirish kerak.'}});res.json({settings:view(rows[0])});}catch(e){next(e)}}).patch(async(req,res,next)=>{try{
  let values;try{values=cleanSettings(kind,req.body)}catch{return res.status(400).json({error:{code:'INVALID_SETTINGS',message:'Maydonlarni tekshiring.'}})}
  const rows=await Model.find().limit(2).lean();if(rows.length>1)return res.status(409).json({error:{code:'MULTIPLE_SETTINGS',message:'Bir nechta yozuv mavjud.'}});
  let saved;
  if(rows.length){saved=await Model.findOneAndUpdate({_id:rows[0]._id,__v:req.body.revision},{$set:values,$inc:{__v:1}},{new:true,runValidators:true}).lean();}
  else if(req.body.revision===0){try{saved=await Model.findOneAndUpdate({_id:kind==='branch'?'000000000000000000000001':'000000000000000000000002',__v:-1},{$set:{...values,__v:1}},{upsert:true,new:true,runValidators:true});}catch(e){if(e.code!==11000)throw e}}
  if(!saved)return res.status(409).json({error:{code:'SETTINGS_CHANGED',message:'Sozlamalar o‘zgargan. Sahifani yangilang.'}});
  res.json({settings:view(saved)});
 }catch(e){next(e)}});
}
