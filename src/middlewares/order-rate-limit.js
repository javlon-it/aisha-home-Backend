import {isIP} from 'node:net';

function positiveInteger(env, name, fallback) {
 const value=Number(env[name] ?? fallback);
 if(!Number.isSafeInteger(value)||value<1)throw new Error(`${name} must be a positive integer`);
 return value;
}

// Use the transport peer, never a caller-controlled forwarding header or cookie.
// Group IPv6 addresses by /64 so rotating interface addresses cannot evade limits.
function peerKey(address='unknown') {
 if(address.startsWith('::ffff:')&&isIP(address.slice(7))===4)return address.slice(7);
 if(isIP(address)!==6)return address;
 const [left,right='']=address.split('::');
 const head=left?left.split(':'):[],tail=right?right.split(':'):[];
 const parts=address.includes('::')?[...head,...Array(8-head.length-tail.length).fill('0'),...tail]:head;
 return parts.slice(0,4).map(part=>parseInt(part,16).toString(16)).join(':')+'::/64';
}

export function createOrderRateLimit(env=process.env,{now=Date.now}={}) {
 const windowMs=positiveInteger(env,'ORDER_RATE_LIMIT_WINDOW_MS',600000);
 const max=positiveInteger(env,'ORDER_RATE_LIMIT_MAX',30);
 const maxKeys=positiveInteger(env,'ORDER_RATE_LIMIT_MAX_KEYS',10000);
 const clients=new Map();
 return (req,res,next)=>{
  const time=now(),key=peerKey(req.socket.remoteAddress);
  let entry=clients.get(key);
  if(entry&&entry.reset<=time){clients.delete(key);entry=undefined;}
  if(!entry){
   // Bounded memory; do not evict live limits (that would permit bypass).
   if(clients.size>=maxKeys)for(const [ip,state] of clients)if(state.reset<=time)clients.delete(ip);
   if(clients.size<maxKeys){entry={count:0,reset:time+windowMs};clients.set(key,entry);}
  }
  if(!entry||entry.count>=max){
   const retry=Math.max(1,Math.ceil(((entry?.reset ?? time+windowMs)-time)/1000));
   res.set('Retry-After',String(retry));res.set('Cache-Control','no-store');
   return res.status(429).json({error:{code:'ORDER_RATE_LIMITED',message:'Juda ko‘p buyurtma urinishlari. Biroz kutib, qayta urinib ko‘ring.'}});
  }
  entry.count++;next();
 };
}
