-- Anwesenheiten nur noch serverseitig lesbar.
--
-- Ausgangslage: die Policy attendance_lesen erlaubte jedem angemeldeten Konto
-- (using(true)) das vollstaendige Lesen von kc_attendance_events - einer
-- Tabelle mit person_id, member_number, org_id, register_id und corrected_by.
-- Die vorhandene org_id deutet auf Mandantentrennung hin, die Policy ignoriert
-- sie aber. Eine sauber nach Organisation getrennte Regel ist heute nicht
-- formulierbar, weil keine Verknuepfung zwischen Anmeldekonto und Person oder
-- Organisation existiert.
--
-- Geprueft vor der Aenderung (2026-09-06): weder dp3 (KC DP2) noch die
-- Kasse-Suite noch KICC noch der System Check greifen auf diese Tabelle zu -
-- null Treffer in allen vier Bestaenden. Die Tabelle enthielt eine einzige
-- Testzeile. Es bricht also nichts.
--
-- Geschrieben wird weiterhin ueber service_role (Policy
-- attendance_schreiben_dienst), das RLS umgeht. Serverseitige Auswertung
-- bleibt damit vollstaendig moeglich.
--
-- Rueckgaengig machen, falls ein Programm die Tabelle doch aus dem Browser
-- lesen muss - dann aber bitte nach Organisation getrennt statt using(true):
--   create policy attendance_lesen on public.kc_attendance_events
--     for select to authenticated using (true);

drop policy if exists attendance_lesen on public.kc_attendance_events;

revoke all on table public.kc_attendance_events from anon, authenticated;

drop policy if exists attendance_deny_client on public.kc_attendance_events;
create policy attendance_deny_client on public.kc_attendance_events
for all to anon, authenticated
using (false)
with check (false);

comment on table public.kc_attendance_events is
  'Anwesenheitsereignisse mit Personenbezug. Kein Client-Zugriff: lesen und schreiben ausschliesslich serverseitig ueber service_role.';
