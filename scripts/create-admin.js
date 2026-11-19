import 'dotenv/config';
import readline from 'node:readline';
import mongoose from 'mongoose';
import {connectDatabase} from '../src/config/database.js';
import {AdminAccount} from '../src/models/index.js';
import {hashPassword} from '../src/routes/admin.js';
if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('Interactive terminal required');
if(!process.env.MONGODB_URI||!process.env.MONGODB_DB_NAME)throw Error('Set MONGODB_URI and MONGODB_DB_NAME explicitly');
const rl=readline.createInterface({input:process.stdin,output:process.stdout});
const ask=q=>new Promise(resolve=>rl.question(q,resolve));
async function secret(q){process.stdout.write(q);return new Promise((resolve,reject)=>{let value='';process.stdin.setRawMode(true);process.stdin.resume();function onData(buf){for(const c of buf.toString('utf8')){if(c==='\u0003'){cleanup();reject(Error('Cancelled'));return}if(c==='\r'||c==='\n'){cleanup();process.stdout.write('\n');resolve(value);return}if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else if(c>=' ')value+=c}}function cleanup(){process.stdin.removeListener('data',onData);process.stdin.setRawMode(false)}process.stdin.on('data',onData)})}
let stage='input';
try{
 const username=(await ask('Admin login: ')).trim();
 rl.close();
 const password=await secret('Parol (ko’rsatilmaydi): ');
 const repeat=await secret('Parolni takrorlang: ');
 if(!username||username.length>100){console.error('Login bo‘sh bo‘lmasligi va 100 belgidan oshmasligi kerak.');process.exitCode=1}
 else if(password.length<6||password.length>256){console.error('Parol uzunligi 6–256 belgi bo‘lishi kerak.');process.exitCode=1}
 else if(password!==repeat){console.error('Parollar bir-biriga mos kelmadi.');process.exitCode=1}
 else{
  stage='connection';await connectDatabase(process.env.MONGODB_URI);
  stage='initialization';await AdminAccount.init();
  stage='hash';const passwordHash=await hashPassword(password);
  stage='create';await AdminAccount.create({singleton:'primary',username,passwordHash,role:'admin'});
  console.log('Admin akkaunt yaratildi.');
 }
}catch(e){
 if(stage==='input')console.error('Ma’lumot kiritish bekor qilindi yoki terminalda xato yuz berdi.');
 else if(stage==='connection')console.error('MongoDB ulanmadi. Ulanish sozlamasi, tarmoq va Atlas ruxsatlarini tekshiring.');
 else if(stage==='initialization')console.error('Admin kolleksiyasi yoki indeksini tayyorlab bo‘lmadi. Bazaga ruxsat va indeks holatini tekshiring.');
 else if(stage==='hash')console.error('Parol himoyasini tayyorlab bo‘lmadi. Tizim resurslarini tekshiring.');
 else if(stage==='create'&&e.code===11000)console.error('Admin akkaunt allaqachon mavjud.');
 else console.error('Admin akkauntni bazada yaratib bo‘lmadi. Yozish ruxsati va baza holatini tekshiring.');
 process.exitCode=1;
}finally{rl.close();process.stdin.pause();await mongoose.disconnect()}
