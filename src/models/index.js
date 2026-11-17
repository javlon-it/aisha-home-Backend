import mongoose from 'mongoose';
const { Schema } = mongoose;
const schema = (shape, opts = {}) => new Schema(shape, { timestamps: true, ...opts });
const product = schema({ name: { type: String, required: true }, category: String, description: String, imageUrl: String, archived: { type: Boolean, default: false } });
const variant = schema({ productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true }, sku: { type: String, required: true, unique: true }, color: { type: String, required: true }, size: { type: String, required: true }, material: String, gsm: String, price: { type: Number, required: true, min: 0 }, stock: { type: Number, required: true, min: 0 } });
variant.index({ productId: 1, color: 1, size: 1 }, { unique: true });
const customer = schema({ name: { type: String, required: true }, phone: { type: String, required: true } });
const order = schema({ ownerHash: { type: String, required: true }, requestId: { type: String, required: true }, requestHash: String, customerSnapshot: Schema.Types.Mixed, subtotal: Number, status: String, items: [{ variantId: Schema.Types.ObjectId, name: String, color: String, size: String, price: Number, quantity: Number }], shippingSnapshot: Schema.Types.Mixed, total: Number, inventoryReserved: Boolean, paid: Boolean });
order.index({ ownerHash: 1, requestId: 1 }, { unique: true });
const inquiry = schema({ ownerHash: String, requestId: String, productId: Schema.Types.ObjectId, variantId: Schema.Types.ObjectId, status: String, orderId: Schema.Types.ObjectId });
inquiry.index({ ownerHash: 1, requestId: 1 }, { unique: true });
const note = schema({ customerId: { type: Schema.Types.ObjectId, ref: 'Customer' }, text: String });
const task = schema({ title: String, customerId: Schema.Types.ObjectId, inquiryId: Schema.Types.ObjectId, note: String, due: Date, status: { type: String, enum: ['Yangi', 'Jarayonda', 'Bajarildi'] } });
const shipping = schema({ pickup: Boolean, freeThreshold: Number, regions: [{ name: String, fee: Number, eta: String }], revision: Number });
const branch = schema({ name: String, address: String, phone: String, hours: String });
const crmLink = schema({ kind: { type: String, enum: ['order', 'inquiry'] }, entityId: Schema.Types.ObjectId, customerId: Schema.Types.ObjectId });
crmLink.index({ kind: 1, entityId: 1 }, { unique: true });
export const Product = mongoose.model('Product', product), Variant = mongoose.model('Variant', variant), Customer = mongoose.model('Customer', customer), Order = mongoose.model('Order', order), QuickInquiry = mongoose.model('QuickInquiry', inquiry), CrmNote = mongoose.model('CrmNote', note), CrmTask = mongoose.model('CrmTask', task), Shipping = mongoose.model('Shipping', shipping), Branch = mongoose.model('Branch', branch), CrmLink = mongoose.model('CrmLink', crmLink);

