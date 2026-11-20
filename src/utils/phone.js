export function normalizePhone(value){
 if(typeof value!=='string'||value.length>24||!/^\+?[0-9 ()-]+$/.test(value.trim()))return null;
 const digits=value.replace(/\D/g,'');if(digits.length<9||digits.length>15)return null;
 return digits.length===9?'998'+digits:digits;
}

export function legacyPhonePattern(phoneKey){
 const local=phoneKey.startsWith('998')&&phoneKey.length===12,digits=local?phoneKey.slice(3):phoneKey,sep='[\\s()\\-]*';
 return new RegExp('^\\s*\\+?'+sep+(local?'(?:9'+sep+'9'+sep+'8'+sep+')?':'')+digits.split('').join(sep)+sep+'$');
}

export function escapeRegExp(value){return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
