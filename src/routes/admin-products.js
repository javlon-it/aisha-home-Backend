import {Router} from 'express';
import mongoose from 'mongoose';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {Product,Variant,InventoryReceipt} from '../models/index.js';

export const adminProductsRouter=Router();
const id=x=>typeof x==='string'&&/^[a-f0-9]{24}$/i.test(x);
const text=(x,max)=>typeof x==='string'&&x.trim().length>0&&x.trim().length<=max?x.trim():null;
const integer=(x,max)=>Number.isSafeInteger(x)&&x>=0&&x<=max;
const fail=(res,status,code,message)=>res.status(status).json({error:{code,message}});
const activeProduct=productId=>Product.findOne({_id:productId,archived:{$ne:true}});
const imageKey=(key,productId)=>typeof key==='string'&&new RegExp('^products/'+productId+'/[a-f0-9-]{36}\\.(jpg|png|webp)$','i').test(key);
const imageSignature=buffer=>buffer.length>=12&&(buffer.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff]))||buffer.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))||(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP'));

adminProductsRouter.get('/products',async(req,res,next)=>{try{
 const products=await Product.find({}).sort({createdAt:-1}).lean();
 const variants=await Variant.find({productId:{$in:products.map(p=>p._id)}}).sort({sku:1}).lean();
 res.json({products:products.map(p=>({...p,variants:variants.filter(v=>String(v.productId)===String(p._id))}))});
}catch(e){next(e)}});

adminProductsRouter.post('/products',async(req,res,next)=>{try{
 const name=text(req.body?.name,120),category=text(req.body?.category,100),description=typeof req.body?.description==='string'?req.body.description.trim():null,discountPercent=req.body?.discountPercent??0;
 if(!name||!category||description===null||description.length>2000||!Number.isSafeInteger(discountPercent)||discountPercent<0||discountPercent>100)return fail(res,400,'INVALID_PRODUCT','Mahsulot ma’lumotlarini tekshiring.');
 const product=await Product.create({name,category,description,discountPercent,archived:false});res.status(201).json({product});
}catch(e){next(e)}});

adminProductsRouter.patch('/products/:productId',async(req,res,next)=>{try{
 if(!id(req.params.productId))return fail(res,404,'NOT_FOUND','Mahsulot topilmadi.');
 const name=text(req.body?.name,120),category=text(req.body?.category,100),description=typeof req.body?.description==='string'?req.body.description.trim():null,discountPercent=req.body?.discountPercent;
 if(!name||!category||description===null||description.length>2000||(discountPercent!==undefined&&(!Number.isSafeInteger(discountPercent)||discountPercent<0||discountPercent>100)))return fail(res,400,'INVALID_PRODUCT','Mahsulot ma’lumotlarini tekshiring.');
 const update={name,category,description};if(discountPercent!==undefined)update.discountPercent=discountPercent;
 const product=await Product.findOneAndUpdate({_id:req.params.productId,archived:{$ne:true}},{$set:update},{new:true,runValidators:true});
 if(!product)return fail(res,404,'NOT_FOUND','Mahsulot topilmadi.');res.json({product});
}catch(e){next(e)}});

adminProductsRouter.post('/products/:productId/archive',async(req,res,next)=>{try{
 if(!id(req.params.productId))return fail(res,404,'NOT_FOUND','Mahsulot topilmadi.');
 const product=await Product.findOneAndUpdate({_id:req.params.productId,archived:{$ne:true}},{$set:{archived:true}},{new:true});
 if(!product)return fail(res,404,'NOT_FOUND','Mahsulot topilmadi.');res.json({product});
}catch(e){next(e)}});

adminProductsRouter.post('/products/:productId/variants',async(req,res,next)=>{try{
 if(!id(req.params.productId)||!await activeProduct(req.params.productId))return fail(res,404,'NOT_FOUND','Mahsulot topilmadi.');
 const sku=text(req.body?.sku,80),color=text(req.body?.color,80),size=text(req.body?.size,80),price=req.body?.price;
 if(!sku||!color||!size||!integer(price,1000000000))return fail(res,400,'INVALID_VARIANT','SKU, rang, o‘lcham va narxni tekshiring.');
 const variant=await Variant.create({productId:req.params.productId,sku,color,size,price,stock:0,averageCost:null});res.status(201).json({variant});
}catch(e){if(e.code===11000)return fail(res,409,'DUPLICATE_VARIANT','SKU yoki rang va o‘lcham mavjud.');next(e)}});

adminProductsRouter.patch('/variants/:variantId',async(req,res,next)=>{try{
 if(!id(req.params.variantId))return fail(res,404,'NOT_FOUND','Variant topilmadi.');
 const sku=text(req.body?.sku,80),color=text(req.body?.color,80),size=text(req.body?.size,80),price=req.body?.price;
 if(!sku||!color||!size||!integer(price,1000000000))return fail(res,400,'INVALID_VARIANT','Variant ma’lumotlarini tekshiring.');
 const current=await Variant.findById(req.params.variantId);if(!current||!await activeProduct(current.productId))return fail(res,404,'NOT_FOUND','Variant topilmadi.');
 const variant=await Variant.findByIdAndUpdate(current._id,{$set:{sku,color,size,price}},{new:true,runValidators:true});res.json({variant});
}catch(e){if(e.code===11000)return fail(res,409,'DUPLICATE_VARIANT','SKU yoki rang va o‘lcham mavjud.');next(e)}});

adminProductsRouter.post('/variants/:variantId/receipts',async(req,res,next)=>{
 const {variantId}=req.params,{quantity,unitCost,receivedAt,openingUnitCost}=req.body||{},key=req.get('Idempotency-Key');
 if(!id(variantId)||!integer(quantity,1000000)||quantity<1||!integer(unitCost,1000000000)||!/^\d{4}-\d{2}-\d{2}$/.test(receivedAt||'')||!key||!/^[a-zA-Z0-9-]{16,100}$/.test(key))return fail(res,400,'INVALID_RECEIPT','Kirim ma’lumotlarini tekshiring.');
 const date=new Date(receivedAt+'T00:00:00.000Z');if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==receivedAt)return fail(res,400,'INVALID_RECEIPT','Kirim sanasini tekshiring.');
 if(openingUnitCost!==undefined&&!integer(openingUnitCost,1000000000))return fail(res,400,'INVALID_RECEIPT','Boshlang‘ich tannarxni tekshiring.');
 const requestHash=createHash('sha256').update(JSON.stringify({variantId,quantity,unitCost,receivedAt,openingUnitCost})).digest('hex');
 let session;try{
  await InventoryReceipt.init();session=await mongoose.startSession();let receipt;
  await session.withTransaction(async()=>{
   const existing=await InventoryReceipt.findOne({requestId:key}).session(session).lean();
   if(existing){if(existing.requestHash!==requestHash)throw Error('KEY_CONFLICT');receipt=existing;return}
   const variant=await Variant.findById(variantId).session(session);if(!variant)throw Error('NOT_FOUND');
   const product=await Product.findOne({_id:variant.productId,archived:{$ne:true}}).session(session);if(!product)throw Error('NOT_FOUND');
   if(variant.stock>0&&variant.averageCost==null&&openingUnitCost===undefined)throw Error('MISSING_COST');
   const stock=variant.stock+quantity;if(!Number.isSafeInteger(stock)||stock>1000000)throw Error('STOCK_LIMIT');
   const openingStock=variant.stock,needsOpening=openingStock>0&&variant.averageCost==null,baseCost=variant.averageCost??openingUnitCost??0;
   const averageCost=Math.round(((baseCost*variant.stock+unitCost*quantity)/stock)*10000)/10000;
   variant.stock=stock;variant.averageCost=averageCost;await variant.save({session});
   [receipt]=await InventoryReceipt.create([{requestId:key,requestHash,variantId,quantity,unitCost,receivedAt:date,...(needsOpening?{openingStock,openingUnitCost}:{}),averageCostAfter:averageCost}],{session});
  });res.status(200).json({receipt});
 }catch(e){
  if(e.code===11000){const existing=await InventoryReceipt.findOne({requestId:key}).lean();if(existing?.requestHash===requestHash)return res.json({receipt:existing});return fail(res,409,'KEY_CONFLICT','Kirim kaliti boshqa amalda ishlatilgan.');}
  if(e.message==='KEY_CONFLICT')return fail(res,409,'KEY_CONFLICT','Kirim kaliti boshqa amalda ishlatilgan.');
  if(e.message==='MISSING_COST')return fail(res,409,'MISSING_COST','Mavjud qoldiq tannarxi aniqlanmagan.');
  if(e.message==='STOCK_LIMIT')return fail(res,400,'STOCK_LIMIT','Qoldiq chegaradan oshdi.');
  if(e.message==='NOT_FOUND')return fail(res,404,'NOT_FOUND','Variant topilmadi.');
  if(e.code===20||/replica set|Transaction numbers are only allowed/i.test(e.message))return fail(res,503,'TRANSACTIONS_UNAVAILABLE','Ombor tranzaksiyasi mavjud emas.');
  next(e);
 }finally{if(session)await session.endSession()}
});

