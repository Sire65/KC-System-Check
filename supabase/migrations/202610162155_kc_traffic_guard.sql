-- KC Traffic Guard v1: belastungsbasierte Fruehwarnung; KEINE abgerechneten Egress-Bytes.
-- Separate Tabellen und Funktionen, bestehende Checks und KC Club bleiben unberuehrt.
CREATE TABLE IF NOT EXISTS public.kc_traffic_guard_samples (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  measured_at timestamptz NOT NULL DEFAULT now(),
  total_calls bigint NOT NULL,
  total_transactions bigint NOT NULL,
  calls_15m numeric,
  transactions_15m numeric,
  baseline_15m numeric,
  level text NOT NULL CHECK (level IN ('unknown','normal','warning','critical')),
  detail text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS kc_traffic_guard_samples_latest ON public.kc_traffic_guard_samples (measured_at DESC);
ALTER TABLE public.kc_traffic_guard_samples ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kc_traffic_guard_samples FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.kc_traffic_guard_samples TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.kc_traffic_guard_samples_id_seq TO service_role;

CREATE TABLE IF NOT EXISTS public.kc_traffic_guard_alert_state (
 id integer PRIMARY KEY CHECK (id=1),
 last_alert_level text NOT NULL DEFAULT 'normal',
 last_alert_at timestamptz,
 last_sample_id bigint
);
ALTER TABLE public.kc_traffic_guard_alert_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kc_traffic_guard_alert_state FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.kc_traffic_guard_alert_state TO service_role;
INSERT INTO public.kc_traffic_guard_alert_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name='kc_traffic_guard_cron') THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(32),'hex'),'kc_traffic_guard_cron','Authentication for KC Traffic Guard 15-min cron');
  END IF;
END $do$;

