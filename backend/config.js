export const config={
  port:Number(process.env.PORT||8787),
  apiToken:process.env.KC_CHECK_API_TOKEN||"",
  supabase:{url:process.env.SUPABASE_URL||"",anonKey:process.env.SUPABASE_ANON_KEY||""},
  neon:{healthUrl:process.env.NEON_HEALTH_URL||"",healthToken:process.env.NEON_HEALTH_TOKEN||""},
  mirror:{endpoint:process.env.MIRROR_STATUS_URL||"",token:process.env.MIRROR_STATUS_TOKEN||""},
  b2:{enabled:process.env.B2_CHECK_ENABLED==="true"}
};
