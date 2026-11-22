import { Customer, Order, Product, ShopReturn, ShopSale, Variant } from '../models/index.js';

export const DASHBOARD_PERIODS = ['daily', 'weekly', 'monthly', 'yearly'];
const TIME_ZONE = 'Asia/Tashkent';
const DAY = 24 * 60 * 60 * 1000;
const TASHKENT_OFFSET = 5 * 60 * 60 * 1000;
const pad = value => String(value).padStart(2, '0');
const civilKey = date => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const utcMillis = (year, month, day = 1) => { const value = new Date(0); value.setUTCHours(0, 0, 0, 0); value.setUTCFullYear(year, month, day); return value.getTime(); };
function localToday(now) {
 const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
 const get = type => Number(parts.find(part => part.type === type)?.value);
 return { year: get('year'), month: get('month'), day: get('day') };
}
function readCivilDate(value, now) {
 if (value === undefined) return localToday(now);
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Object.assign(new Error('INVALID_DATE'), { dashboardCode: 'INVALID_DATE' });
 const [year, month, day] = value.split('-').map(Number), check = new Date(utcMillis(year, month - 1, day));
 if (check.getUTCFullYear() !== year || check.getUTCMonth() + 1 !== month || check.getUTCDate() !== day) throw Object.assign(new Error('INVALID_DATE'), { dashboardCode: 'INVALID_DATE' });
 return { year, month, day };
}
const shiftMonths = (date, count) => new Date(utcMillis(date.getUTCFullYear(), date.getUTCMonth() + count, 1));

export function dashboardRange(period = 'monthly', date, now = new Date()) {
 if (!DASHBOARD_PERIODS.includes(period)) throw Object.assign(new Error('INVALID_PERIOD'), { dashboardCode: 'INVALID_PERIOD' });
 const civil = readCivilDate(date, now);
 let first = utcMillis(civil.year, civil.month - 1, civil.day), next, unit, count;
 if (period === 'daily') { next = first + DAY; unit = 'hour'; count = 24; }
 else if (period === 'weekly') {
  const weekday = new Date(first).getUTCDay(); first -= ((weekday + 6) % 7) * DAY; next = first + 7 * DAY; unit = 'day'; count = 7;
 } else if (period === 'monthly') {
  first = utcMillis(civil.year, civil.month - 1, 1); next = utcMillis(civil.year, civil.month, 1); unit = 'day'; count = (next - first) / DAY;
 } else { first = utcMillis(civil.year, 0, 1); next = utcMillis(civil.year + 1, 0, 1); unit = 'month'; count = 12; }
 const startCivil = new Date(first), endCivil = new Date(next), start = new Date(first - TASHKENT_OFFSET), end = new Date(next - TASHKENT_OFFSET);
 const buckets = Array.from({ length: count }, (_, index) => {
  const bucketDate = unit === 'hour' ? new Date(first + index * 60 * 60 * 1000) : unit === 'month' ? shiftMonths(startCivil, index) : new Date(first + index * DAY);
  const key = unit === 'hour' ? `${civilKey(bucketDate)}T${pad(bucketDate.getUTCHours())}` : unit === 'month' ? `${bucketDate.getUTCFullYear()}-${pad(bucketDate.getUTCMonth() + 1)}` : civilKey(bucketDate);
  const label = unit === 'hour' ? `${pad(bucketDate.getUTCHours())}:00` : unit === 'month' ? pad(bucketDate.getUTCMonth() + 1) : `${pad(bucketDate.getUTCDate())}.${pad(bucketDate.getUTCMonth() + 1)}`;
  return { key, label, netSales: 0, returns: 0, costOfGoodsSold: 0 };
 });
 const bucketFormat = unit === 'hour' ? '%Y-%m-%dT%H' : unit === 'month' ? '%Y-%m' : '%Y-%m-%d';
 return { period, timeZone: TIME_ZONE, start, end, startDate: civilKey(startCivil), endDateExclusive: civilKey(endCivil), unit, bucketFormat, buckets };
}

