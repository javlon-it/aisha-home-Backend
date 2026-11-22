import mongoose from 'mongoose';
import {Order,Variant} from '../models/index.js';

export const ORDER_STATUSES=['Yangi','Jarayonda','Yakunlangan','Bekor qilingan'];
const transitions={Yangi:['Jarayonda','Bekor qilingan'],Jarayonda:['Yakunlangan','Bekor qilingan'],Yakunlangan:[], 'Bekor qilingan':[]};
const error=code=>Object.assign(new Error(code),{orderCode:code});

// Order state and all inventory returns commit together, including during parallel retries.
export async function changeOrderStatus(id,status,{expiryCutoff}={}){
 const session=await mongoose.startSession();let result;
 try{await session.withTransaction(async()=>{
  const order=await Order.findById(id).select('+reservationCosts').session(session);
  if(!order)throw error('NOT_FOUND');
  if(expiryCutoff&&(order.status!=='Yangi'||order.paid===true||!order.createdAt||order.createdAt>expiryCutoff)){result={skipped:true};return}
  if(order.status===status){result={id:String(order._id),status:order.status,unchanged:true};return}
  if(!expiryCutoff&&order.status==='Yangi'&&order.paid!==true&&status!=='Bekor qilingan'&&order.createdAt&&order.createdAt.getTime()<=Date.now()-24*60*60*1000)throw error('ORDER_EXPIRED');
  if(!transitions[order.status]?.includes(status))throw error('INVALID_TRANSITION');
  if(status==='Bekor qilingan'&&order.paid===true)throw error('PAYMENT_REFUND_REQUIRED');
  if(['Jarayonda','Yakunlangan'].includes(status)&&order.shippingSnapshot?.method==='delivery'&&(!Number.isSafeInteger(order.shippingSnapshot?.fee)||order.shippingSnapshot?.fee<0||order.shippingSnapshot?.feeConfirmed!==true))throw error('DELIVERY_FEE_REQUIRED');
  if(status==='Bekor qilingan'&&order.inventoryReserved===true){
   if(!Array.isArray(order.items)||!order.items.length)throw error('INVALID_RESERVATION');
   for(const item of order.items){
    if(!item.variantId||!Number.isSafeInteger(item.quantity)||item.quantity<1)throw error('INVALID_RESERVATION');
    const variant=await Variant.findById(item.variantId).session(session);if(!variant)throw error('VARIANT_MISSING');
    const oldStock=variant.stock,newStock=oldStock+item.quantity;
    if(!Number.isSafeInteger(oldStock)||oldStock<0||!Number.isSafeInteger(newStock))throw error('INVALID_RESERVATION');
    const snapshot=order.reservationCosts?.find(x=>String(x.variantId)===String(item.variantId));
    const cost=snapshot?.unitCost;
    // Unknown historical costs remain unknown rather than fabricating a weighted average.
    if(typeof cost!=='number'||!Number.isFinite(cost)||cost<0||(oldStock>0&&(variant.averageCost==null||!Number.isFinite(variant.averageCost))))variant.averageCost=null;
    else variant.averageCost=Math.round((((variant.averageCost??0)*oldStock+cost*item.quantity)/newStock)*10000)/10000;
    variant.stock=newStock;await variant.save({session});
   }
   order.inventoryReserved=false;
  }
  order.status=status;
  if(status==='Jarayonda')order.confirmedAt=new Date();
  if(status==='Yakunlangan'){order.inventoryReserved=false;order.completedAt=new Date()}
  if(status==='Bekor qilingan'){order.cancelledAt=new Date();order.cancellationReason=expiryCutoff?'expired':'admin'}
  await order.save({session});result={id:String(order._id),status:order.status};
 });return result}finally{await session.endSession()}
}

