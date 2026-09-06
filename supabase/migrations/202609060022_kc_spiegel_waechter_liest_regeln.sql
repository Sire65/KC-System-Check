-- Der Waechter fuehrte eine handgeschriebene Liste.
--
-- kc_internal.kc_db_mirror_watchdog() hatte 36 Tabellennamen fest im Quelltext.
-- Gespiegelt werden 48: die zwoelf kc_communication_* kamen spaeter dazu und
-- standen nie in der Liste. Sie waren nicht ungeprueft - der zweite Waechter
-- (kc_db_mirror_source_check, alle 15 Minuten) liest die Regeltabelle -, aber
-- die Liste driftet bei jeder neuen Tabelle erneut auseinander, und niemand
-- merkt es, weil eine zu kurze Liste immer "alles frisch" meldet.
--
-- Neu: dieselbe Quelle wie beim Spiegeln selbst, kc_db_mirror_table_rules mit
-- mirror_enabled. Eine neue gespiegelte Tabelle ist damit ab dem ersten Lauf
-- ueberwacht, ohne dass jemand daran denken muss.
--
-- Zweite Aenderung: die Meldung nennt die betroffenen Tabellen. "35/36 frisch"
-- ist eine Zahl, keine Antwort - wer nachsehen will, welche fehlt, musste
-- bisher von Hand in kc_db_mirror_runs suchen.
--
-- Dritte Aenderung: eine leere Regeltabelle meldet nicht mehr "0/0 frisch,
-- alles gut". Wer nichts ueberwacht, hat nichts bestaetigt.

create or replace function kc_internal.kc_db_mirror_watchdog()
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'kc_internal'
as $function$
declare
  v_expected text[];
  v_erwartet int;
  v_bad integer := 0;
  v_fresh integer := 0;
  v_namen text[];
  v_liste text;
  v_message text;
  v_fenster interval := kc_internal.kc_db_mirror_frischefenster();
  v_fenster_min int := ceil(extract(epoch from v_fenster) / 60)::int;
begin
  select coalesce(array_agg(table_name order by table_name), '{}'::text[])
    into v_expected
  from public.kc_db_mirror_table_rules
  where mirror_enabled;
  v_erwartet := coalesce(array_length(v_expected, 1), 0);

  if v_erwartet = 0 then
    v_message := 'Mirror-Watchdog: keine gespiegelte Tabelle hinterlegt (kc_db_mirror_table_rules.mirror_enabled). Es wird nichts überwacht.';
    insert into public.kc_db_mirror_runs(run_type,status,started_at,finished_at,mismatch_count,message,metrics)
    values('watchdog','warning',now(),now(),0,v_message,
           jsonb_build_object('expected_tables',0,'freshness_minutes',v_fenster_min));
    insert into public.kc_db_mirror_audit(severity,action,detail,metadata)
    values('warning','mirror_watchdog',v_message,jsonb_build_object('expected_tables',0));
    return;
  end if;

  with expected(table_name) as (select unnest(v_expected)), latest as (
    select e.table_name,r.status,r.finished_at,r.mismatch_count
    from expected e
    left join lateral (
      select status,finished_at,mismatch_count
      from public.kc_db_mirror_runs
      where run_type='snapshot' and metrics->>'table'=e.table_name
      order by started_at desc limit 1
    ) r on true
  )
  select count(*) filter(where status='ok' and coalesce(mismatch_count,0)=0 and finished_at>=now()-v_fenster),
         count(*) filter(where status is null or status<>'ok' or coalesce(mismatch_count,0)>0 or finished_at<now()-v_fenster),
         coalesce(array_agg(table_name order by finished_at nulls first)
           filter(where status is null or status<>'ok' or coalesce(mismatch_count,0)>0 or finished_at<now()-v_fenster),
           '{}'::text[])
  into v_fresh,v_bad,v_namen from latest;

  if v_bad=0 then
    v_message:=format('Mirror-Watchdog OK: %s/%s Tabellen frisch und fehlerfrei (Fenster %s Minuten).',v_fresh,v_erwartet,v_fenster_min);
    insert into public.kc_db_mirror_runs(run_type,status,started_at,finished_at,mismatch_count,message,metrics)
    values('watchdog','ok',now(),now(),0,v_message,
           jsonb_build_object('fresh_tables',v_fresh,'expected_tables',v_erwartet,'freshness_minutes',v_fenster_min));
  else
    v_liste:=array_to_string(v_namen[1:5],', ')||case when array_length(v_namen,1)>5 then ' …' else '' end;
    v_message:=format('Mirror-Watchdog WARNING: %s/%s Tabellen frisch (Fenster %s Minuten); %s Tabelle(n) fehlen, sind veraltet oder fehlerhaft: %s. Der nächste reguläre Spiegellauf wiederholt automatisch.',v_fresh,v_erwartet,v_fenster_min,v_bad,v_liste);
    insert into public.kc_db_mirror_runs(run_type,status,started_at,finished_at,mismatch_count,message,metrics)
    values('watchdog','warning',now(),now(),v_bad,v_message,
           jsonb_build_object('fresh_tables',v_fresh,'expected_tables',v_erwartet,'problem_tables',v_bad,
                              'problem_table_names',to_jsonb(v_namen),'freshness_minutes',v_fenster_min,
                              'retry_strategy','next_scheduled_run'));
    insert into public.kc_db_mirror_audit(severity,action,detail,metadata)
    values('warning','mirror_watchdog',v_message,
           jsonb_build_object('fresh_tables',v_fresh,'expected_tables',v_erwartet,'problem_tables',v_bad,
                              'problem_table_names',to_jsonb(v_namen),'retry_strategy','next_scheduled_run'));
  end if;
end;
$function$;
