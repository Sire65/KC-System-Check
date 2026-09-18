-- KC DP: harden SECURITY DEFINER search paths without changing grants or authorization logic.
-- Only function configuration is changed; function bodies and EXECUTE privileges remain untouched.

alter function public.kc_dp_admin_push_settings_get()
  set search_path = pg_catalog, public;

alter function public.kc_dp_admin_push_settings_set(boolean, boolean, boolean)
  set search_path = pg_catalog, public;

alter function public.kc_dp_installation_admin_list(integer)
  set search_path = pg_catalog, public;
