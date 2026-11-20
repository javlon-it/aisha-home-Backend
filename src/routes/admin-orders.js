import {Router} from 'express';
import {Order} from '../models/index.js';
import {ORDER_STATUSES,changeOrderStatus,updateDeliveryFee} from '../services/order-management.js';

export const adminOrdersRouter=Router();
const validId=value=>/^[a-f0-9]{24}$/i.test(value||'');
const fail=(res,status,code,message)=>res.status(status).json({error:{code,message}});
function orderError(err,res,next){
 if(err.orderCode==='NOT_FOUND')return fail(res,404,'NOT_FOUND','Buyurtma topilmadi.');
 if(err.orderCode==='ORDER_EXPIRED')return fail(res,409,'ORDER_EXPIRED','Buyurtmani tasdiqlash muddati tugagan. U bekor qilinadi.');
 if(err.orderCode==='DELIVERY_FEE_REQUIRED')return fail(res,409,'DELIVERY_FEE_REQUIRED','Yetkazish narxini mijoz bilan kelishib saqlang.');
 if(['INVALID_TRANSITION','INVALID_RESERVATION','VARIANT_MISSING','PICKUP_FEE','INVALID_ORDER'].includes(err.orderCode))return fail(res,409,err.orderCode,'Buyurtma yoki ombor holati amalni bajarishga ruxsat bermadi.');
 if(err.code===20||/Transaction numbers are only allowed|replica set/i.test(err.message||''))return fail(res,503,'TRANSACTIONS_UNAVAILABLE','Ombor tranzaksiyasi vaqtincha mavjud emas.');
 return next(err);
}
async function list(req,res,next){try{
 const page=req.params.page?Number(req.params.page):1;if(!Number.isSafeInteger(page)||page<1||page>100000)return fail(res,400,'INVALID_PAGE','Sahifani tekshiring.');
 const limit=50,orders=await Order.find({}).sort({createdAt:-1,_id:-1}).skip((page-1)*limit).limit(limit+1).select('-ownerHash -requestId -requestHash').lean();
 res.json({orders:orders.slice(0,limit),page,hasMore:orders.length>limit});
}catch(e){next(e)}}
adminOrdersRouter.get('/orders',list);
adminOrdersRouter.get('/orders/page/:page',list);
adminOrdersRouter.get('/orders-summary',async(req,res,next)=>{try{
 const newOrders=await Order.countDocuments({status:'Yangi'});
 res.json({newOrders});
}catch(e){next(e)}});
adminOrdersRouter.get('/orders/:orderId',async(req,res,next)=>{try{
 if(!validId(req.params.orderId))return fail(res,404,'NOT_FOUND','Buyurtma topilmadi.');
 const order=await Order.findById(req.params.orderId).select('-ownerHash -requestId -requestHash').lean();if(!order)return fail(res,404,'NOT_FOUND','Buyurtma topilmadi.');res.json({order});
}catch(e){next(e)}});
adminOrdersRouter.patch('/orders/:orderId/status',async(req,res,next)=>{try{
 if(!validId(req.params.orderId))return fail(res,404,'NOT_FOUND','Buyurtma topilmadi.');
 if(!ORDER_STATUSES.includes(req.body?.status))return fail(res,400,'INVALID_STATUS','Buyurtma holatini tekshiring.');
 res.json({order:await changeOrderStatus(req.params.orderId,req.body.status)});
}catch(e){orderError(e,res,next)}});
adminOrdersRouter.patch('/orders/:orderId/delivery-fee',async(req,res,next)=>{try{
 if(!validId(req.params.orderId))return fail(res,404,'NOT_FOUND','Buyurtma topilmadi.');
 const fee=req.body?.fee;if(!Number.isSafeInteger(fee)||fee<0||fee>1000000000)return fail(res,400,'INVALID_FEE','Yetkazish narxini tekshiring.');
 res.json({order:await updateDeliveryFee(req.params.orderId,fee)});
}catch(e){orderError(e,res,next)}});
