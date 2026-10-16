-- KC Traffic Guard v2: zusaetzlicher Datenzeilen-Indikator (KEIN Egress-Abrechnungswert).
-- Additiv: alte KC-Check-Checks, Lastmessung und Club-Push bleiben unveraendert.
CREATE TABLE IF NOT EXISTS public.kc_traffic_guard_row_samples (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  measured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  total_rows bigint NOT NULL,
  rows_15m numeric,
  baseline_15m numeric,
  level text NOT NULL CHECK (level IN ('unknown','normal','warning','critical')),
  detail text NOT NULL
);
CREATE INDEX IF NOT EXISTS kc_traffic_guard_row_samples_latest
  ON public.kc_traffic_guard_row_samples (measured_at DESC);
ALTER TABLE public.kc_traffic_guard_row_samples ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kc_traffic_guard_row_samples FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.kc_traffic_guard_row_samples TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.kc_traffic_guard_row_samples_id_seq TO service_role;

CREATE TABLE IF NOT EXISTS public.kc_traffic_guard_row_alert (
  id integer PRIMARY KEY CHECK(id=1),
  last_level text NOT NULL DEFAULT 'normal',
  last_sent_at timestamptz,
  last_sample_id bigint
);
ALTER TABLE public.kc_traffic_guard_row_alert ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kc_traffic_guard_row_alert FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE,INSERT ON public.kc_traffic_guard_row_alert TO service_role;
INSERT INTO public.kc_traffic_guard_row_alert (id) VALUES (1) ON CONFLICT(id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.kc_traffic_guard_row_sample()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $body$
DECLARE
  total_now bigint:=0;
  previous_sample record;
  base numeric;
  seconds_between numeric;
  rows_per_15m numeric;
  alarm text:='unknown';
  explanation text:='Messbasis fuer Ergebnismengen wird aufgebaut';
  inserted_id bigint;
  prev_alarm text;
  prev_sent timestamptz;
  should_send boolean:=false;
BEGIN
 SELECT coalesce(sum(s.rows),0)::bigint INTO total_now
 FROM extensions.pg_stat_statements s
 WHERE s.dbid=(SELECT d.oid FROM pg_catalog.pg_database d WHERE d.datname=pg_catalog.current_database());
 SELECT id,measured_at,total_rows,level INTO previous_sample
 FROM public.kc_traffic_guard_row_samples ORDER BY measured_at DESC,id DESC LIMIT 1;
 SELECT avg(z.rows_15m) INTO base
 FROM (SELECT t.rows_15m FROM public.kc_traffic_guard_row_samples t
       WHERE t.rows_15m IS NOT NULL AND t.measured_at>pg_catalog.now()-interval '24 hours'
       ORDER BY t.measured_at DESC LIMIT 96) z;
 IF previous_sample.id IS NOT NULL THEN
   seconds_between:=extract(epoch FROM (clock_timestamp()-previous_sample.measured_at));
   IF seconds_between BETWEEN 120 AND 3600 AND total_now>=previous_sample.total_rows THEN
      rows_per_15m:=round((total_now-previous_sample.total_rows)*900.0/seconds_between);
      alarm:='normal';
      explanation:='Ergebnismengen innerhalb des Vergleichsbereichs';
      IF rows_per_15m>=150000 OR (rows_per_15m>=35000 AND base>0 AND rows_per_15m>=base*5) THEN
         alarm:='critical';
      ELSIF rows_per_15m>=65000 OR (rows_per_15m>=15000 AND base>0 AND rows_per_15m>=base*3) THEN
         alarm:='warning';
      END IF;
      IF alarm IN ('warning','critical') THEN
         explanation:='Auffaellige SQL-Ergebnismenge: '||rows_per_15m::text||
           ' Zeilen pro 15 Min. (kein Supabase-Egress-Messwert)';
      END IF;
   ELSE
      explanation:='Messabstand zu kurz/lang oder Statistiken zurueckgesetzt';
   END IF;
 END IF;
 INSERT INTO public.kc_traffic_guard_row_samples(total_rows,rows_15m,baseline_15m,level,detail)
 VALUES(total_now,rows_per_15m,base,alarm,explanation) RETURNING id INTO inserted_id;
 DELETE FROM public.kc_traffic_guard_row_samples WHERE measured_at<pg_catalog.now()-interval '7 days';
 SELECT last_level,last_sent_at INTO prev_alarm,prev_sent FROM public.kc_traffic_guard_row_alert WHERE id=1;
 IF alarm='normal' AND prev_alarm<>'normal' THEN
   UPDATE public.kc_traffic_guard_row_alert SET last_level='normal' WHERE id=1;
 END IF;
 IF alarm='critical' THEN
    should_send:=(prev_alarm IS DISTINCT FROM 'critical' OR prev_sent IS NULL
                  OR prev_sent < pg_catalog.now()-interval '6 hours');
 ELSIF alarm='warning' AND previous_sample.level IN ('warning','critical') THEN
    should_send:=(prev_alarm IS DISTINCT FROM 'warning' AND prev_alarm IS DISTINCT FROM 'critical');
 END IF;
 RETURN jsonb_build_object('sample_id',inserted_id,'level',alarm,'rows_15m',rows_per_15m,
   'baseline_15m',base,'detail',explanation,'measured_at',pg_catalog.now(),'notify',should_send,
   'is_billing_egress',false);
END;
$body$;
REVOKE ALL ON FUNCTION public.kc_traffic_guard_row_sample() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kc_traffic_guard_row_sample() TO service_role;

CREATE OR REPLACE FUNCTION public.kc_traffic_guard_row_ack(p_sample_id bigint,p_level text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $body$
BEGIN
 IF p_level NOT IN ('warning','critical') THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.kc_traffic_guard_row_samples
               WHERE id=p_sample_id AND level=p_level) THEN RETURN false; END IF;
 UPDATE public.kc_traffic_guard_row_alert
 SET last_level=p_level,last_sent_at=pg_catalog.now(),last_sample_id=p_sample_id WHERE id=1;
 RETURN true;
END;
$body$;
REVOKE ALL ON FUNCTION public.kc_traffic_guard_row_ack(bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kc_traffic_guard_row_ack(bigint,text) TO service_role;

CREATE OR REPLACE FUNCTION public.kc_traffic_guard_row_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $body$
 SELECT jsonb_build_object('level', CASE WHEN s.id IS NULL
   OR s.measured_at<pg_catalog.now()-interval '50 minutes' THEN 'unknown' ELSE s.level END,
   'rows_15m',s.rows_15m,'baseline_15m',s.baseline_15m,'measured_at',s.measured_at,
   'detail', CASE WHEN s.id IS NULL OR s.measured_at<pg_catalog.now()-interval '50 minutes'
    THEN 'Keine aktuelle Zeilenmessung' ELSE s.detail END,
   'is_billing_egress',false)
 FROM public.kc_traffic_guard_row_alert a
 LEFT JOIN LATERAL (SELECT * FROM public.kc_traffic_guard_row_samples
                    ORDER BY measured_at DESC,id DESC LIMIT 1) s ON true
 WHERE a.id=1;
$body$;
REVOKE ALL ON FUNCTION public.kc_traffic_guard_row_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kc_traffic_guard_row_status() TO service_role;