-- Datenvertrag nur noch serverseitig lesbar.
--
-- kc_core_data_contract beschreibt, welche Anwendung welchen Datenbereich
-- besitzt und ob sie ihn lesen oder schreiben darf - also den Bauplan der
-- Datenhoheit. Personenbezug hat die Tabelle keinen, aber die Policy
-- vertrag_lesen erlaubte jedem angemeldeten Konto (using(true)) den
-- vollstaendigen Blick darauf. Notwendig war das nie: geprueft am 2026-09-06
-- in dp3 (KC DP2), der Kasse-Suite, KICC und dem System Check - null Treffer,
-- kein Programm liest die Tabelle aus dem Browser.
--
-- Geschrieben und gelesen wird weiterhin serverseitig ueber service_role
-- (Policy vertrag_pflegen), das RLS umgeht.
--
-- Damit meldet die Sicherheitspruefung db_security keinen Befund mehr. Das ist
-- der eigentliche Zweck: eine Pruefung, die dauerhaft gelb steht, liest nach
-- zwei Wochen niemand mehr. Ab jetzt bedeutet Gelb "hier ist etwas Neues".
--
-- Rueckgaengig, falls ein Programm den Vertrag doch im Browser braucht:
--   create policy vertrag_lesen on public.kc_core_data_contract
--     for select to authenticated using (true);

drop policy if exists vertrag_lesen on public.kc_core_data_contract;

revoke all on table public.kc_core_data_contract from anon, authenticated;

drop policy if exists vertrag_deny_client on public.kc_core_data_contract;
create policy vertrag_deny_client on public.kc_core_data_contract
for all to anon, authenticated
using (false)
with check (false);

comment on table public.kc_core_data_contract is
  'Datenhoheit je Anwendung. Kein Client-Zugriff: lesen und schreiben ausschliesslich serverseitig ueber service_role.';
