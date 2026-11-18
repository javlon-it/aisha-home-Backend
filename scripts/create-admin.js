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
try{const username=(await ask('Admin login: ')).trim();rl.close();const password=await secret('Parol (ko’rsatilmaydi): ');const repeat=await secret('Parolni takrorlang: ');if(!username||username.length>100||password.length<16||password.length>256||password!==repeat)throw Error('Login yoki parol talabga mos emas');await connectDatabase(process.env.MONGODB_URI);await AdminAccount.init();await AdminAccount.create({singleton:'primary',username,passwordHash:await hashPassword(password),role:'admin'});console.log('Admin akkaunt yaratildi.');}catch(e){console.error(e.code===11000?'Admin akkaunt allaqachon mavjud.': 'Akkaunt yaratilmadi. Ma’lumotlar va ulanishni tekshiring.');process.exitCode=1}finally{rl.close();process.stdin.pause();await mongoose.disconnect()}
