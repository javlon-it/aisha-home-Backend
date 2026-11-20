import {Router} from 'express';
import mongoose from 'mongoose';
import {createHash} from 'node:crypto';
import {Customer,Product,ShopReturn,ShopSale,Variant} from '../models/index.js';

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

adminSalesRouter.get('/returns',async(req,res,next)=>{try{
 const returns=await ShopReturn.find({}).sort({returnedAt:-1,_id:-1}).limit(100).select('-requestId').lean();res.json({returns,limit:100});
}catch(e){next(e)}});

function cleanReturn(body){
 const reason=text(body?.reason,500);
 if(!reason||reason.length<3||!Array.isArray(body?.items)||body.items.length<1||body.items.length>50)throw problem('INVALID_RETURN');
 const seen=new Set(),items=body.items.map(item=>{
  if(!Number.isInteger(item?.saleItemIndex)||item.saleItemIndex<0||item.saleItemIndex>=50||seen.has(item.saleItemIndex)||!Number.isSafeInteger(item.quantity)||item.quantity<1||!['sellable','damaged'].includes(item.condition))throw problem('INVALID_RETURN');
  seen.add(item.saleItemIndex);return {saleItemIndex:item.saleItemIndex,quantity:item.quantity,condition:item.condition};
 });
 return {reason,items};
}
function refundableLineTotals(sale){
 const gross=sale.items.map(item=>item.unitPrice*item.quantity),sum=gross.reduce((a,b)=>a+b,0);
 if(gross.some(value=>!Number.isSafeInteger(value)||value<0))throw problem('SALE_CORRUPT');
 if(!Number.isSafeInteger(sum)||sum!==sale.subtotal||!Number.isSafeInteger(sale.discount)||sale.discount<0||sale.discount>sum)throw problem('SALE_CORRUPT');
 if(sum===0)return gross.map(()=>0);
 const discount=BigInt(sale.discount),denominator=BigInt(sum),portions=gross.map((value,index)=>{const product=discount*BigInt(value);return {index,share:Number(product/denominator),remainder:product%denominator}});
 let remaining=sale.discount-portions.reduce((a,x)=>a+x.share,0);
 portions.sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1);
 for(let i=0;i<remaining;i++)portions[i].share++;
 const discountByIndex=[];for(const x of portions)discountByIndex[x.index]=x.share;
 return sale.items.map((item,index)=>gross[index]-discountByIndex[index]);
}
function refundDelta(lineNet,soldQty,alreadyReturned,quantity){
 const denominator=BigInt(soldQty),net=BigInt(lineNet),before=net*BigInt(alreadyReturned)/denominator,after=net*BigInt(alreadyReturned+quantity)/denominator;
 if(before>BigInt(Number.MAX_SAFE_INTEGER)||after>BigInt(Number.MAX_SAFE_INTEGER))throw problem('SALE_CORRUPT');return Number(after-before);
}

