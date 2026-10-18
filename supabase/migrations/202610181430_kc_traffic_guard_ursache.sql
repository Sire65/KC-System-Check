-- KC Traffic Guard v3 – Ursachenhinweis und Push-Bremse fuer geplante Lastspitzen (18.10.2026, Freigabe Hansi „4 bauen“)
-- Befund (Pruefbericht 18.10.2026): Jeder Neubau des Club-Notfallpakets (taeglich um Mitternacht und nach Datenaenderungen,
-- hoechstens 1x je Stunde) und jede neue App-Version (alle offenen Apps starten neu) erzeugen eine Lastspitze. Der Waechter meldete
-- diese geplanten Spitzen als „kritisch“, ohne Ursache. Folge: Fehlalarme, echte Spitzen gehen im Rauschen unter.
-- Neu:
--   1. kc_traffic_guard_ursache(): ordnet eine auffaellige Messung bekannten Ereignissen im Messfenster zu
--      (Protokoll notpaket_gebaut mit gemessenen DB-Abfragen, App-Starts, Datensicherungslaeufe, Tageswechsel) und schaetzt,
--      welchen Anteil der Mehrlast sie erklaeren. Unbekannte Ursache wird als solche benannt, nie verschwiegen.
--   2. Die Messung speichert die Ursache (Spalte ursache) und haengt sie an den Hinweistext.
--   3. Push-Regeln: GELB aus geplanter Ursache zaehlt nicht fuer „zwei Messungen in Folge“. ROT wird nur dann nicht gepusht,
--      wenn die geplante Ursache mindestens 80 % der Mehrlast erklaert UND die Last unter 40.000 SQL-Aufrufen / 15 Min. bleibt.
--      Alle anderen ROT-Messungen werden wie bisher sofort gemeldet – jetzt mit Ursache. Ergebniszeilen-ROT wird nie unterdrueckt.
--   Die Messwerte selbst, Schwellen, Statusanzeige (level) und Quittierung bleiben unveraendert. Keine Aenderung an Datensicherung,
--   Spiegelung, Notbetrieb oder KC Communicator.
-- Rueckweg: supabase/migrations/202610162200_kc_traffic_guard_sampler.sql und 202610162245_kc_traffic_guard_rows.sql erneut
-- einspielen (Funktionsstaende vor v3); die Spalten ursache und die Funktion kc_traffic_guard_ursache stoeren dann nicht.

ALTER TABLE public.kc_traffic_guard_samples ADD COLUMN IF NOT EXISTS ursache jsonb;
ALTER TABLE public.kc_traffic_guard_row_samples ADD COLUMN IF NOT EXISTS ursache jsonb;

