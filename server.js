import 'dotenv/config';
import { createApp } from './src/app.js';
import { connectDatabase } from './src/config/database.js';
import { configureCloudinary } from './src/config/cloudinary.js';
import { createSupabaseClient,reportSupabaseConnection } from './src/config/supabase.js';
const port = Number(process.env.PORT || 5000);
const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : (process.env.HOST || '127.0.0.1');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT noto‘g‘ri');
async function startDatabase(){
 if(!process.env.MONGODB_URI){console.error('MongoDB sozlanmagan: MONGODB_URI mavjud emas.');return}
 try {await connectDatabase(process.env.MONGODB_URI);console.log('MongoDB ulandi.')}
 catch {console.error('MongoDB ulanmadi; 30 soniyadan keyin qayta uriniladi. Render va Atlas sozlamalarini tekshiring.');setTimeout(startDatabase,30000)}
}
startDatabase();
configureCloudinary(process.env);
createApp().listen(port, host, () => {
 console.log('AISHA V2 API ' + host + ':' + port);
 void reportSupabaseConnection(createSupabaseClient());
});
