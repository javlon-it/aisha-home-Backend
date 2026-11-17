import {Router} from 'express';
import mongoose from 'mongoose';
export const healthRouter=Router();
healthRouter.get('/',(req,res)=>{
 const connected=mongoose.connection.readyState===1;
 res.json({ok:true,service:'aisha-v2',database:connected?'connected':'not_connected',databaseReady:connected,catalogApi:connected?'available':'unavailable',businessApi:'partial'});
});
