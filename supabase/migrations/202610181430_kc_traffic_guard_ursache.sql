-- KC Traffic Guard v3 – Ursachenhinweis und Push-Bremse fuer geplante Lastspitzen (18.10.2026, Freigabe Hansi „4 bauen“)
-- Befund (Pruefbericht 18.10.2026): Jeder Neubau des Club-Notfallpakets (taeglich um Mitternacht und nach Datenaenderungen,
-- hoechstens 1x je Stunde) und jede neue App-Version (alle offenen Apps starten neu) erzeugen eine Lastspitze. Der Waechter meldete
-- diese geplanten Spitzen als „kritisch“, ohne Ursache. Folge: Fehlalarme, echte Spitzen gehen im Rauschen unter.
-- Neu:
--   1. kc_traffic_guard_ursache(): ordnet eine auffaellige Messung bekannten Ereignissen im Messfenster zu
--      (Protokoll notpaket_gebaut mit gemessenen DB-Abfragen, App-Starts, Datensicherungslaeufe, Tageswechsel) und schaetzt,
--      welchen Anteil der Mehrlast sie erklaeren. Unbekannte Ursache wird als solche benannt, nie verschwiegen.
--   2. kc_traffic_guard_ursache_merken(): haengt die Ursache an die gerade gespeicherte Messung (Spalte ursache, Hinweistext) und
--      sagt der Edge Function, ob der Push gebremst wird. Die Messfunktionen kc_traffic_guard_sample/_row_sample bleiben unveraendert.
--   3. Push-Regeln: GELB aus geplanter Ursache zaehlt nicht fuer „zwei Messungen in Folge“. ROT wird nur dann nicht gepusht,
--      wenn die geplante Ursache mindestens 80 % der Mehrlast erklaert UND die Last unter 40.000 SQL-Aufrufen / 15 Min. bleibt.
--      Alle anderen ROT-Messungen werden wie bisher sofort gemeldet – jetzt mit Ursache. Ergebniszeilen-ROT wird nie unterdrueckt.
--   Die Messwerte selbst, Schwellen, Statusanzeige (level) und Quittierung bleiben unveraendert. Keine Aenderung an Datensicherung,
--   Spiegelung, Notbetrieb oder KC Communicator.
-- Rueckweg: Edge Function kc-traffic-guard auf den Stand vor v3 zuruecksetzen (ruft ursache_merken dann nicht mehr auf);
-- Spalten ursache, Feld geplant im Status und die neuen Funktionen stoeren dann nicht.
-- Eingespielt 18.10.2026 in 4 Teilen: kc_traffic_guard_ursache_1_spalten, _2_funktion, _3_merken, _4_status.

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

-- Ursache an die gerade gespeicherte Messung haengen und Push-Bremse bestimmen (Aufruf aus der Edge Function nach den Messungen).
-- GELB: gebremst, wenn diese oder die vorige Messung eine geplante Ursache hat. ROT: gebremst nur bei geplanter Ursache,
-- >= 80 % erklaerter Mehrlast und < 40.000 SQL-Aufrufen / 15 Min. Ergebniszeilen-ROT wird nie gebremst.
CREATE OR REPLACE FUNCTION public.kc_traffic_guard_ursache_merken(p_sample_id bigint, p_row_sample_id bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  s record; v record; u jsonb; g boolean; br boolean;
  v_last jsonb := NULL; v_rows jsonb := NULL;
BEGIN
  SELECT * INTO s FROM public.kc_traffic_guard_samples WHERE id = p_sample_id;
  IF s.id IS NOT NULL AND s.level IN ('warning','critical') THEN
    SELECT * INTO v FROM public.kc_traffic_guard_samples WHERE measured_at < s.measured_at ORDER BY measured_at DESC, id DESC LIMIT 1;
    u := coalesce(s.ursache, public.kc_traffic_guard_ursache(coalesce(v.measured_at, s.measured_at - interval '15 minutes') - interval '2 minutes',
                                                             s.calls_15m, s.baseline_15m, s.measured_at));
    IF s.ursache IS NULL THEN
      UPDATE public.kc_traffic_guard_samples SET ursache = u, detail = s.detail || ' ' || (u->>'text') WHERE id = s.id;
    END IF;
    g := coalesce((u->>'geplant')::boolean, false);
    br := CASE WHEN s.level = 'critical'
               THEN g AND coalesce((u->>'anteil')::numeric, 0) >= 0.8 AND s.calls_15m < 40000
               ELSE g OR coalesce((v.ursache->>'geplant')::boolean, false) END;
    v_last := pg_catalog.jsonb_build_object('geplant', g, 'gebremst', br, 'text', u->>'text',
                                            'detail', s.detail || CASE WHEN s.ursache IS NULL THEN ' ' || (u->>'text') ELSE '' END);
  END IF;

  SELECT * INTO s FROM public.kc_traffic_guard_row_samples WHERE id = p_row_sample_id;
  IF s.id IS NOT NULL AND s.level IN ('warning','critical') THEN
    SELECT * INTO v FROM public.kc_traffic_guard_row_samples WHERE measured_at < s.measured_at ORDER BY measured_at DESC, id DESC LIMIT 1;
    u := coalesce(s.ursache, public.kc_traffic_guard_ursache(coalesce(v.measured_at, s.measured_at - interval '15 minutes') - interval '2 minutes',
                                                             NULL, NULL, s.measured_at));
    IF s.ursache IS NULL THEN
      UPDATE public.kc_traffic_guard_row_samples SET ursache = u, detail = s.detail || ' ' || (u->>'text') WHERE id = s.id;
    END IF;
    g := coalesce((u->>'geplant')::boolean, false);
    -- Ergebniszeilen-ROT wird nie gebremst.
    br := s.level = 'warning' AND (g OR coalesce((v.ursache->>'geplant')::boolean, false));
    v_rows := pg_catalog.jsonb_build_object('geplant', g, 'gebremst', br, 'text', u->>'text',
                                            'detail', s.detail || CASE WHEN s.ursache IS NULL THEN ' ' || (u->>'text') ELSE '' END);
  END IF;

  RETURN pg_catalog.jsonb_build_object('last', v_last, 'zeilen', v_rows);
END;
$fn$;
REVOKE ALL ON FUNCTION public.kc_traffic_guard_ursache_merken(bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.kc_traffic_guard_ursache_merken(bigint,bigint) TO service_role;

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
