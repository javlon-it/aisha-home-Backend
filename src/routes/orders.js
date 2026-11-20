import {Router} from 'express';
import mongoose from 'mongoose';
import {createHash,randomBytes} from 'node:crypto';
import {Customer,Order,Product,Variant} from '../models/index.js';
import {legacyPhonePattern,normalizePhone} from '../utils/phone.js';
import {discountedUnitPrice} from '../utils/pricing.js';

export const ordersRouter=Router();
const hash=value=>createHash('sha256').update(value).digest('hex');
function fail(res,status,code,message){return res.status(status).json({error:{code,message}})}
function owner(req,res){
 const raw=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('aisha_demo_owner='))?.slice(17);
 if(raw && /^[a-f0-9]{64}$/.test(raw))return hash(raw);
 const token=randomBytes(32).toString('hex');
 res.cookie('aisha_demo_owner',token,{httpOnly:true,sameSite:req.app.locals.production?'none':'strict',secure:req.app.locals.production,path:'/api',maxAge:31536000000});
 return hash(token);
}
function validId(id){return typeof id==='string' && /^[a-f0-9]{24}$/i.test(id)}
function clean(body){
 if(!body || typeof body!=='object' || !Array.isArray(body.items) || body.items.length<1 || body.items.length>50)throw Error('Mahsulotlar ro‘yxatini tekshiring.');
 const name=String(body.name||'').trim(),phone=String(body.phone||'').trim(),method=body.method,address=String(body.address||'').trim();
 if(name.length<2||name.length>100||!/^\+?[0-9 ()-]{9,20}$/.test(phone))throw Error('Ism va telefon raqamini to‘g‘ri kiriting.');
 const phoneKey=normalizePhone(phone);if(!phoneKey)throw Error('Telefon raqamini to‘g‘ri kiriting.');
 if(!['delivery','pickup'].includes(method))throw Error('Qabul qilish usulini tanlang.');
 if(method==='delivery'&&(address.length<5||address.length>300))throw Error('To‘liq yetkazish manzilini kiriting.');
 if(body.consent!==true)throw Error('Ma’lumotlarni qayta ishlashga rozilikni belgilang.');
 const ids=new Set();
 const items=body.items.map(item=>{if(!validId(item.variantId)||!Number.isSafeInteger(item.expectedPrice)||item.expectedPrice<0||('expectedDiscountPercent' in item&&(!Number.isInteger(item.expectedDiscountPercent)||item.expectedDiscountPercent<0||item.expectedDiscountPercent>100))||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>100||ids.has(item.variantId))throw Error('Mahsulot yoki chegirma ma’lumotini tekshiring.');ids.add(item.variantId);return {variantId:item.variantId,quantity:item.quantity,expectedPrice:item.expectedPrice,...('expectedDiscountPercent' in item?{expectedDiscountPercent:item.expectedDiscountPercent}:{})}});
 return {name,phone,phoneKey,method,address:method==='delivery'?address:'',items};
}
ordersRouter.use((req,res,next)=>{if(mongoose.connection.readyState!==1)return fail(res,503,'DATABASE_UNAVAILABLE','Ma’lumotlar bazasiga ulanib bo‘lmadi.');next()});
ordersRouter.get('/session',(req,res)=>{owner(req,res);res.set('Cache-Control','no-store').json({ready:true,demo:true})});
ordersRouter.get('/',async(req,res,next)=>{try{const ownerHash=owner(req,res);const orders=await Order.find({ownerHash}).sort({createdAt:-1}).select('-ownerHash -requestId -requestHash').lean();res.set('Cache-Control','no-store').json({orders})}catch(e){next(e)}});
ordersRouter.get('/:id',async(req,res,next)=>{try{if(!validId(req.params.id))return fail(res,404,'NOT_FOUND','Buyurtma topilmadi.');const order=await Order.findOne({_id:req.params.id,ownerHash:owner(req,res)}).select('-ownerHash -requestId -requestHash').lean();if(!order)return fail(res,404,'NOT_FOUND','Buyurtma topilmadi.');res.set('Cache-Control','no-store').json({order})}catch(e){next(e)}});
ordersRouter.post('/',async(req,res,next)=>{
 let data;try{data=clean(req.body)}catch(e){return fail(res,400,'INVALID_ORDER',e.message)}
 const key=req.get('Idempotency-Key');if(!key||!/^[a-zA-Z0-9-]{16,100}$/.test(key))return fail(res,400,'IDEMPOTENCY_REQUIRED','Buyurtma kaliti noto‘g‘ri.');
 const ownerHash=owner(req,res),requestHash=hash(JSON.stringify(data));
 await Promise.all([Order.init(),Customer.init()]);
 const existing=await Order.findOne({ownerHash,requestId:key}).lean().catch(()=>null);
 if(existing){if(existing.requestHash!==requestHash)return fail(res,409,'KEY_CONFLICT','Bu kalit boshqa buyurtmada ishlatilgan.');return res.status(200).json({orderId:String(existing._id),demo:true})}
 const session=await mongoose.startSession();let result;
 try{
  await session.withTransaction(async()=>{
   const found=await Order.findOne({ownerHash,requestId:key}).session(session).lean();
   if(found){if(found.requestHash!==requestHash){const e=Error('KEY_CONFLICT');throw e}result=found;return}
   let subtotal=0,originalSubtotal=0,discountTotal=0;const items=[],reservationCosts=[];
   for(const item of data.items){
    const v=await Variant.findOne({_id:item.variantId,stock:{$gte:item.quantity}}).session(session).lean();
    if(!v){const e=Error('STOCK');throw e}
    if(v.price!==item.expectedPrice)throw Error('PRICE_CHANGED');
    const product=await Product.findOne({_id:v.productId,archived:{$ne:true}}).session(session).lean();
    if(!product){const e=Error('STOCK');throw e}
    const updated=await Variant.updateOne({_id:v._id,stock:{$gte:item.quantity}},{$inc:{stock:-item.quantity}},{session});
    if(updated.modifiedCount!==1){const e=Error('STOCK');throw e}
    const pricing=discountedUnitPrice(v.price,Number.isInteger(product.discountPercent)?product.discountPercent:0);
    if(item.expectedDiscountPercent!==undefined&&item.expectedDiscountPercent!==pricing.discountPercent)throw Error('PRICE_CHANGED');
    if(!Number.isSafeInteger(pricing.finalPrice*item.quantity)||!Number.isSafeInteger(v.price*item.quantity))throw Error('PRICE');
    originalSubtotal+=v.price*item.quantity;discountTotal+=pricing.discountAmount*item.quantity;subtotal+=pricing.finalPrice*item.quantity;
    if(!Number.isSafeInteger(originalSubtotal)||!Number.isSafeInteger(discountTotal)||!Number.isSafeInteger(subtotal))throw Error('PRICE');
    items.push({variantId:v._id,name:product.name,color:v.color,size:v.size,price:pricing.finalPrice,originalPrice:v.price,discountPercent:pricing.discountPercent,discountAmount:pricing.discountAmount,quantity:item.quantity});
    reservationCosts.push({variantId:v._id,unitCost:v.averageCost??null});
   }
   const fee=data.method==='delivery'?null:0;
   if(fee!==null&&!Number.isSafeInteger(subtotal+fee))throw Error('PRICE');
   let customer=await Customer.findOne({phoneKey:data.phoneKey}).session(session);
   if(!customer){const legacy=await Customer.find({phoneKey:{$exists:false},phone:legacyPhonePattern(data.phoneKey)}).limit(2).session(session);if(legacy.length>1)throw Error('CUSTOMER_AMBIGUOUS');if(legacy.length===1)customer=legacy[0];else [customer]=await Customer.create([{name:data.name,phone:'+'+data.phoneKey,phoneKey:data.phoneKey}],{session})}
   [result]=await Order.create([{ownerHash,requestId:key,requestHash,customerId:customer._id,status:'Yangi',customerSnapshot:{name:data.name,phone:data.phone},items,reservationCosts,shippingSnapshot:{method:data.method,address:data.address,fee,feeConfirmed:data.method==='pickup'},subtotal,originalSubtotal,discountTotal,total:fee===null?null:subtotal+fee,inventoryReserved:true,paid:false}],{session});
  });
  return res.status(201).json({orderId:String(result._id),demo:true});
 }catch(e){
  if(e.code===11000){const duplicate=await Order.findOne({ownerHash,requestId:key}).lean();if(duplicate&&duplicate.requestHash===requestHash)return res.json({orderId:String(duplicate._id),demo:true});return fail(res,409,'KEY_CONFLICT','Bu kalit boshqa buyurtmada ishlatilgan.')}
  if(e.message==='PRICE_CHANGED')return fail(res,409,'PRICE_CHANGED','Mahsulot narxi o‘zgargan. Uni savatdan olib tashlab, katalogdan qayta qo‘shing.');
  if(e.message==='STOCK')return fail(res,409,'STOCK_UNAVAILABLE','Mahsulot tugagan yoki miqdor yetarli emas. Savatni yangilang.');
  if(e.message==='KEY_CONFLICT')return fail(res,409,'KEY_CONFLICT','Bu kalit boshqa buyurtmada ishlatilgan.');
  if(e.message==='CUSTOMER_AMBIGUOUS')return fail(res,409,'CUSTOMER_AMBIGUOUS','Telefon raqamiga bir nechta eski mijoz mos keldi. Buyurtmani qayta tekshiring.');
  if(e.code===20||/Transaction numbers are only allowed|replica set/i.test(e.message))return fail(res,503,'TRANSACTIONS_UNAVAILABLE','Buyurtma berish vaqtincha mavjud emas: ma’lumotlar bazasida tranzaksiyalar yoqilmagan.');
  next(e);
 }finally{await session.endSession()}
});
