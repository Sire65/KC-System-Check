CREATE OR REPLACE FUNCTION public.kc_traffic_guard_sample()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_calls bigint := 0;
 v_tx bigint := 0;
 v_prev record;
 v_dt numeric;
 v_per15 numeric;
 v_txper15 numeric;
 v_baseline numeric;
 v_level text := 'unknown';
 v_detail text := 'Messbasis wird aufgebaut';
 v_id bigint;
 v_last text;
 v_last_at timestamptz;
 v_notify boolean := false;
BEGIN
 SELECT COALESCE(SUM(calls),0)::bigint INTO v_calls FROM extensions.pg_stat_statements
  WHERE dbid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database());
 SELECT (x.xact_commit+x.xact_rollback)::bigint INTO v_tx
  FROM pg_catalog.pg_stat_database x WHERE x.datname=pg_catalog.current_database();
 SELECT s.id,s.measured_at,s.total_calls,s.total_transactions,s.level
  INTO v_prev FROM public.kc_traffic_guard_samples s
  ORDER BY s.measured_at DESC,s.id DESC LIMIT 1;
 SELECT AVG(q.calls_15m) INTO v_baseline FROM
  (SELECT s.calls_15m FROM public.kc_traffic_guard_samples s
    WHERE s.calls_15m IS NOT NULL AND s.measured_at>pg_catalog.now()-INTERVAL '24 hours'
    ORDER BY s.measured_at DESC LIMIT 96) q;
 IF v_prev.id IS NOT NULL THEN
   v_dt:=EXTRACT(EPOCH FROM (clock_timestamp()-v_prev.measured_at));
   IF v_dt BETWEEN 120 AND 3600 AND v_calls>=v_prev.total_calls AND v_tx>=v_prev.total_transactions THEN
     v_per15:=round((v_calls-v_prev.total_calls)*900.0/v_dt);
     v_txper15:=round((v_tx-v_prev.total_transactions)*900.0/v_dt);
     v_level:='normal';
     v_detail:='Datenbanklast unauffaellig (kein Egress-Abrechnungswert)';
     IF v_per15>=20000 OR (v_per15>=9000 AND v_baseline>0 AND v_per15>=v_baseline*3) THEN
       v_level:='critical';
     ELSIF v_per15>=10000 OR (v_per15>=4000 AND v_baseline>0 AND v_per15>=v_baseline*2.5) THEN
       v_level:='warning';
     END IF;
     IF v_level<>'normal' THEN
       v_detail:='Auffaellige Datenbanklast: '||v_per15::text||' SQL-Aufrufe / 15 Min.'
         ||CASE WHEN v_baseline>0 THEN ' (Durchschnitt '||round(v_baseline)::text||')' ELSE '' END
         ||'. Indikator, keine abrechenbaren Egress-GB.';
     END IF;
   ELSE
     v_detail:='Statistikzaehler zurueckgesetzt oder Messabstand ungueltig';
   END IF;
 END IF;
 INSERT INTO public.kc_traffic_guard_samples (total_calls,total_transactions,calls_15m,transactions_15m,baseline_15m,level,detail)
 VALUES (v_calls,v_tx,v_per15,v_txper15,v_baseline,v_level,v_detail) RETURNING id INTO v_id;
 DELETE FROM public.kc_traffic_guard_samples WHERE measured_at<pg_catalog.now()-INTERVAL '7 days';
 SELECT last_alert_level,last_alert_at INTO v_last,v_last_at
   FROM public.kc_traffic_guard_alert_state WHERE id=1;
 IF v_level='normal' AND v_last<>'normal' THEN
   UPDATE public.kc_traffic_guard_alert_state SET last_alert_level='normal' WHERE id=1;
 END IF;
 IF v_level='critical' THEN
   v_notify:=v_last IS DISTINCT FROM 'critical' OR v_last_at IS NULL OR v_last_at<pg_catalog.now()-INTERVAL '6 hours';
 ELSIF v_level='warning' AND v_prev.level IN ('warning','critical') THEN
   v_notify:=v_last IS DISTINCT FROM 'warning' AND v_last IS DISTINCT FROM 'critical';
 END IF;
 RETURN jsonb_build_object('sample_id',v_id,'level',v_level,'detail',v_detail,'calls_15m',v_per15,
   'transactions_15m',v_txper15,'baseline_15m',v_baseline,'measured_at',pg_catalog.now(),
   'notify',v_notify,'is_billing_egress',false,'billing_egress_gb',null,'billing_source','not_configured');
END;
$function$
;
