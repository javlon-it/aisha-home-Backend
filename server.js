import 'dotenv/config';
import { createApp } from './src/app.js';
import { connectDatabase } from './src/config/database.js';
import { configureCloudinary } from './src/config/cloudinary.js';
const port = Number(process.env.PORT || 5000);
const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : (process.env.HOST || '127.0.0.1');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT noto‘g‘ri');
if (process.env.MONGODB_URI) { try { await connectDatabase(process.env.MONGODB_URI) } catch { console.error('MongoDB ulanmadi. Katalog vaqtincha mavjud emas; sozlamani tekshirib serverni qayta ishga tushiring.') } }
configureCloudinary(process.env);
createApp().listen(port, host, () => console.log('AISHA V2 API ' + host + ':' + port));
