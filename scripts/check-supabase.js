import 'dotenv/config';
import {createSupabaseClient,checkProductBucket} from '../src/config/supabase.js';

const client=createSupabaseClient();
if(!client){console.error('Supabase sozlamalari to‘liq emas yoki noto‘g‘ri.');process.exitCode=1}
else if(await checkProductBucket(client))console.log('Supabase products bucket: PASS (faqat o‘qish).');
else{console.error('Supabase products bucket: FAIL. Ulanish, ruxsat va bucketni tekshiring.');process.exitCode=1}
