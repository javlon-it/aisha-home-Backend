import {Router} from 'express';
import mongoose from 'mongoose';
import {createHash} from 'node:crypto';
import {Customer,Product,ShopSale,Variant} from '../models/index.js';

export const adminSalesRouter=Router();
const fail=(res,status,code,message)=>res.status(status).json({error:{code,message}});
const problem=code=>Object.assign(new Error(code),{saleCode:code});
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max?value.trim():null;
const id=value=>typeof value==='string'&&/^[a-f0-9]{24}$/i.test(value);
function normalizePhone(value){
 if(typeof value!=='string'||value.length>24||!/^\+?[0-9 ()-]+$/.test(value.trim()))return null;
 const digits=value.replace(/\D/g,'');if(digits.length<9||digits.length>15)return null;
 return digits.length===9?'998'+digits:digits;
}
function legacyPhonePattern(phoneKey){
 const local=phoneKey.startsWith('998')&&phoneKey.length===12, digits=local?phoneKey.slice(3):phoneKey, sep='[\\s()\\-]*';
 return new RegExp('^\\s*\\+?'+sep+(local?'(?:9'+sep+'9'+sep+'8'+sep+')?':'')+digits.split('').join(sep)+sep+'$');
}
function clean(body){
 const name=text(body?.name,100),phoneKey=normalizePhone(body?.phone),paymentMethod=body?.paymentMethod,discount=body?.discount;
 if(!name||!phoneKey||!['cash','card'].includes(paymentMethod)||!Number.isSafeInteger(discount)||discount<0||discount>1000000000||!Array.isArray(body?.items)||body.items.length<1||body.items.length>50)throw problem('INVALID_SALE');
 const seen=new Set(),items=body.items.map(item=>{const variantId=typeof item?.variantId==='string'?item.variantId.toLowerCase():'';if(!id(variantId)||seen.has(variantId)||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>1000000||!Number.isSafeInteger(item.expectedPrice)||item.expectedPrice<0||item.expectedPrice>1000000000)throw problem('INVALID_SALE');seen.add(variantId);return {variantId,quantity:item.quantity,expectedPrice:item.expectedPrice}});
 return {name,phone:'+'+phoneKey,phoneKey,paymentMethod,discount,items};
}

adminSalesRouter.get('/sales',async(req,res,next)=>{try{
 const sales=await ShopSale.find({}).sort({createdAt:-1,_id:-1}).limit(100).select('-requestId').lean();res.json({sales,limit:100});
}catch(e){next(e)}});