const matchRange = range => ({ createdAt: { $gte: range.start, $lt: range.end } });
// Legacy completed orders have no completedAt: retain their existing createdAt attribution without writing an invented date.
const onlineCompletedMatch = range => ({ status: 'Yakunlangan', $or: [
 { completedAt: { $gte: range.start, $lt: range.end } },
 { completedAt: null, createdAt: { $gte: range.start, $lt: range.end } }
] });
const onlineCompletionDate = { $ifNull: ['$completedAt', '$createdAt'] };
const timeBucket = (field, range) => ({ $dateToString: { format: range.bucketFormat, date: field, timezone: TIME_ZONE } });
const reservationCostExpr = item => ({ $let: {
 vars: { snapshot: { $arrayElemAt: [{ $filter: { input: { $ifNull: ['$reservationCosts', []] }, as: 'cost', cond: { $eq: ['$$cost.variantId', item] } } }, 0] } },
 in: '$$snapshot.unitCost'
} });
const costCompleteExpr = { $and: [
  { $gt: [{ $size: { $ifNull: ['$items', []] } }, 0] },
  { $allElementsTrue: [{ $map: { input: { $ifNull: ['$items', []] }, as: 'item', in: { $and: [ { $isNumber: reservationCostExpr('$$item.variantId') }, { $isNumber: '$$item.quantity' } ] } } }] }
] };
const onlineCostExpr = { $sum: { $map: { input: { $ifNull: ['$items', []] }, as: 'item', in: {
 $let: { vars: { unitCost: reservationCostExpr('$$item.variantId') }, in: { $cond: [ { $and: [ { $isNumber: '$$unitCost' }, { $isNumber: '$$item.quantity' } ] }, { $multiply: ['$$unitCost', '$$item.quantity'] }, 0 ] } }
} } } };
const sellableReturnCostExpr = { $sum: { $map: { input: { $filter: { input: { $ifNull: ['$items', []] }, as: 'item', cond: { $eq: ['$$item.condition', 'sellable'] } } }, as: 'item', in: {
 $cond: [ { $and: [ { $isNumber: '$$item.unitCost' }, { $isNumber: '$$item.quantity' } ] }, { $multiply: ['$$item.unitCost', '$$item.quantity'] }, 0 ]
} } } };
const validReturnCostExpr = { $allElementsTrue: [{ $map: { input: { $filter: { input: { $ifNull: ['$items', []] }, as: 'item', cond: { $eq: ['$$item.condition', 'sellable'] } } }, as: 'item', in: { $and: [{ $isNumber: '$$item.unitCost' }, { $isNumber: '$$item.quantity' }] } } }] };

