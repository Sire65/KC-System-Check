drop policy if exists kc_system_check_history_deny_anon on public.kc_system_check_history;
create policy kc_system_check_history_deny_anon on public.kc_system_check_history
for all to anon, authenticated
using (false)
with check (false);
