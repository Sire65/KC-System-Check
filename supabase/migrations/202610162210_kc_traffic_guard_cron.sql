-- KC Traffic Guard: alle 15 Minuten, drei Minuten nach dem bestehenden KC Check.
-- Auth-Geheimnis liegt ausschliesslich im Supabase Vault; kein Klartext in cron.job.
SELECT cron.schedule('kc-traffic-guard-15m','3,18,33,48 * * * *',
$job$
 SELECT net.http_post(
   url:='https://ptblnpiroqftcvlsrhac.supabase.co/functions/v1/kc-traffic-guard',
   headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-kc-watch',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='kc_traffic_guard_cron' LIMIT 1)
   ),
   body:='{}'::jsonb,
   timeout_milliseconds:=10000
 );
$job$);