CREATE OR REPLACE FUNCTION public.kc_traffic_guard_zahl(p numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $q$ SELECT pg_catalog.replace(pg_catalog.to_char(pg_catalog.round(p),'FM999,999,999,990'),',','.') $q$;
REVOKE ALL ON FUNCTION public.kc_traffic_guard_zahl(numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kc_traffic_guard_zahl(numeric) TO service_role;

-- p_seit/p_bis: Messfenster (p_bis NULL = jetzt; fuer Pruefungen alter Messungen); p_wert/p_basis: SQL-Aufrufe je 15 Min. und
-- 24-h-Durchschnitt (NULL bei der Zeilenmessung).
CREATE OR REPLACE FUNCTION public.kc_traffic_guard_ursache(p_seit timestamptz, p_wert numeric, p_basis numeric, p_bis timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_np int := 0;
  v_np_abfragen bigint := 0;
  v_np_grund text;
  v_starts int := 0;
  v_alt int := 0;
  v_backup int := 0;
  v_restore int := 0;
  v_tageswechsel boolean;
  v_teile text[] := '{}';
  v_quellen text[] := '{}';
  v_schaetzung numeric := 0;
  v_anteil numeric;
  v_geplant boolean := false;
  v_sonst text;
  v_text text;
  v_bis timestamptz := coalesce(p_bis, pg_catalog.now());
BEGIN
  -- Notfall-Paket: gemessene REST-Abfragen des Neubaus; eine REST-Abfrage kostet in pg_stat_statements rund 2 SQL-Aufrufe
  -- (Messung 18.10.2026 13:18: 3.365 REST-Abfragen, 7.438 SQL-Aufrufe Mehrlast).
  SELECT count(*), coalesce(sum(nullif(p.details->>'db_abfragen','')::bigint),0), pg_catalog.string_agg(DISTINCT p.details->>'grund', ',')
    INTO v_np, v_np_abfragen, v_np_grund
    FROM public.kc_club_protokoll p
   WHERE p.aktion = 'notpaket_gebaut' AND p.zeit BETWEEN p_seit AND v_bis;
  -- App-Starts: rund 71 REST-Abfragen je Start (Server-Log {"db":"init"}, 18.10.2026)
  SELECT count(*) FILTER (WHERE p.aktion = 'app_start'),
         count(*) FILTER (WHERE p.aktion IN ('fehler_alte_version','aenderungen_angesehen'))
    INTO v_starts, v_alt
    FROM public.kc_club_protokoll p
   WHERE p.zeit BETWEEN p_seit AND v_bis AND p.aktion IN ('app_start','fehler_alte_version','aenderungen_angesehen');
  SELECT count(*) FILTER (WHERE r.run_type IN ('backup','snapshot')), count(*) FILTER (WHERE r.run_type = 'restore_test')
    INTO v_backup, v_restore
    FROM public.kc_db_mirror_runs r
   WHERE r.started_at BETWEEN p_seit AND v_bis AND r.run_type IN ('backup','snapshot','restore_test');
  v_tageswechsel := (v_bis AT TIME ZONE 'Europe/Berlin')::time < time '00:25';

  IF v_np > 0 THEN
    v_geplant := true;
    v_quellen := v_quellen || 'notpaket'::text;
    v_schaetzung := v_schaetzung + v_np_abfragen * 2;
    v_teile := v_teile || ('Neubau Notfall-Paket ('||v_np||'x, '||public.kc_traffic_guard_zahl(v_np_abfragen)||' Abfragen'
               ||CASE WHEN v_np_grund IS NOT NULL THEN ', '||pg_catalog.replace(v_np_grund,'_',' ') ELSE '' END||')');
  END IF;
  IF v_starts >= 5 OR v_alt >= 2 THEN
    v_geplant := true;
    v_quellen := v_quellen || 'neue_version'::text;
    v_schaetzung := v_schaetzung + v_starts * 140;
    v_teile := v_teile || (v_starts||' App-Starts'||CASE WHEN v_alt > 0 THEN ' nach neuer Version' ELSE '' END);
  ELSIF v_starts > 0 THEN
    v_schaetzung := v_schaetzung + v_starts * 140;
  END IF;
  IF v_backup >= 5 OR v_restore > 0 THEN
    v_geplant := true;
    v_quellen := v_quellen || 'datensicherung'::text;
    v_teile := v_teile || ('Datensicherung ('||v_backup||' Tabellenlaeufe'||CASE WHEN v_restore > 0 THEN ', Ruecklesetest' ELSE '' END||')');
  END IF;
  IF v_tageswechsel AND v_np = 0 THEN
    v_geplant := true;
    v_quellen := v_quellen || 'tageswechsel'::text;
    v_teile := v_teile || 'Tageswechsel (naechtliche Aufgaben)'::text;
  END IF;

  IF v_schaetzung > 0 AND p_wert IS NOT NULL AND p_basis IS NOT NULL AND p_wert > p_basis THEN
    v_anteil := LEAST(1, pg_catalog.round(v_schaetzung / (p_wert - p_basis), 2));
  END IF;

  IF NOT v_geplant THEN
    SELECT pg_catalog.string_agg(z.aktion||' '||z.c, ', ' ORDER BY z.c DESC) INTO v_sonst
      FROM (SELECT p.aktion, count(*) c FROM public.kc_club_protokoll p
             WHERE p.zeit BETWEEN p_seit AND v_bis AND p.aktion NOT LIKE 'spur%' AND p.aktion NOT LIKE 'diagnose%'
             GROUP BY p.aktion ORDER BY count(*) DESC LIMIT 3) z;
    v_text := 'Ursache unbekannt – bitte pruefen.'||CASE WHEN v_sonst IS NOT NULL THEN ' Haeufigste Club-Aktionen: '||v_sonst||'.' ELSE '' END;
  ELSE
    v_text := 'Vermutliche Ursache (geplant): '||pg_catalog.array_to_string(v_teile, '; ')
              ||CASE WHEN v_anteil IS NOT NULL THEN ', erklaert etwa '||(v_anteil*100)::int||' % der Mehrlast' ELSE '' END||'.';
  END IF;

  RETURN pg_catalog.jsonb_build_object('geplant', v_geplant, 'anteil', v_anteil, 'quellen', pg_catalog.to_jsonb(v_quellen),
    'text', v_text, 'seit', p_seit, 'bis', v_bis);
END;
$fn$;
REVOKE ALL ON FUNCTION public.kc_traffic_guard_ursache(timestamptz,numeric,numeric,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kc_traffic_guard_ursache(timestamptz,numeric,numeric,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.kc_traffic_guard_sample()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
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
 v_ursache jsonb;
 v_geplant boolean := false;
 v_gebremst boolean := false;
BEGIN
 SELECT COALESCE(SUM(calls),0)::bigint INTO v_calls FROM extensions.pg_stat_statements
  WHERE dbid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database());
 SELECT (x.xact_commit+x.xact_rollback)::bigint INTO v_tx
  FROM pg_catalog.pg_stat_database x WHERE x.datname=pg_catalog.current_database();
 SELECT s.id,s.measured_at,s.total_calls,s.total_transactions,s.level,s.ursache
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
       -- KC Traffic Guard v3: Ursache im Messfenster; ein Fehler hier darf die Messung nie verhindern.
       BEGIN
         v_ursache:=public.kc_traffic_guard_ursache(v_prev.measured_at-INTERVAL '2 minutes',v_per15,v_baseline);
         v_detail:=v_detail||' '||(v_ursache->>'text');
         v_geplant:=coalesce((v_ursache->>'geplant')::boolean,false);
       EXCEPTION WHEN OTHERS THEN
         v_ursache:=pg_catalog.jsonb_build_object('geplant',false,'text','Ursache nicht ermittelbar');
       END;
     END IF;
   ELSE
     v_detail:='Statistikzaehler zurueckgesetzt oder Messabstand ungueltig';
   END IF;
 END IF;
 INSERT INTO public.kc_traffic_guard_samples (total_calls,total_transactions,calls_15m,transactions_15m,baseline_15m,level,detail,ursache)
 VALUES (v_calls,v_tx,v_per15,v_txper15,v_baseline,v_level,v_detail,v_ursache) RETURNING id INTO v_id;
 DELETE FROM public.kc_traffic_guard_samples WHERE measured_at<pg_catalog.now()-INTERVAL '7 days';
 SELECT last_alert_level,last_alert_at INTO v_last,v_last_at
   FROM public.kc_traffic_guard_alert_state WHERE id=1;
 IF v_level='normal' AND v_last<>'normal' THEN
   UPDATE public.kc_traffic_guard_alert_state SET last_alert_level='normal' WHERE id=1;
 END IF;
 IF v_level='critical' THEN
   v_notify:=v_last IS DISTINCT FROM 'critical' OR v_last_at IS NULL OR v_last_at<pg_catalog.now()-INTERVAL '6 hours';
   -- Geplante Spitze, die fast vollstaendig erklaert ist und unter der harten Obergrenze bleibt: kein Push.
   v_gebremst:=v_notify AND v_geplant AND coalesce((v_ursache->>'anteil')::numeric,0)>=0.8 AND v_per15<40000;
 ELSIF v_level='warning' AND v_prev.level IN ('warning','critical') THEN
   v_notify:=v_last IS DISTINCT FROM 'warning' AND v_last IS DISTINCT FROM 'critical';
   -- Zwei auffaellige Messungen in Folge zaehlen nur, wenn keine davon geplant ist.
   v_gebremst:=v_notify AND (v_geplant OR coalesce((v_prev.ursache->>'geplant')::boolean,false));
 END IF;
 IF v_gebremst THEN v_notify:=false; END IF;
 RETURN jsonb_build_object('sample_id',v_id,'level',v_level,'detail',v_detail,'calls_15m',v_per15,
   'transactions_15m',v_txper15,'baseline_15m',v_baseline,'measured_at',pg_catalog.now(),
   'notify',v_notify,'gebremst',v_gebremst,'ursache',v_ursache,
   'is_billing_egress',false,'billing_egress_gb',null,'billing_source','not_configured');
END;
$fn$;
REVOKE ALL ON FUNCTION public.kc_traffic_guard_sample() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kc_traffic_guard_sample() TO service_role;

CREATE OR REPLACE FUNCTION public.kc_traffic_guard_row_sample()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
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
  cause jsonb;
  planned boolean:=false;
  held boolean:=false;
BEGIN
 SELECT coalesce(sum(s.rows),0)::bigint INTO total_now
 FROM extensions.pg_stat_statements s
 WHERE s.dbid=(SELECT d.oid FROM pg_catalog.pg_database d WHERE d.datname=pg_catalog.current_database());
 SELECT id,measured_at,total_rows,level,ursache INTO previous_sample
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
         BEGIN
           cause:=public.kc_traffic_guard_ursache(previous_sample.measured_at-interval '2 minutes',NULL,NULL);
           explanation:=explanation||' '||(cause->>'text');
           planned:=coalesce((cause->>'geplant')::boolean,false);
         EXCEPTION WHEN OTHERS THEN
           cause:=jsonb_build_object('geplant',false,'text','Ursache nicht ermittelbar');
         END;
      END IF;
   ELSE
      explanation:='Messabstand zu kurz/lang oder Statistiken zurueckgesetzt';
   END IF;
 END IF;
 INSERT INTO public.kc_traffic_guard_row_samples(total_rows,rows_15m,baseline_15m,level,detail,ursache)
 VALUES(total_now,rows_per_15m,base,alarm,explanation,cause) RETURNING id INTO inserted_id;
 DELETE FROM public.kc_traffic_guard_row_samples WHERE measured_at<pg_catalog.now()-interval '7 days';
 SELECT last_level,last_sent_at INTO prev_alarm,prev_sent FROM public.kc_traffic_guard_row_alert WHERE id=1;
 IF alarm='normal' AND prev_alarm<>'normal' THEN
   UPDATE public.kc_traffic_guard_row_alert SET last_level='normal' WHERE id=1;
 END IF;
 IF alarm='critical' THEN
    -- Ergebniszeilen-ROT wird nie gebremst (keine Mengenschaetzung fuer Zeilen).
    should_send:=(prev_alarm IS DISTINCT FROM 'critical' OR prev_sent IS NULL
                  OR prev_sent < pg_catalog.now()-interval '6 hours');
 ELSIF alarm='warning' AND previous_sample.level IN ('warning','critical') THEN
    should_send:=(prev_alarm IS DISTINCT FROM 'warning' AND prev_alarm IS DISTINCT FROM 'critical');
    held:=should_send AND (planned OR coalesce((previous_sample.ursache->>'geplant')::boolean,false));
    IF held THEN should_send:=false; END IF;
 END IF;
 RETURN jsonb_build_object('sample_id',inserted_id,'level',alarm,'rows_15m',rows_per_15m,
   'baseline_15m',base,'detail',explanation,'measured_at',pg_catalog.now(),'notify',should_send,
   'gebremst',held,'ursache',cause,'is_billing_egress',false);
END;
$function$;
REVOKE ALL ON FUNCTION public.kc_traffic_guard_row_sample() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kc_traffic_guard_row_sample() TO service_role;

-- Status: zusaetzlich „geplant“ fuer die Anzeige (Stufe level bleibt unveraendert).
CREATE OR REPLACE FUNCTION public.kc_traffic_guard_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $q$
 SELECT pg_catalog.jsonb_build_object(
   'level', CASE WHEN s.id IS NULL OR s.measured_at < pg_catalog.now()-INTERVAL '50 minutes' THEN 'unknown' ELSE s.level END,
   'measured_at',s.measured_at, 'calls_15m',s.calls_15m, 'baseline_15m',s.baseline_15m,
   'detail', CASE WHEN s.id IS NULL OR s.measured_at < pg_catalog.now()-INTERVAL '50 minutes' THEN 'Keine aktuelle Messung' ELSE s.detail END,
   'geplant', coalesce((s.ursache->>'geplant')::boolean,false) AND s.measured_at >= pg_catalog.now()-INTERVAL '50 minutes',
   'billing_egress_gb',NULL,'is_billing_egress',false,
   'last_alert_at',a.last_alert_at)
 FROM public.kc_traffic_guard_alert_state a
 LEFT JOIN LATERAL (SELECT * FROM public.kc_traffic_guard_samples ORDER BY measured_at DESC,id DESC LIMIT 1) s ON true
 WHERE a.id=1
$q$;
REVOKE ALL ON FUNCTION public.kc_traffic_guard_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kc_traffic_guard_status() TO service_role;

CREATE OR REPLACE FUNCTION public.kc_traffic_guard_row_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
 SELECT jsonb_build_object('level', CASE WHEN s.id IS NULL
   OR s.measured_at<pg_catalog.now()-interval '50 minutes' THEN 'unknown' ELSE s.level END,
   'rows_15m',s.rows_15m,'baseline_15m',s.baseline_15m,'measured_at',s.measured_at,
   'detail', CASE WHEN s.id IS NULL OR s.measured_at<pg_catalog.now()-interval '50 minutes'
    THEN 'Keine aktuelle Zeilenmessung' ELSE s.detail END,
   'geplant', coalesce((s.ursache->>'geplant')::boolean,false) AND s.measured_at >= pg_catalog.now()-interval '50 minutes',
   'is_billing_egress',false)
 FROM public.kc_traffic_guard_row_alert a
 LEFT JOIN LATERAL (SELECT * FROM public.kc_traffic_guard_row_samples
                    ORDER BY measured_at DESC,id DESC LIMIT 1) s ON true
 WHERE a.id=1;
$function$;
REVOKE ALL ON FUNCTION public.kc_traffic_guard_row_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kc_traffic_guard_row_status() TO service_role;
