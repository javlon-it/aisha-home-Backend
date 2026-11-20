import {Router} from 'express';
import mongoose from 'mongoose';
import {CrmNote,Customer,Order,ShopReturn,ShopSale} from '../models/index.js';
import {escapeRegExp,legacyPhonePattern,normalizePhone} from '../utils/phone.js';

export const adminCrmRouter=Router();
const fail=(res,status,code,message)=>res.status(status).json({error:{code,message}});
const objectId=value=>mongoose.isValidObjectId(value)&&/^[a-f0-9]{24}$/i.test(value);
const nonCancelled={$ne:'Bekor qilingan'};

adminCrmRouter.get('/customers',async(req,res,next)=>{try{
 const raw=typeof req.query.q==='string'?req.query.q.trim():'';if(raw.length>100||Object.keys(req.query).some(key=>key!=='q'&&key!=='path'))return fail(res,400,'INVALID_SEARCH','Qidiruv matni noto‘g‘ri.');
 let filter={};if(raw){const phoneKey=normalizePhone(raw);filter={$or:[{name:new RegExp(escapeRegExp(raw),'i')},...(phoneKey?[{phoneKey},{phone:legacyPhonePattern(phoneKey)}]:[{phone:new RegExp(escapeRegExp(raw),'i')}]) ]}}
 const customers=await Customer.find(filter).sort({updatedAt:-1,_id:-1}).limit(100).select('name phone phoneKey createdAt updatedAt').lean();
 if(!customers.length)return res.json({customers,limit:100});
 const ids=customers.map(customer=>customer._id),[sales,returns,orders]=await Promise.all([
  ShopSale.aggregate([{$match:{customerId:{$in:ids}}},{$group:{_id:'$customerId',count:{$sum:1},total:{$sum:'$total'}}}]),
  ShopReturn.aggregate([{$match:{customerId:{$in:ids}}},{$group:{_id:'$customerId',count:{$sum:1},total:{$sum:'$refundTotal'}}}]),
  Order.aggregate([{$match:{customerId:{$in:ids},status:nonCancelled}},{$group:{_id:'$customerId',count:{$sum:1},total:{$sum:'$total'}}}])
 ]);
 const index=rows=>new Map(rows.map(row=>[String(row._id),row]));const salesByCustomer=index(sales),returnsByCustomer=index(returns),ordersByCustomer=index(orders);
 res.set('Cache-Control','no-store').json({customers:customers.map(customer=>{const key=String(customer._id),sale=salesByCustomer.get(key),order=ordersByCustomer.get(key),returned=returnsByCustomer.get(key);return {...customer,salesCount:sale?.count||0,ordersCount:order?.count||0,totalPurchases:(sale?.total||0)+(order?.total||0),returnsCount:returned?.count||0,totalReturns:returned?.total||0}}),limit:100});
}catch(e){next(e)}});

adminCrmRouter.get('/customers/:customerId',async(req,res,next)=>{try{
 if(!objectId(req.params.customerId))return fail(res,404,'NOT_FOUND','Mijoz topilmadi.');
 const customer=await Customer.findById(req.params.customerId).select('name phone phoneKey createdAt updatedAt').lean();if(!customer)return fail(res,404,'NOT_FOUND','Mijoz topilmadi.');
 const customerId=customer._id,phoneKey=customer.phoneKey||normalizePhone(customer.phone),orderConditions=[{customerId}];if(phoneKey)orderConditions.push({customerId:{$exists:false},'customerSnapshot.phone':legacyPhonePattern(phoneKey)});const orderFilter={$or:orderConditions};
 const [sales,orders,returns,notes]=await Promise.all([
  ShopSale.find({customerId}).sort({createdAt:-1}).limit(100).select('-requestId').lean(),
  Order.find(orderFilter).sort({createdAt:-1}).limit(100).select('-ownerHash -requestId -requestHash -reservationCosts').lean(),
  ShopReturn.find({customerId}).sort({returnedAt:-1}).limit(100).select('-requestId').lean(),
  CrmNote.find({customerId}).sort({createdAt:-1}).limit(200).lean()
 ]);
 const purchases=[...sales.map(sale=>({type:'physical_sale',id:String(sale._id),date:sale.createdAt,status:'Do‘kondagi savdo',total:sale.total,discount:sale.discount,paymentMethod:sale.paymentMethod,items:sale.items})),...orders.map(order=>({type:'online_order',id:String(order._id),date:order.createdAt,status:order.status,total:order.total,items:order.items}))].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,200);
 const totalPurchases=sales.reduce((sum,sale)=>sum+sale.total,0)+orders.filter(order=>order.status!=='Bekor qilingan').reduce((sum,order)=>sum+(order.total||0),0),totalReturns=returns.reduce((sum,record)=>sum+record.refundTotal,0);
 res.set('Cache-Control','no-store').json({customer,totalPurchases,totalReturns,salesCount:sales.length,ordersCount:orders.filter(order=>order.status!=='Bekor qilingan').length,purchases,returns,notes});
}catch(e){next(e)}});

adminCrmRouter.post('/customers/:customerId/notes',async(req,res,next)=>{try{
 if(!objectId(req.params.customerId))return fail(res,404,'NOT_FOUND','Mijoz topilmadi.');
 const text=typeof req.body?.text==='string'?req.body.text.trim():'';if(!text||text.length>2000)return fail(res,400,'INVALID_NOTE','Izoh 1–2000 belgi bo‘lsin.');
 const customer=await Customer.exists({_id:req.params.customerId});if(!customer)return fail(res,404,'NOT_FOUND','Mijoz topilmadi.');
 const note=await CrmNote.create({customerId:req.params.customerId,text});res.status(201).json({note});
}catch(e){next(e)}});