export async function updateDeliveryFee(id,fee){
 const session=await mongoose.startSession();let result;
 try{await session.withTransaction(async()=>{
  const order=await Order.findById(id).session(session);if(!order)throw error('NOT_FOUND');
  if(!['Yangi','Jarayonda'].includes(order.status))throw error('INVALID_TRANSITION');
  if(order.status==='Yangi'&&order.createdAt&&order.createdAt.getTime()<=Date.now()-24*60*60*1000)throw error('ORDER_EXPIRED');
  if(order.paid===true){if(order.shippingSnapshot?.fee===fee){result={id:String(order._id),fee,total:order.total,unchanged:true};return}throw error('PAYMENT_CONFIRMED')}
  if(!order.shippingSnapshot||!['delivery','pickup'].includes(order.shippingSnapshot.method))throw error('INVALID_ORDER');
  if(order.shippingSnapshot.method==='pickup'&&fee!==0)throw error('PICKUP_FEE');
  if(!Number.isSafeInteger(order.subtotal)||order.subtotal<0||!Number.isSafeInteger(order.subtotal+fee))throw error('INVALID_ORDER');
  order.shippingSnapshot={...order.shippingSnapshot,fee,feeConfirmed:true};order.total=order.subtotal+fee;
  await order.save({session});result={id:String(order._id),fee,total:order.total};
 });return result}finally{await session.endSession()}
}

export async function confirmOrderPayment(id){
 const session=await mongoose.startSession();let result;
 try{await session.withTransaction(async()=>{
  const order=await Order.findById(id).session(session);
  if(!order)throw error('NOT_FOUND');
  if(order.paid===true){result={id:String(order._id),paid:true,paidAt:order.paidAt??null,unchanged:true};return}
  if(!['Yangi','Jarayonda','Yakunlangan'].includes(order.status))throw error('INVALID_TRANSITION');
  if(order.status==='Yangi'&&order.createdAt&&order.createdAt.getTime()<=Date.now()-24*60*60*1000)throw error('ORDER_EXPIRED');
  const shipping=order.shippingSnapshot,fee=shipping?.fee;
  const feeFinal=shipping?.method==='pickup'&&fee===0||shipping?.method==='delivery'&&shipping.feeConfirmed===true;
  if(!Number.isSafeInteger(order.subtotal)||order.subtotal<0||!Number.isSafeInteger(order.total)||order.total<0||!feeFinal||!Number.isSafeInteger(fee)||fee<0||order.total!==order.subtotal+fee)throw error('FINAL_TOTAL_REQUIRED');
  order.paid=true;order.paidAt=new Date();await order.save({session});
  result={id:String(order._id),paid:true,paidAt:order.paidAt,unchanged:false};
 });return result}finally{await session.endSession()}
}

export async function expireUnconfirmedOrders({now=new Date(),limit=100,afterId}={}){
 const cutoff=new Date(now.getTime()-24*60*60*1000);
 const query={status:'Yangi',paid:{$ne:true},createdAt:{$lte:cutoff}};if(afterId)query._id={$gt:afterId};
 const orders=await Order.find(query).sort({_id:1}).select('_id').limit(limit).lean();
 let cancelled=0,failed=0;
 for(const order of orders){try{const result=await changeOrderStatus(order._id,'Bekor qilingan',{expiryCutoff:cutoff});if(!result.skipped&&!result.unchanged)cancelled++}catch{failed++}}
 return {checked:orders.length,cancelled,failed,nextId:orders.length===limit?orders[orders.length-1]._id:null};
}

// Render may sleep: this runs on startup and while the process is awake, catching up after restarts.
export function startOrderExpiryWorker({intervalMs=60000}={}){
 let running=false,afterId;
 const run=async()=>{if(running||mongoose.connection.readyState!==1)return;running=true;try{const result=await expireUnconfirmedOrders({afterId});afterId=result.nextId||undefined;if(result.failed)console.error('Buyurtma muddati tekshiruvida xatolar:',result.failed)}catch{console.error('Buyurtma muddatini tekshirish vaqtincha ishlamadi.')}finally{running=false}};
 void run();const timer=setInterval(run,intervalMs);timer.unref();return ()=>clearInterval(timer);
}
