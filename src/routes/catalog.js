import {Router} from 'express';
import mongoose from 'mongoose';
import {Product,Variant} from '../models/index.js';

export const catalogRouter=Router();
catalogRouter.use((req,res,next)=>{
 if(mongoose.connection.readyState!==1)return res.status(503).json({error:{code:'DATABASE_UNAVAILABLE',message:'Mahsulotlar bazasiga ulanib bo‘lmadi. Keyinroq qayta urinib ko‘ring.'}});
 next();
});
const productFields='name category description imageUrl discountPercent archived';
const variantFields='productId color size material gsm price stock';
import {discountedUnitPrice} from '../utils/pricing.js';
function publicProduct(p,variants){const discountPercent=Number.isInteger(p.discountPercent)?p.discountPercent:0;return {id:String(p._id),name:p.name,category:p.category,description:p.description,imageUrl:p.imageUrl,discountPercent,variants:variants.map(v=>({id:String(v._id),color:v.color,size:v.size,material:v.material,gsm:v.gsm,price:v.price,...discountedUnitPrice(v.price,discountPercent),isAvailable:v.stock>0}))}}
catalogRouter.get('/',async(req,res,next)=>{try{
 const products=await Product.find({archived:{$ne:true}}).select(productFields).sort({name:1}).lean();
 const variants=await Variant.find({productId:{$in:products.map(p=>p._id)}}).select(variantFields).sort({color:1,size:1}).lean();
 const grouped=new Map();for(const v of variants){const k=String(v.productId);if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(v)}
 res.json({products:products.map(p=>publicProduct(p,grouped.get(String(p._id))||[]))});
}catch(err){next(err)}});
catalogRouter.get('/:id',async(req,res,next)=>{try{
 if(!/^[a-fA-F0-9]{24}$/.test(req.params.id))return res.status(404).json({error:{code:'NOT_FOUND',message:'Mahsulot topilmadi'}});
 const p=await Product.findOne({_id:req.params.id,archived:{$ne:true}}).select(productFields).lean();
 if(!p)return res.status(404).json({error:{code:'NOT_FOUND',message:'Mahsulot topilmadi'}});
 const variants=await Variant.find({productId:p._id}).select(variantFields).sort({color:1,size:1}).lean();
 res.json({product:publicProduct(p,variants)});
}catch(err){next(err)}});