adminProductsRouter.put('/products/:productId/image',async(req,res,next)=>{const productId=req.params.productId,storage=req.app.locals.productStorage;if(!id(productId))return fail(res,404,'NOT_FOUND','Mahsulot topilmadi.');if(!storage)return fail(res,503,'STORAGE_UNAVAILABLE','Rasm xizmati mavjud emas.');
 let key;try{
  if(!Buffer.isBuffer(req.body)||req.body.length===0||req.body.length>4*1024*1024)return fail(res,400,'INVALID_IMAGE','Rasm hajmi 4 MB dan oshmasin.');
  if(!imageSignature(req.body))return fail(res,400,'INVALID_IMAGE','Faqat JPEG, PNG yoki WEBP rasm yuklang.');
  if(!await activeProduct(productId))return fail(res,404,'NOT_FOUND','Mahsulot topilmadi.');
  let image;try{const decoder=sharp(req.body,{limitInputPixels:40000000,failOn:'error'});const metadata=await decoder.metadata();if(!['jpeg','png','webp'].includes(metadata.format))return fail(res,400,'INVALID_IMAGE','Faqat JPEG, PNG yoki WEBP rasm yuklang.');image=await decoder.rotate().toBuffer({resolveWithObject:true})}catch{return fail(res,400,'INVALID_IMAGE','Faqat JPEG, PNG yoki WEBP rasm yuklang.');}
  const types={jpeg:['jpg','image/jpeg'],png:['png','image/png'],webp:['webp','image/webp']},type=types[image.info.format];if(!type)return fail(res,400,'INVALID_IMAGE','Faqat JPEG, PNG yoki WEBP rasm yuklang.');
  if(image.data.length>4*1024*1024)return fail(res,413,'TOO_LARGE','Rasm hajmi 4 MB dan oshdi.');
  key=`products/${productId}/${randomUUID()}.${type[0]}`;const result=await storage.upload(key,image.data,{contentType:type[1],upsert:false});if(result.error)return fail(res,503,'STORAGE_UNAVAILABLE','Rasmni yuklab bo‘lmadi.');
  const url=storage.getPublicUrl(key).data.publicUrl;
  let previous;try{previous=await Product.findOneAndUpdate({_id:productId,archived:{$ne:true}},{$set:{imageKey:key,imageUrl:url}},{new:false});}catch(e){await storage.remove([key]).catch(()=>{});throw e}
  if(!previous){await storage.remove([key]).catch(()=>{});return fail(res,404,'NOT_FOUND','Mahsulot topilmadi.');}
  let cleanupPending=false;if(imageKey(previous.imageKey,productId)){try{cleanupPending=!!(await storage.remove([previous.imageKey])).error}catch{cleanupPending=true}}
  res.json({imageUrl:url,cleanupPending});
 }catch(e){next(e)}
});

adminProductsRouter.delete('/products/:productId/image',async(req,res,next)=>{try{
 const productId=req.params.productId,storage=req.app.locals.productStorage;if(!id(productId))return fail(res,404,'NOT_FOUND','Mahsulot topilmadi.');if(!storage)return fail(res,503,'STORAGE_UNAVAILABLE','Rasm xizmati mavjud emas.');
 const previous=await Product.findOne({_id:productId,archived:{$ne:true}}).lean();
 if(!previous)return fail(res,404,'NOT_FOUND','Mahsulot topilmadi.');
 if(imageKey(previous.imageKey,productId)){const {error}=await storage.remove([previous.imageKey]);if(error)return fail(res,503,'STORAGE_UNAVAILABLE','Rasm o‘chirilmadi. Qayta urinib ko‘ring.');}
 const filter={_id:productId,archived:{$ne:true},imageKey:previous.imageKey??{$exists:false},imageUrl:previous.imageUrl??{$exists:false}};
 const updated=await Product.updateOne(filter,{$unset:{imageKey:1,imageUrl:1}});if(!updated.matchedCount)return fail(res,409,'IMAGE_CHANGED','Rasm o‘zgargan. Sahifani yangilang.');
 res.json({removed:true});
}catch(e){next(e)}});
