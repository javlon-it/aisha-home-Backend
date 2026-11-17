import {Router} from 'express';
import mongoose from 'mongoose';
export const healthRouter=Router();
healthRouter.get('/',(req,res)=>{
 const connected=mongoose.connection.readyState===1;
 res.json({ok:true,service:'aisha-v2',database:connected?'connected':'not_connected',databaseReady:connected,catalogApi:connected?'available':'unavailable',businessApi:'partial'});
});
healthRouter.get('/live',(req,res)=>res.json({ok:true}));
healthRouter.get('/ready',(req,res)=>{
 const ready=mongoose.connection.readyState===1;
 res.status(ready?200:503).set('Cache-Control','no-store').json({ready});
});
