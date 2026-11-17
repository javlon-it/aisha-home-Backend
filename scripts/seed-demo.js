import 'dotenv/config';
import mongoose from 'mongoose';
import {Product,Variant} from '../src/models/index.js';
const uri=process.env.MONGODB_URI;
if(process.env.NODE_ENV==='production'||process.env.DEMO_SEED_CONFIRM!=='yes'||!uri)throw new Error('Faqat lokal demo: MONGODB_URI va DEMO_SEED_CONFIRM=yes talab qilinadi');
const url=new URL(uri);
if(url.protocol!=='mongodb:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/aisha_home_v2_demo'||url.search||url.hash||url.username||url.password)throw new Error('Faqat localhost va aisha_home_v2_demo bazasiga ruxsat beriladi');
await mongoose.connect(uri,{serverSelectionTimeoutMS:5000,directConnection:true});
try{
 if(await Product.countDocuments()||await Variant.countDocuments())throw new Error('Demo bazada mahsulot yoki variant mavjud. Hech qanday yozuv o‘zgartirilmadi.');
 const data=[
  {name:'Yumshoq yuz sochig‘i',category:'Yuz sochiqlari',description:'Namuna: 1 dona yuz sochig‘i, 50 × 90 sm. Surat tasviriy; xususiyat va narx demo.',imageUrl:'/demo/demo-face.jpg',size:'50 × 90 sm',colors:['Bej','Oq'],price:39000,gsm:'450'},
  {name:'Mayin hammom sochig‘i',category:'Hammom sochiqlari',description:'Namuna: 1 dona hammom sochig‘i, 70 × 140 sm. Surat tasviriy; xususiyat va narx demo.',imageUrl:'/demo/demo-bath.jpg',size:'70 × 140 sm',colors:['Bej','Oq','Qumrang'],price:89000,gsm:'500'},
  {name:'Ikki kishilik sochiq to‘plami',category:'To‘plamlar',description:'Namuna to‘plam: 2 dona sochiq — 1 dona 70 × 140 sm va 1 dona 50 × 90 sm. Surat tasviriy.',imageUrl:'/demo/demo-set.jpg',size:'2 dona',colors:['Bej','Oq','Qumrang'],price:119000,gsm:'500'}
 ];
 let count=0;
 for(const [i,item] of data.entries()){
  const p=await Product.create({name:item.name,category:item.category,description:item.description,imageUrl:item.imageUrl,archived:false});
  for(const [j,color] of item.colors.entries()){await Variant.create({productId:p._id,sku:'DEMO-'+i+'-'+j,color,size:item.size,material:'Paxta — demo',gsm:item.gsm,price:item.price,stock:10});count++}
 }
 console.log('Demo katalog yaratildi: '+data.length+' mahsulot, '+count+' variant.');
}finally{await mongoose.disconnect()}
