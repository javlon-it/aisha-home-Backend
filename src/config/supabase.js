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

function classifyError(error){
 const status=Number.isInteger(error?.status)&&error.status>=400&&error.status<=599?error.status:null;
 if(status===401||status===403)return {ok:false,reason:'AUTH_OR_PERMISSION',status};
 if(status===404)return {ok:false,reason:'BUCKET_OR_ENDPOINT_NOT_FOUND',status};
 if(status)return {ok:false,reason:'HTTP_ERROR',status};
 if(error?.name==='AbortError'||error?.name==='TimeoutError')return {ok:false,reason:'TIMEOUT'};
 return {ok:false,reason:'NETWORK_OR_CLIENT_ERROR'};
}

export async function inspectProductBucket(client){
 if(!client)return {ok:false,reason:'CONFIG_INVALID'};
 try{
  const {data,error}=await client.storage.getBucket('products');
  if(error)return classifyError(error);
  return data?.id==='products'?{ok:true}:{ok:false,reason:'INVALID_RESPONSE'};
 }catch(error){return classifyError(error)}
}

export async function checkProductBucket(client){
 return (await inspectProductBucket(client)).ok;
}

export async function reportSupabaseConnection(client,{timeoutMs=10000,log=console.log}={}){
 let timer;
 try{
  const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve({ok:false,reason:'TIMEOUT'}),timeoutMs)});
  const result=await Promise.race([inspectProductBucket(client),timeout]);
  log(result.ok?'Supabase connection: PASS':`Supabase connection: FAIL (${result.reason}${result.status?`, HTTP ${result.status}`:''})`);
 }catch{log('Supabase connection: FAIL (NETWORK_OR_CLIENT_ERROR)')}
 finally{clearTimeout(timer)}
}