async function onlineTotals(range) {
 const rows = await Order.aggregate([
  { $match: onlineCompletedMatch(range) },
  { $addFields: { costComplete: costCompleteExpr, knownCost: onlineCostExpr } },
  { $group: {
   _id: null, orders: { $sum: 1 }, productSales: { $sum: { $cond: [{ $isNumber: '$subtotal' }, '$subtotal', 0] } }, discounts: { $sum: { $cond: [{ $isNumber: '$discountTotal' }, '$discountTotal', 0] } },
   deliveryFees: { $sum: { $cond: [{ $isNumber: '$shippingSnapshot.fee' }, '$shippingSnapshot.fee', 0] } },
   costOfGoodsSold: { $sum: '$knownCost' }, missingCostOrders: { $sum: { $cond: ['$costComplete', 0, 1] } },
   legacyCompletionDateOrders: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$completedAt', null] }, null] }, 1, 0] } },
   unknownTotalOrders: { $sum: { $cond: [{ $isNumber: '$total' }, 0, 1] } },
   unlinkedCustomers: { $sum: { $cond: [{ $in: [{ $type: '$customerId' }, ['missing', 'null']] }, 1, 0] } }
  } }
 ]);
 return rows[0] || { orders: 0, productSales: 0, discounts: 0, deliveryFees: 0, costOfGoodsSold: 0, missingCostOrders: 0, legacyCompletionDateOrders: 0, unknownTotalOrders: 0, unlinkedCustomers: 0 };
}
async function onlinePayments(range) {
 const [received, unpaid, undatedPaidOrders] = await Promise.all([
  Order.aggregate([{ $match: { paid: true, paidAt: { $gte: range.start, $lt: range.end } } }, { $group: { _id: null, amount: { $sum: { $cond: [{ $isNumber: '$total' }, '$total', 0] } } } }]),
  Order.aggregate([{ $match: { ...onlineCompletedMatch(range), paid: { $ne: true } } }, { $group: { _id: null, amount: { $sum: { $cond: [{ $isNumber: '$total' }, '$total', 0] } } } }]),
  Order.countDocuments({ paid: true, paidAt: null })
 ]);
 return { received: received[0]?.amount || 0, unpaid: unpaid[0]?.amount || 0, undatedPaidOrders };
}
async function onlineSalesSeries(range) {
 return Order.aggregate([
  { $match: onlineCompletedMatch(range) },
  { $project: { bucket: timeBucket(onlineCompletionDate, range), subtotal: 1 } },
  { $group: { _id: '$bucket', online: { $sum: { $cond: [{ $isNumber: '$subtotal' }, '$subtotal', 0] } } } }
 ]);
}
async function physicalTotals(range) {
 const rows = await ShopSale.aggregate([
  { $match: matchRange(range) },
  { $group: {
   _id: null, sales: { $sum: 1 }, productSales: { $sum: { $cond: [{ $isNumber: '$total' }, '$total', 0] } },
   subtotal: { $sum: { $cond: [{ $isNumber: '$subtotal' }, '$subtotal', 0] } }, discounts: { $sum: { $cond: [{ $isNumber: '$discount' }, '$discount', 0] } },
   costOfGoodsSold: { $sum: { $cond: [{ $isNumber: '$totalCost' }, '$totalCost', 0] } }, missingCostSales: { $sum: { $cond: [{ $isNumber: '$totalCost' }, 0, 1] } }
  } }
 ]);
 return rows[0] || { sales: 0, productSales: 0, subtotal: 0, discounts: 0, costOfGoodsSold: 0, missingCostSales: 0 };
}
async function returnTotals(range) {
 const rows = await ShopReturn.aggregate([
  { $match: { returnedAt: { $gte: range.start, $lt: range.end } } },
  { $addFields: { returnedCost: sellableReturnCostExpr, returnCostComplete: validReturnCostExpr } },
  { $group: {
   _id: null, count: { $sum: 1 }, refundTotal: { $sum: '$refundTotal' }, returnedCost: { $sum: '$returnedCost' },
   missingReturnedCost: { $sum: { $cond: ['$returnCostComplete', 0, 1] } }
  } }
 ]);
 return rows[0] || { count: 0, refundTotal: 0, returnedCost: 0, missingReturnedCost: 0 };
}
async function seriesFor(model, range, { match = {}, dateField = '$createdAt', values }) {
 return model.aggregate([
  { $match: { ...match, [dateField.slice(1)]: { $gte: range.start, $lt: range.end } } },
  { $project: { bucket: timeBucket(dateField, range), ...values.project } },
  ...(values.addFields ? [{ $addFields: values.addFields }] : []),
  { $group: { _id: '$bucket', ...values.group } }
 ]);
}

async function customerCounts(range) {
 const periodMatch = matchRange(range);
 const [periodSales, periodOrders, allSales, allOrders] = await Promise.all([
  ShopSale.aggregate([{ $match: periodMatch }, { $group: { _id: '$customerId' } }]),
  Order.aggregate([{ $match: { ...onlineCompletedMatch(range), customerId: { $type: 'objectId' } } }, { $group: { _id: '$customerId' } }]),
  ShopSale.aggregate([{ $match: { customerId: { $type: 'objectId' } } }, { $group: { _id: '$customerId', firstAt: { $min: '$createdAt' } } }]),
  Order.aggregate([{ $match: { status: 'Yakunlangan', customerId: { $type: 'objectId' } } }, { $group: { _id: '$customerId', firstAt: { $min: onlineCompletionDate } } }])
 ]);
 const periodIds = new Set([...periodSales, ...periodOrders].filter(row => row._id).map(row => String(row._id)));
 if (!periodIds.size) return { new: 0, repeat: 0 };
 const firstById = new Map();
 for (const row of [...allSales, ...allOrders]) {
  const id = String(row._id), previous = firstById.get(id);
  if (!previous || row.firstAt < previous) firstById.set(id, row.firstAt);
 }
 const actualCustomers = new Set((await Customer.find({ _id: { $in: [...periodIds] } }).distinct('_id')).map(String));
 let newCustomers = 0, repeatCustomers = 0;
 for (const id of actualCustomers) {
  const first = firstById.get(id);
  if (first && first >= range.start && first < range.end) newCustomers++;
  else if (first && first < range.start) repeatCustomers++;
 }
 return { new: newCustomers, repeat: repeatCustomers };
}