adminSalesRouter.post('/sales',async(req,res,next)=>{
 let data;try{data=clean(req.body)}catch{return fail(res,400,'INVALID_SALE','Savdo ma’lumotlarini tekshiring.');}
 const key=req.get('Idempotency-Key');if(!key||!/^[a-zA-Z0-9-]{16,100}$/.test(key))return fail(res,400,'IDEMPOTENCY_REQUIRED','Savdo kalitini tekshiring.');
 const requestHash=createHash('sha256').update(JSON.stringify(data)).digest('hex');
 try{
  await Promise.all([ShopSale.init(),Customer.init()]);
  for(let attempt=0;attempt<3;attempt++){
   const session=await mongoose.startSession();let result;
   try{
    await session.withTransaction(async()=>{
     const existing=await ShopSale.findOne({requestId:key}).select('+requestHash').session(session).lean();
     if(existing){if(existing.requestHash!==requestHash)throw problem('KEY_CONFLICT');result={id:String(existing._id),duplicate:true};return}
     let customer=await Customer.findOne({phoneKey:data.phoneKey}).session(session);
     if(!customer){
      const legacy=await Customer.find({phoneKey:{$exists:false},phone:legacyPhonePattern(data.phoneKey)}).limit(2).session(session);
      if(legacy.length>1)throw problem('CUSTOMER_AMBIGUOUS');
      if(legacy.length===1){customer=legacy[0];customer.phoneKey=data.phoneKey;await customer.save({session})}
      else [customer]=await Customer.create([{name:data.name,phone:data.phone,phoneKey:data.phoneKey}],{session});
     }
     let subtotal=0,totalCostScaled=0;const items=[];
     for(const item of data.items){
      const variant=await Variant.findById(item.variantId).session(session);if(!variant||!Number.isSafeInteger(variant.stock)||variant.stock<item.quantity)throw problem('STOCK_UNAVAILABLE');
      const product=await Product.findOne({_id:variant.productId,archived:{$ne:true}}).session(session);if(!product)throw problem('STOCK_UNAVAILABLE');
      if(variant.price!==item.expectedPrice)throw problem('PRICE_CHANGED');
      if(typeof variant.averageCost!=='number'||!Number.isFinite(variant.averageCost)||variant.averageCost<0)throw problem('COST_REQUIRED');
      const line=variant.price*item.quantity,unitCostScaled=Math.round(variant.averageCost*10000),costScaled=unitCostScaled*item.quantity;
      if(!Number.isSafeInteger(line)||!Number.isSafeInteger(subtotal+line)||!Number.isSafeInteger(unitCostScaled)||!Number.isSafeInteger(costScaled)||!Number.isSafeInteger(totalCostScaled+costScaled))throw problem('INVALID_SALE');
      const updated=await Variant.updateOne({_id:variant._id,stock:{$gte:item.quantity}},{$inc:{stock:-item.quantity}},{session});if(updated.modifiedCount!==1)throw problem('STOCK_UNAVAILABLE');
      subtotal+=line;totalCostScaled+=costScaled;items.push({variantId:variant._id,name:product.name,sku:variant.sku,color:variant.color,size:variant.size,quantity:item.quantity,unitPrice:variant.price,unitCost:unitCostScaled/10000});
     }
     if(data.discount>subtotal)throw problem('INVALID_DISCOUNT');
     [result]=await ShopSale.create([{requestId:key,requestHash,customerId:customer._id,customerSnapshot:{name:data.name,phone:data.phone},paymentMethod:data.paymentMethod,items,subtotal,discount:data.discount,total:subtotal-data.discount,totalCost:totalCostScaled/10000}],{session});
     result={id:String(result._id),duplicate:false};
    });
    return res.status(result.duplicate?200:201).json({saleId:result.id,duplicate:result.duplicate});
   }catch(e){
    if(e.code!==11000)throw e;
    const existing=await ShopSale.findOne({requestId:key}).select('+requestHash').lean();
    if(existing){if(existing.requestHash!==requestHash)throw problem('KEY_CONFLICT');return res.json({saleId:String(existing._id),duplicate:true})}
    if(attempt===2)throw problem('CONCURRENT_RETRY');
    await new Promise(resolve=>setTimeout(resolve,30*(attempt+1)));
   }finally{await session.endSession()}
  }
 }catch(e){
  const messages={KEY_CONFLICT:'Savdo kaliti boshqa ma’lumot bilan ishlatilgan.',CUSTOMER_AMBIGUOUS:'Telefon raqamiga bir nechta eski mijoz mos keldi; ma’lumotlarni tekshiring.',CONCURRENT_RETRY:'Savdo band, ayni amalni qayta urinib ko‘ring.',STOCK_UNAVAILABLE:'Mahsulot qoldig‘i yetarli emas yoki variant mavjud emas.',PRICE_CHANGED:'Mahsulot narxi o‘zgardi. Ro‘yxatni yangilang.',COST_REQUIRED:'Variant tannarxi aniqlanmagan; avval ombor ma’lumotlarini to‘ldiring.',INVALID_DISCOUNT:'Chegirma mahsulotlar summasidan oshmasin.',INVALID_SALE:'Savdo ma’lumotlarini tekshiring.'};
  if(e.saleCode)return fail(res,e.saleCode==='INVALID_SALE'||e.saleCode==='INVALID_DISCOUNT'?400:409,e.saleCode,messages[e.saleCode]);
  if(e.code===20||/Transaction numbers are only allowed|replica set/i.test(e.message||''))return fail(res,503,'TRANSACTIONS_UNAVAILABLE','Ombor tranzaksiyasi vaqtincha mavjud emas.');
  next(e);
 }
});
