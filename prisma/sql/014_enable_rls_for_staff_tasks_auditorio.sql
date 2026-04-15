-- Supabase hardening patch for newly added public tables.
-- Enables RLS and limits direct PostgREST access to service_role only.
-- Safe to run multiple times.

begin;

do $$
declare
  tbl text;
  target_tables text[] := array[
    'reservas_auditorio',
    'horarios_intercalados_auditorio',
    'staff',
    'staff_bloqueos_clase',
    'staff_roles',
    'staff_credentials',
    'staff_habilidades',
    'staff_jornada_semanal',
    'staff_pausas_programadas',
    'staff_resumen_contrato',
    'habilidades',
    'tareas_catalogo',
    'tareas_catalogo_habilidades',
    'tareas_instancias',
    'tareas_asignaciones',
    'tareas_espacios_personalizados',
    'tareas_catalogo_staff',
    'tareas_catalogo_requerimientos',
    'horarios_evento_excepciones'
  ];
  has_anon boolean;
  has_authenticated boolean;
  has_service_role boolean;
begin
  select exists(select 1 from pg_roles where rolname = 'anon') into has_anon;
  select exists(select 1 from pg_roles where rolname = 'authenticated') into has_authenticated;
  select exists(select 1 from pg_roles where rolname = 'service_role') into has_service_role;

  foreach tbl in array target_tables loop
    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = tbl
        and c.relkind = 'r'
    ) then
      execute format('alter table public.%I enable row level security', tbl);

      if has_anon then
        execute format('revoke all on table public.%I from anon', tbl);
      end if;

      if has_authenticated then
        execute format('revoke all on table public.%I from authenticated', tbl);
      end if;

      if has_service_role and not exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = tbl
          and policyname = 'service_role_all_access'
      ) then
        execute format(
          'create policy %I on public.%I for all to service_role using (true) with check (true)',
          'service_role_all_access',
          tbl
        );
      end if;
    end if;
  end loop;
end $$;

commit;
