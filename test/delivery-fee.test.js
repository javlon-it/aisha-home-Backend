import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {Order,Product,Variant} from '../src/models/index.js';
import {changeOrderStatus,updateDeliveryFee} from '../src/services/order-management.js';

const uri=process.env.DELIVERY_TEST_MONGO;
test('delivery stays unpriced until seller saves the negotiated fee, then the order can complete',{skip:!uri,timeout:60000},async()=>{
 const parsed=new URL(uri);assert.equal(parsed.protocol,'mongodb:');assert.equal(parsed.hostname,'127.0.0.1');assert.equal(parsed.port,'27033');assert.match(parsed.pathname,/^\/aisha_delivery_synthetic_[a-z0-9]+$/);assert.equal(parsed.search,'?replicaSet=aishaDeliveryTest');
 await mongoose.connect(uri,{serverSelectionTimeoutMS:10000});assert.equal((await mongoose.connection.db.listCollections().toArray()).length,0,'synthetic database is empty');
 try{
  const product=await Product.create({name:'Synthetic delivery item'}),variant=await Variant.create({productId:product._id,sku:'DELIVERY-'+Date.now(),color:'Test',size:'M',price:100000,stock:0,averageCost:40000});
  const [order]=await Order.create([{ownerHash:'synthetic',requestId:'delivery-fee-test',subtotal:100000,total:null,status:'Yangi',items:[{variantId:variant._id,name:product.name,price:100000,quantity:1}],reservationCosts:[{variantId:variant._id,unitCost:40000}],shippingSnapshot:{method:'delivery',address:'Synthetic address',fee:null,feeConfirmed:false},inventoryReserved:true,paid:false}]);
  await assert.rejects(changeOrderStatus(order._id,'Jarayonda'),error=>error.orderCode==='DELIVERY_FEE_REQUIRED');assert.equal((await Order.findById(order._id)).total,null);
  const saved=await updateDeliveryFee(order._id,7500);assert.equal(saved.fee,7500);assert.equal(saved.total,107500);
  await changeOrderStatus(order._id,'Jarayonda');await changeOrderStatus(order._id,'Yakunlangan');const completed=await Order.findById(order._id).lean();assert.equal(completed.shippingSnapshot.fee,7500);assert.equal(completed.shippingSnapshot.feeConfirmed,true);assert.equal(completed.total,107500);assert.equal(completed.status,'Yakunlangan');assert.equal((await Variant.findById(variant._id)).stock,0);
 }finally{await mongoose.connection.dropDatabase();await mongoose.disconnect()}
});