adminSalesRouter.post('/sales/:saleId/returns',async(req,res,next)=>{
 if(!id(req.params.saleId))return fail(res,400,'INVALID_RETURN','Savdo identifikatorini tekshiring.');
 let data;try{data=cleanReturn(req.body)}catch{return fail(res,400,'INVALID_RETURN','Qaytarish ma’lumotlarini tekshiring.');}
 const key=req.get('Idempotency-Key');if(!key||!/^[a-zA-Z0-9-]{16,100}$/.test(key))return fail(res,400,'IDEMPOTENCY_REQUIRED','Qaytarish kalitini tekshiring.');
 const requestHash=createHash('sha256').update(JSON.stringify({saleId:req.params.saleId.toLowerCase(),...data})).digest('hex');
 try{
  await Promise.all([ShopReturn.init(),ShopSale.init()]);
  for(let attempt=0;attempt<3;attempt++){
   const session=await mongoose.startSession();let result;
   try{
    await session.withTransaction(async()=>{
     const existing=await ShopReturn.findOne({requestId:key}).select('+requestHash').session(session).lean();
     if(existing){if(existing.requestHash!==requestHash)throw problem('KEY_CONFLICT');result={id:String(existing._id),duplicate:true,refundTotal:existing.refundTotal};return}
     const sale=await ShopSale.findById(req.params.saleId).session(session).lean();if(!sale)throw problem('SALE_NOT_FOUND');
     const netLines=refundableLineTotals(sale),updates=[],returnItems=[];let refundTotal=0;
     for(const requested of data.items){
      const saleItem=sale.items[requested.saleItemIndex];if(!saleItem||!Number.isSafeInteger(saleItem.quantity)||!Number.isSafeInteger(saleItem.unitPrice)||!Number.isFinite(saleItem.unitCost))throw problem('SALE_CORRUPT');
      const already=saleItem.returnedQuantity||0;if(!Number.isSafeInteger(already)||already<0||already+requested.quantity>saleItem.quantity)throw problem('RETURN_LIMIT');
      const refundAmount=refundDelta(netLines[requested.saleItemIndex],saleItem.quantity,already,requested.quantity);
      if(!Number.isSafeInteger(refundAmount)||!Number.isSafeInteger(refundTotal+refundAmount))throw problem('SALE_CORRUPT');refundTotal+=refundAmount;
      if(requested.condition==='sellable'){
       const updated=await Variant.updateOne({_id:saleItem.variantId,stock:{$lte:Number.MAX_SAFE_INTEGER-requested.quantity}},{$inc:{stock:requested.quantity}},{session});
       if(updated.modifiedCount!==1)throw problem('VARIANT_MISSING');
      }
      updates.push({index:requested.saleItemIndex,quantity:already+requested.quantity,amount:(saleItem.returnedAmount||0)+refundAmount});
      returnItems.push({variantId:saleItem.variantId,name:saleItem.name,sku:saleItem.sku,color:saleItem.color,size:saleItem.size,quantity:requested.quantity,condition:requested.condition,unitPrice:saleItem.unitPrice,unitCost:saleItem.unitCost,refundAmount});
     }
     const version=sale.returnVersion||0,set={};for(const item of updates){set[`items.${item.index}.returnedQuantity`]=item.quantity;set[`items.${item.index}.returnedAmount`]=item.amount}
     const versionFilter=version===0?{$or:[{returnVersion:0},{returnVersion:{$exists:false}}]}:{returnVersion:version};
     const saleUpdate=await ShopSale.updateOne({_id:sale._id,...versionFilter},{$set:set,$inc:{returnsTotal:refundTotal,returnVersion:1}},{session});
     if(saleUpdate.modifiedCount!==1)throw problem('RETURN_RACE');
     const [record]=await ShopReturn.create([{requestId:key,requestHash,shopSaleId:sale._id,customerId:sale.customerId,customerSnapshot:sale.customerSnapshot,reason:data.reason,returnedAt:new Date(),items:returnItems,refundTotal}],{session});
     result={id:String(record._id),duplicate:false,refundTotal};
    });
    return res.status(result.duplicate?200:201).json({returnId:result.id,duplicate:result.duplicate,refundTotal:result.refundTotal});
   }catch(e){
    if(e.code!==11000)throw e;
    const existing=await ShopReturn.findOne({requestId:key}).select('+requestHash').lean();
    if(existing){if(existing.requestHash!==requestHash)throw problem('KEY_CONFLICT');return res.json({returnId:String(existing._id),duplicate:true,refundTotal:existing.refundTotal})}
    if(attempt===2)throw problem('CONCURRENT_RETRY');await new Promise(resolve=>setTimeout(resolve,30*(attempt+1)));
   }finally{await session.endSession()}
  }
 }catch(e){
  const messages={KEY_CONFLICT:'Qaytarish kaliti boshqa ma’lumot bilan ishlatilgan.',SALE_NOT_FOUND:'Savdo topilmadi.',SALE_CORRUPT:'Savdo summalarini tekshirib bo‘lmadi.',RETURN_LIMIT:'Qaytariladigan miqdor sotilgan qoldiqdan oshmasin.',VARIANT_MISSING:'Mahsulot varianti omborda topilmadi.',RETURN_RACE:'Savdo boshqa qaytarish bilan bir vaqtda o‘zgardi; qayta yuklang.',CONCURRENT_RETRY:'Qaytarish band, ayni amalni qayta urinib ko‘ring.',INVALID_RETURN:'Qaytarish ma’lumotlarini tekshiring.'};
  if(e.saleCode)return fail(res,e.saleCode==='INVALID_RETURN'?400:e.saleCode==='SALE_NOT_FOUND'?404:409,e.saleCode,messages[e.saleCode]);
  if(e.code===20||/Transaction numbers are only allowed|replica set/i.test(e.message||''))return fail(res,503,'TRANSACTIONS_UNAVAILABLE','Ombor tranzaksiyasi vaqtincha mavjud emas.');
  next(e);
 }
});

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
