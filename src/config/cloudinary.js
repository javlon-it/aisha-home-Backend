import {v2 as cloudinary} from 'cloudinary';
export function configureCloudinary(env){const {CLOUDINARY_CLOUD_NAME:cloud_name,CLOUDINARY_API_KEY:api_key,CLOUDINARY_API_SECRET:api_secret}=env;if(!cloud_name||!api_key||!api_secret)return false;cloudinary.config({cloud_name,api_key,api_secret,secure:true});return true}

