import {createClient} from '@supabase/supabase-js';

// This only prepares a client; it does not contact Supabase or verify the bucket.
export function createSupabaseClient(env=process.env){
 const url=env.SUPABASE_URL?.trim(),key=env.SUPABASE_SECRET_KEY?.trim(),bucket=env.SUPABASE_STORAGE_BUCKET?.trim();
 if(!url||!key||bucket!=='products')return null;
 try{
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||parsed.origin!==url||parsed.username||parsed.password)return null;
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 }catch{return null}
}

export function createProductStorage(env=process.env){
 return createSupabaseClient(env)?.storage.from('products')??null;
}

export async function checkProductBucket(client){
 if(!client)return false;
 try{const {data,error}=await client.storage.getBucket('products');return !error&&data?.id==='products'}catch{return false}
}

export async function reportSupabaseConnection(client,{timeoutMs=10000,log=console.log}={}){
 let timer;
 try{
  const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs)});
  const connected=await Promise.race([checkProductBucket(client),timeout]);
  log(connected?'Supabase connection: PASS':'Supabase connection: FAIL');
 }catch{log('Supabase connection: FAIL')}
 finally{clearTimeout(timer)}
}