async function topProducts(range) {
 const match = onlineCompletedMatch(range);
 const [online, physical, returns] = await Promise.all([
  Order.aggregate([{ $match: match }, { $unwind: '$items' }, { $group: { _id: '$items.variantId', name: { $first: '$items.name' }, units: { $sum: '$items.quantity' } } }]),
  ShopSale.aggregate([{ $match: matchRange(range) }, { $unwind: '$items' }, { $group: { _id: '$items.variantId', name: { $first: '$items.name' }, units: { $sum: '$items.quantity' } } }]),
  ShopReturn.aggregate([{ $match: { returnedAt: { $gte: range.start, $lt: range.end } } }, { $unwind: '$items' }, { $group: { _id: '$items.variantId', units: { $sum: '$items.quantity' } } }])
 ]);
 const returnedByVariant = new Map(returns.map(row => [String(row._id), row.units || 0])), combined = new Map();
 for (const [rows, channel] of [[online, 'online'], [physical, 'physical']]) for (const row of rows) {
  const key = String(row._id), current = combined.get(key) || { variantId: row._id, name: row.name || 'Noma’lum mahsulot', onlineUnits: 0, physicalUnits: 0 };
  current[channel === 'online' ? 'onlineUnits' : 'physicalUnits'] += row.units || 0; combined.set(key, current);
 }
 const variantIds = [...combined.values()].map(row => row.variantId), variants = await Variant.find({ _id: { $in: variantIds } }).select('productId').lean(), productIds = variants.map(row => row.productId);
 const products = await Product.find({ _id: { $in: productIds } }).select('name').lean(), names = new Map(products.map(row => [String(row._id), row.name])), variantProducts = new Map(variants.map(row => [String(row._id), String(row.productId)]));
 const productRows = new Map();
 for (const row of combined.values()) {
  const productId = variantProducts.get(String(row.variantId)), key = productId || `variant:${row.variantId}`, current = productRows.get(key) || { productId: productId || null, name: names.get(productId) || row.name, onlineUnits: 0, physicalUnits: 0 };
  current.onlineUnits += row.onlineUnits; current.physicalUnits += row.physicalUnits; productRows.set(key, current);
 }
 return [...productRows.values()].map(row => {
  const returned = [...combined.values()].filter(item => variantProducts.get(String(item.variantId)) === row.productId).reduce((sum, item) => sum + (returnedByVariant.get(String(item.variantId)) || 0), 0);
  return { ...row, returnedUnits: returned, units: row.onlineUnits + row.physicalUnits };
 }).sort((a, b) => b.units - a.units || a.name.localeCompare(b.name, 'uz')).slice(0, 10);
}

