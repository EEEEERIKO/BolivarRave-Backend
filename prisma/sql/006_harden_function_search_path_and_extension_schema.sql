-- Supabase linter hardening:
-- 1) Fix function_search_path_mutable warnings
-- 2) Move btree_gist extension out of public schema

begin;

create schema if not exists extensions;

-- Move extension if it is still in public.
do $$
begin
  if exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'btree_gist'
      and n.nspname = 'public'
  ) then
    alter extension btree_gist set schema extensions;
  end if;
end $$;

-- Harden search_path for trigger/validation functions in public.
-- Using explicit signature to avoid ambiguity.
alter function if exists public.validar_evento_por_tipo()
  set search_path = public, pg_temp;

alter function if exists public.verificar_solape_horario(
  uuid,
  uuid,
  public.dia_semana_enum,
  time,
  time,
  uuid
)
  set search_path = public, pg_temp;

alter function if exists public.trg_horarios_evento_no_solape()
  set search_path = public, pg_temp;

alter function if exists public.trg_eventos_revalidar_solape_por_fecha()
  set search_path = public, pg_temp;

commit;