CREATE OR REPLACE FUNCTION public.kc_traffic_guard_verify(p_token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $q$
 SELECT length(coalesce(p_token,''))=64
  AND EXISTS(SELECT 1 FROM vault.decrypted_secrets v WHERE v.name='kc_traffic_guard_cron' AND v.decrypted_secret=p_token)
$q$;
REVOKE ALL ON FUNCTION public.kc_traffic_guard_verify(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kc_traffic_guard_verify(text) TO service_role;

CREATE OR REPLACE FUNCTION public.kc_traffic_guard_sample()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
 c_total bigint; t_total bigint; previous public.kc_traffic_guard_samples%ROWTYPE;
 elapsed numeric; c_rate numeric; tx_rate numeric; baseline numeric;
 level_now text := 'unknown'; description text := 'Messbasis wird aufgebaut';
 rid bigint; last_level text; last_at timestamptz; notify_now boolean := false;
BEGIN
 SELECT coalesce(sum(s.calls),0)::bigint INTO c_total
   FROM extensions.pg_stat_statements s
   WHERE s.dbid=(SELECT d.oid FROM pg_catalog.pg_database d WHERE d.datname=pg_catalog.current_database());
 SELECT (x.xact_commit+x.xact_rollback)::bigint INTO t_total FROM pg_catalog.pg_stat_database x
   WHERE x.datname=pg_catalog.current_database();
 SELECT * INTO previous FROM public.kc_traffic_guard_samples ORDER BY measured_at DESC,id DESC LIMIT 1;
 SELECT pg_catalog.avg(recent.calls_15m)
   INTO baseline FROM (SELECT calls_15m FROM public.kc_traffic_guard_samples
     WHERE calls_15m IS NOT NULL AND measured_at > pg_catalog.now()-INTERVAL '24 hours'
     ORDER BY measured_at DESC LIMIT 96) recent;
 IF previous.id IS NOT NULL THEN
   elapsed:=pg_catalog.extract(epoch FROM (pg_catalog.clock_timestamp()-previous.measured_at));
   IF elapsed>=120 AND elapsed<=3600 AND c_total>=previous.total_calls AND t_total>=previous.total_transactions THEN
     c_rate:=pg_catalog.round((c_total-previous.total_calls)*900.0/elapsed);
     tx_rate:=pg_catalog.round((t_total-previous.total_transactions)*900.0/elapsed);
     level_now:='normal';
     description:='Datenbanklast unauffaellig (keine abrechenbaren Egress-Bytes)';
     IF c_rate>=20000 OR (c_rate>=9000 AND baseline IS NOT NULL AND baseline>0 AND c_rate>=baseline*3) THEN
       level_now:='critical';
     ELSIF c_rate>=10000 OR (c_rate>=4000 AND baseline IS NOT NULL AND baseline>0 AND c_rate>=baseline*2.5) THEN
       level_now:='warning';
     END IF;
     IF level_now IN ('warning','critical') THEN
       description:= 'Auffaellige SQL-Anfragen: ' || c_rate::text || ' pro 15 Minuten'
          || CASE WHEN baseline IS NULL OR baseline=0 THEN '' ELSE ' (Normalwert ca. '||pg_catalog.round(baseline)::text||')' END
          || '. Das ist ein Lastindikator, KEIN Supabase-Egress-Messwert.';
     END IF;
   ELSE
     description:='Zaehlerwechsel oder groesserer Messabstand; neue Messbasis erforderlich';
   END IF;
 END IF;
 INSERT INTO public.kc_traffic_guard_samples(total_calls,total_transactions,calls_15m,transactions_15m,baseline_15m,level,detail)
 VALUES(c_total,t_total,c_rate,tx_rate,baseline,level_now,description)
 RETURNING id INTO rid;
 DELETE FROM public.kc_traffic_guard_samples WHERE measured_at < pg_catalog.now()-INTERVAL '7 days';

 SELECT last_alert_level,last_alert_at INTO last_level,last_at
 FROM public.kc_traffic_guard_alert_state WHERE id=1;
 IF level_now='normal' AND last_level<>'normal' THEN
   UPDATE public.kc_traffic_guard_alert_state SET last_alert_level='normal' WHERE id=1;
 END IF;
 IF level_now='critical' THEN
   notify_now:=(last_level IS DISTINCT FROM 'critical' OR last_at IS NULL OR last_at < pg_catalog.now()-INTERVAL '6 hours');
 ELSIF level_now='warning' AND previous.level IN ('warning','critical') THEN
   notify_now:=(last_level IS DISTINCT FROM 'warning' AND last_level IS DISTINCT FROM 'critical');
 END IF;
 RETURN pg_catalog.jsonb_build_object('sample_id',rid,'level',level_now,'detail',description,
    'calls_15m',c_rate,'transactions_15m',tx_rate,'baseline_15m',baseline,
    'measured_at',pg_catalog.now(),'notify',notify_now,'is_billing_egress',false,
    'billing_egress_gb',null,'billing_source','not_configured');
END; $fn$;
REVOKE ALL ON FUNCTION public.kc_traffic_guard_sample() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kc_traffic_guard_sample() TO service_role;

CREATE OR REPLACE FUNCTION public.kc_traffic_guard_ack(p_sample_id bigint,p_level text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$ BEGIN
 IF p_level NOT IN ('warning','critical') THEN RETURN false; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.kc_traffic_guard_samples WHERE id=p_sample_id AND level=p_level) THEN RETURN false; END IF;
 UPDATE public.kc_traffic_guard_alert_state
 SET last_alert_level=p_level,last_alert_at=pg_catalog.now(),last_sample_id=p_sample_id WHERE id=1;
 RETURN true;
END; $fn$;
REVOKE ALL ON FUNCTION public.kc_traffic_guard_ack(bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kc_traffic_guard_ack(bigint,text) TO service_role;

CREATE OR REPLACE FUNCTION public.kc_traffic_guard_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $q$
 SELECT pg_catalog.jsonb_build_object(
   'level', CASE WHEN s.id IS NULL OR s.measured_at < pg_catalog.now()-INTERVAL '50 minutes' THEN 'unknown' ELSE s.level END,
   'measured_at',s.measured_at, 'calls_15m',s.calls_15m, 'baseline_15m',s.baseline_15m,
   'detail', CASE WHEN s.id IS NULL OR s.measured_at < pg_catalog.now()-INTERVAL '50 minutes' THEN 'Keine aktuelle Messung' ELSE s.detail END,
   'billing_egress_gb',NULL,'is_billing_egress',false,
   'last_alert_at',a.last_alert_at)
 FROM public.kc_traffic_guard_alert_state a
 LEFT JOIN LATERAL (SELECT * FROM public.kc_traffic_guard_samples ORDER BY measured_at DESC,id DESC LIMIT 1) s ON true
 WHERE a.id=1
$q$;
REVOKE ALL ON FUNCTION public.kc_traffic_guard_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kc_traffic_guard_status() TO service_role;