async function inventorySnapshot() {
 const [summaryRows, products] = await Promise.all([
  Variant.aggregate([
   { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product' } }, { $unwind: '$product' }, { $match: { 'product.archived': { $ne: true } } },
   { $group: { _id: null, variants: { $sum: 1 }, units: { $sum: '$stock' }, outOfStockVariants: { $sum: { $cond: [{ $eq: ['$stock', 0] }, 1, 0] } },
    inventoryValueKnown: { $sum: { $cond: [{ $and: [{ $isNumber: '$averageCost' }, { $isNumber: '$stock' }] }, { $multiply: ['$stock', '$averageCost'] }, 0] } },
    missingCostVariants: { $sum: { $cond: [{ $and: [{ $gt: ['$stock', 0] }, { $not: [{ $isNumber: '$averageCost' }] }] }, 1, 0] } }
   } }
  ]),
  Variant.aggregate([
   { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product' } }, { $unwind: '$product' }, { $match: { 'product.archived': { $ne: true } } },
   { $group: { _id: '$productId', name: { $first: '$product.name' }, variants: { $sum: 1 }, units: { $sum: '$stock' },
    knownValue: { $sum: { $cond: [{ $and: [{ $isNumber: '$averageCost' }, { $isNumber: '$stock' }] }, { $multiply: ['$stock', '$averageCost'] }, 0] } },
    missingCostVariants: { $sum: { $cond: [{ $and: [{ $gt: ['$stock', 0] }, { $not: [{ $isNumber: '$averageCost' }] }] }, 1, 0] } }
   } }, { $sort: { units: 1, name: 1 } }, { $limit: 50 }
  ])
 ]);
 const row = summaryRows[0] || { variants: 0, units: 0, outOfStockVariants: 0, inventoryValueKnown: 0, missingCostVariants: 0 };
 return {
  variants: row.variants, units: row.units, outOfStockVariants: row.outOfStockVariants, missingCostVariants: row.missingCostVariants,
  inventoryValue: row.missingCostVariants ? null : row.inventoryValueKnown,
  products: products.map(({ _id, name, variants: count, units, knownValue, missingCostVariants }) => ({ productId: String(_id), name, variants: count, units, inventoryValue: missingCostVariants ? null : knownValue, missingCostVariants }))
 };
}

export async function getDashboardStats({ period = 'monthly', date, now = new Date() } = {}) {
 const range = dashboardRange(period, date, now);
 const [online, physical, returns, customer, inventory, onlineSeries, physicalSeries, returnSeries, products, payments] = await Promise.all([
  onlineTotals(range), physicalTotals(range), returnTotals(range), customerCounts(range), inventorySnapshot(),
  onlineSalesSeries(range),
  seriesFor(ShopSale, range, { values: { project: { total: 1 }, group: { physical: { $sum: { $cond: [{ $isNumber: '$total' }, '$total', 0] } } } } }),
  seriesFor(ShopReturn, range, { dateField: '$returnedAt', values: { project: { refundTotal: 1 }, group: { returns: { $sum: { $cond: [{ $isNumber: '$refundTotal' }, '$refundTotal', 0] } } } } }),
  topProducts(range), onlinePayments(range)
 ]);
 const byBucket = (rows, field) => new Map(rows.map(row => [row._id, row[field] || 0]));
 const onlineByBucket = byBucket(onlineSeries, 'online'), physicalByBucket = byBucket(physicalSeries, 'physical'), returnsByBucket = byBucket(returnSeries, 'returns');
 const series = range.buckets.map(bucket => {
  const onlineSales = onlineByBucket.get(bucket.key) || 0, physicalSales = physicalByBucket.get(bucket.key) || 0, refund = returnsByBucket.get(bucket.key) || 0;
  return { ...bucket, onlineSales, physicalSales, returns: refund, netSales: onlineSales + physicalSales - refund };
 });
 const netSales = online.productSales + physical.productSales - returns.refundTotal;
 const costOfGoodsSold = online.costOfGoodsSold + physical.costOfGoodsSold - returns.returnedCost;
 const missingCostRecords = online.missingCostOrders + physical.missingCostSales + returns.missingReturnedCost;
 return {
  range: { period, timeZone: range.timeZone, start: range.start.toISOString(), endExclusive: range.end.toISOString(), startDate: range.startDate, endDateExclusive: range.endDateExclusive },
  summary: {
   onlineOrders: online.orders, onlineSales: online.productSales, deliveryFees: online.deliveryFees, legacyCompletionDateOrders: online.legacyCompletionDateOrders, unknownTotalOrders: online.unknownTotalOrders,
   physicalSales: physical.sales, physicalSubtotal: physical.subtotal, physicalSalesAfterDiscount: physical.productSales,
   discounts: online.discounts + physical.discounts, returns: returns.refundTotal, returnRecords: returns.count,
   unlinkedCustomers: online.unlinkedCustomers,
   netSales, netProductSales: netSales, cashReceived: physical.productSales + payments.received - returns.refundTotal, unpaidAmount: payments.unpaid, undatedPaidOrders: payments.undatedPaidOrders,
   costOfGoodsSold: missingCostRecords ? null : costOfGoodsSold, grossProfit: missingCostRecords ? null : netSales - costOfGoodsSold,
   missingCostRecords, customers: customer, inventory
  },
  topProducts: products, series
 };
}
