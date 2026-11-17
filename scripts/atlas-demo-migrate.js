import 'dotenv/config';
import dns from 'node:dns';
import mongoose from 'mongoose';

if (process.env.ATLAS_MIGRATE_CONFIRM !== 'yes' || process.env.MONGODB_DB_NAME !== 'aisha_home_v2_demo' || !process.env.MONGODB_URI?.startsWith('mongodb+srv://')) throw Error('Migration configuration rejected');
if (process.env.MONGODB_DNS_SERVERS) dns.setServers(process.env.MONGODB_DNS_SERVERS.split(',').map(x => x.trim()).filter(Boolean));
const local = await mongoose.createConnection('mongodb://127.0.0.1:27030/aisha_home_v2_demo?directConnection=true', {serverSelectionTimeoutMS:5000, readPreference:'secondaryPreferred'}).asPromise();
let atlas;
try {
 const source=local.db, products=await source.collection('products').find({}).toArray(), variants=await source.collection('variants').find({}).toArray();
 const ids=new Set(products.map(x=>String(x._id)));
 if(products.length!==3 || variants.length!==8 || variants.some(v=>!ids.has(String(v.productId))) || await source.collection('orders').countDocuments()!==0) throw Error('Unexpected source state');
 atlas=await mongoose.createConnection(process.env.MONGODB_URI,{dbName:'aisha_home_v2_demo',serverSelectionTimeoutMS:10000}).asPromise();
 const list=await atlas.db.admin().listDatabases({nameOnly:true});
 if(list.databases.some(x=>x.name==='aisha_home_v2_demo') || (await atlas.db.listCollections().toArray()).length) throw Error('Target database already exists');
 const session=await atlas.startSession();
 try { await session.withTransaction(async()=>{await atlas.db.collection('products').insertMany(products,{session});await atlas.db.collection('variants').insertMany(variants,{session})}); } finally {await session.endSession()}
 console.log('MIGRATION=PASS products='+await atlas.db.collection('products').countDocuments()+' variants='+await atlas.db.collection('variants').countDocuments());
} finally {await local.close();if(atlas)await atlas.close()}
