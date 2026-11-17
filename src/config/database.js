import mongoose from 'mongoose';
import dns from 'node:dns';
export async function connectDatabase(uri) {
 if (!uri) throw new Error('MONGODB_URI required');
 if (process.env.MONGODB_DNS_SERVERS) dns.setServers(process.env.MONGODB_DNS_SERVERS.split(',').map(x=>x.trim()).filter(Boolean));
 return mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, ...(process.env.MONGODB_DB_NAME ? {dbName:process.env.MONGODB_DB_NAME} : {}) });
}
