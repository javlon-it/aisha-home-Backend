import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {dashboardRange,getDashboardStats} from '../src/services/dashboard.js';
import {Customer,Order,Product,ShopReturn,ShopSale,Variant} from '../src/models/index.js';

test('dashboard periods use Asia/Tashkent boundaries and reject invalid inputs',()=>{
 const daily=dashboardRange('daily','2026-11-20');
 assert.equal(daily.start.toISOString(),'2026-11-19T19:00:00.000Z');
 assert.equal(daily.end.toISOString(),'2026-11-20T19:00:00.000Z');
 assert.equal(dashboardRange('weekly','2026-11-20').startDate,'2026-11-16');
 assert.equal(dashboardRange('monthly','2026-11-20').buckets.length,30);
 assert.equal(dashboardRange('yearly','2026-11-20').buckets.length,12);
 assert.throws(()=>dashboardRange('hourly','2026-11-20'),{dashboardCode:'INVALID_PERIOD'});
 assert.throws(()=>dashboardRange('daily','2026-02-30'),{dashboardCode:'INVALID_DATE'});
});

const uri=process.env.DASHBOARD_TEST_MONGO;
test('dashboard aggregates completed synthetic sales, returns, customers and inventory from isolated MongoDB',{skip:!uri,timeout:60000},async()=>{
 const url=new URL(uri);assert.equal(url.protocol,'mongodb:');assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/aisha_dashboard_synthetic_[a-z0-9]+$/);assert.equal(url.search,'');
 await mongoose.connect(uri,{serverSelectionTimeoutMS:8000});assert.equal((await mongoose.connection.db.listCollections().toArray()).length,0,'synthetic database is empty');
 try{
  const start=new Date('2026-11-19T19:00:00.000Z'),before=new Date('2026-11-18T19:00:00.000Z'),customerRepeat=await Customer.create({name:'Synthetic Repeat',phone:'+998900000001'}),customerNew=await Customer.create({name:'Synthetic New',phone:'+998900000002'}),product=await Product.create({name:'Synthetic Towel',category:'Test'});
  const variant=await Variant.create({productId:product._id,sku:'DASH-'+Date.now(),color:'White',size:'Large',price:500,stock:3,averageCost:200});
  const item={variantId:variant._id,name:product.name,color:'White',size:'Large',price:1000,quantity:1};
  await Order.create({ownerHash:'synthetic',requestId:'repeat-old',customerId:customerRepeat._id,subtotal:1000,status:'Yakunlangan',items:[item],reservationCosts:[{variantId:variant._id,unitCost:500}],shippingSnapshot:{method:'pickup',fee:0},createdAt:before,updatedAt:before});
  await Order.create({ownerHash:'synthetic',requestId:'online-done',customerId:customerRepeat._id,subtotal:2000,originalSubtotal:2500,discountTotal:500,total:2150,paid:true,paidAt:start,status:'Yakunlangan',items:[{...item,quantity:1}],reservationCosts:[{variantId:variant._id,unitCost:500}],shippingSnapshot:{method:'delivery',fee:150,feeConfirmed:true},createdAt:start,updatedAt:start});
  await Order.create({ownerHash:'synthetic',requestId:'unfinished',customerId:customerNew._id,subtotal:50000,status:'Jarayonda',items:[{...item,quantity:50}],reservationCosts:[{variantId:variant._id,unitCost:500}],createdAt:start,updatedAt:start});
  await Order.create({ownerHash:'synthetic',requestId:'cancelled',customerId:customerNew._id,subtotal:60000,status:'Bekor qilingan',items:[{...item,quantity:60}],reservationCosts:[{variantId:variant._id,unitCost:500}],createdAt:start,updatedAt:start});
  const sale=await ShopSale.create({requestId:'physical-done',requestHash:'synthetic',customerId:customerNew._id,paymentMethod:'cash',items:[{variantId:variant._id,name:product.name,sku:'DASH',color:'White',size:'Large',quantity:2,unitPrice:500,unitCost:200}],subtotal:1000,generalDiscount:100,individualDiscount:0,discountSource:'product',discount:100,total:900,totalCost:400,createdAt:start,updatedAt:start});
  await ShopReturn.create({requestId:'return-one',requestHash:'synthetic',shopSaleId:sale._id,customerId:customerNew._id,reason:'Synthetic',returnedAt:new Date(start.getTime()+3600000),items:[{variantId:variant._id,name:product.name,sku:'DASH',color:'White',size:'Large',quantity:1,condition:'sellable',unitPrice:500,unitCost:200,refundAmount:200}],refundTotal:200,createdAt:start,updatedAt:start});
  const result=await getDashboardStats({period:'daily',date:'2026-11-20'}),summary=result.summary;
  assert.equal(summary.onlineOrders,1);assert.equal(summary.onlineSales,2000);assert.equal(summary.deliveryFees,150);
  assert.equal(summary.physicalSales,1);assert.equal(summary.physicalSalesAfterDiscount,900);assert.equal(summary.discounts,600);
  assert.equal(summary.returns,200);assert.equal(summary.returnRecords,1);assert.equal(summary.netSales,2700);
  assert.equal(summary.costOfGoodsSold,700);assert.equal(summary.grossProfit,2000);assert.equal(summary.missingCostRecords,0);
  assert.equal(summary.netProductSales,2700);assert.equal(summary.cashReceived,2850);assert.equal(summary.unpaidAmount,0);assert.equal(summary.legacyCompletionDateOrders,1);assert.equal(summary.unknownTotalOrders,0);assert.equal(summary.undatedPaidOrders,0);
  assert.equal(summary.unlinkedCustomers,0);
  assert.deepEqual(summary.customers,{new:1,repeat:1});assert.equal(result.topProducts[0].onlineUnits,1);assert.equal(result.topProducts[0].physicalUnits,2);assert.equal(result.topProducts[0].returnedUnits,1);assert.equal(result.topProducts[0].units,3);
  assert.equal(summary.inventory.variants,1);assert.equal(summary.inventory.units,3);assert.equal(summary.inventory.inventoryValue,600);
  assert.equal(result.series.find(bucket=>bucket.label==='00:00').netSales,2900);assert.equal(result.series.find(bucket=>bucket.label==='01:00').netSales,-200);
  await Order.create({ownerHash:'synthetic',requestId:'legacy-cost-unknown',subtotal:100,status:'Yakunlangan',items:[item],shippingSnapshot:{method:'pickup',fee:0},createdAt:start,updatedAt:start});
  const incomplete=await getDashboardStats({period:'daily',date:'2026-11-20'});assert.equal(incomplete.summary.costOfGoodsSold,null);assert.equal(incomplete.summary.grossProfit,null);assert.equal(incomplete.summary.missingCostRecords,1);assert.equal(incomplete.summary.unknownTotalOrders,1);assert.equal(incomplete.summary.unlinkedCustomers,1);
 }finally{await mongoose.connection.dropDatabase();await mongoose.disconnect()}
});
