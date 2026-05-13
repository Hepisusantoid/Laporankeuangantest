// /api/debug-env.js
export default function handler(req, res){
  res.status(200).json({
    JSONBIN_BIN_ID: !!(process.env.JSONBIN_BIN_ID || process.env.NEXT_PUBLIC_JSONBIN_BIN_ID),
    JSONBIN_SECRET_KEY: !!process.env.JSONBIN_SECRET_KEY,
    JSONBIN_API_KEY: !!process.env.JSONBIN_API_KEY,
    ADMIN_PIN: !!(process.env.ADMIN_PIN || process.env.SECRET_ADMIN_PIN || process.env.NEXT_PUBLIC_ADMIN_PIN),
    vercel_env: process.env.VERCEL_ENV || 'unknown'
  });
}
