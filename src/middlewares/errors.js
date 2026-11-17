export function notFound(req,res,next){res.status(404).json({error:{code:'NOT_FOUND',message:'Manzil topilmadi'}})}
export function errorHandler(err,req,res,next){if(res.headersSent)return next(err);const status=err.type==='entity.parse.failed'?400:500;res.status(status).json({error:{code:status===400?'INVALID_JSON':'INTERNAL_ERROR',message:status===400?'JSON noto‘g‘ri':'Server xatosi'}})}

