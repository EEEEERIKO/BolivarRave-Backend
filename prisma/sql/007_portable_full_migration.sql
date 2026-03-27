-- Portable full migration for UNAC reservations schema.
-- Goal: one-file setup for a clean PostgreSQL server (including Supabase-like hardening).
-- Safe to run multiple times (idempotent).

begin;

-- Extensions
create schema if not exists extensions;
create extension if not exists pgcrypto;
create extension if not exists btree_gist with schema extensions;

-- If btree_gist was created in public, move it to extensions.
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

-- Core catalogs
create table if not exists public.facultades (
  id uuid primary key default gen_random_uuid(),
  nombre varchar(100) not null unique
);

create table if not exists public.salones (
  id uuid primary key default gen_random_uuid(),
  nombre_bloque varchar(120) not null unique,
  piso int,
  capacidad int,
  constraint salones_piso_chk check (piso is null or piso > 0),
  constraint salones_capacidad_chk check (capacidad is null or capacidad > 0)
);

create table if not exists public.tipos_reserva (
  id int primary key,
  nombre varchar(50) not null unique
);

insert into public.tipos_reserva (id, nombre)
values
  (1, 'Semestre'),
  (2, 'Momentanea'),
  (3, 'Iglesia')
on conflict (id) do update
set nombre = excluded.nombre;

-- Enum for weekly schedule
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'dia_semana_enum'
      and n.nspname = 'public'
  ) then
    create type public.dia_semana_enum as enum (
      'Lunes',
      'Martes',
      'Miercoles',
      'Jueves',
      'Viernes',
      'Sabado',
      'Domingo'
    );
  end if;
end $$;

-- Main transactional tables
create table if not exists public.eventos (
  id uuid primary key default gen_random_uuid(),
  tipo_reserva_id int not null references public.tipos_reserva(id),
  facultad_id uuid null references public.facultades(id),
  codigo_materia varchar(20),
  nombre_principal varchar(255) not null,
  responsable varchar(150) not null,
  actividad varchar(255),
  fecha_inicio date not null,
  fecha_fin date not null,
  fecha_creacion timestamptz not null default now(),
  constraint eventos_fechas_chk check (fecha_fin >= fecha_inicio)
);

create table if not exists public.horarios_evento (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos(id) on delete cascade,
  salon_id uuid not null references public.salones(id),
  dia_semana public.dia_semana_enum not null,
  hora_inicio time not null,
  hora_fin time not null,
  constraint horarios_evento_hora_chk check (hora_fin > hora_inicio)
);

create index if not exists idx_eventos_tipo on public.eventos(tipo_reserva_id);
create index if not exists idx_eventos_facultad on public.eventos(facultad_id);
create index if not exists idx_eventos_fechas on public.eventos(fecha_inicio, fecha_fin);
create index if not exists idx_horarios_evento_evento on public.horarios_evento(evento_id);
create index if not exists idx_horarios_evento_salon_dia on public.horarios_evento(salon_id, dia_semana);
create index if not exists idx_horarios_evento_horas on public.horarios_evento(hora_inicio, hora_fin);

-- Business validation by reservation type
create or replace function public.validar_evento_por_tipo()
returns trigger
language plpgsql
as $$
declare
  tipo_nombre text;
begin
  select tr.nombre into tipo_nombre
  from public.tipos_reserva tr
  where tr.id = new.tipo_reserva_id;

  if tipo_nombre is null then
    raise exception 'tipo_reserva_id invalido: %', new.tipo_reserva_id;
  end if;

  if tipo_nombre = 'Semestre' then
    if new.facultad_id is null then
      raise exception 'Semestre requiere facultad_id';
    end if;
    if coalesce(trim(new.codigo_materia), '') = '' then
      raise exception 'Semestre requiere codigo_materia';
    end if;
  end if;

  if tipo_nombre = 'Momentanea' then
    if new.fecha_inicio <> new.fecha_fin then
      raise exception 'Momentanea requiere fecha_inicio igual a fecha_fin';
    end if;
  end if;

  if tipo_nombre = 'Iglesia' then
    if new.facultad_id is not null then
      raise exception 'Iglesia no debe tener facultad_id';
    end if;
    if new.codigo_materia is not null then
      raise exception 'Iglesia no debe tener codigo_materia';
    end if;
    if coalesce(trim(new.actividad), '') = '' then
      raise exception 'Iglesia requiere actividad';
    end if;
  end if;

  return new;
end;
$$;

-- Overlap verification by room/day/time/date-range
create or replace function public.verificar_solape_horario(
  p_evento_id uuid,
  p_salon_id uuid,
  p_dia public.dia_semana_enum,
  p_hora_inicio time,
  p_hora_fin time,
  p_horario_id uuid default null
)
returns void
language plpgsql
as $$
declare
  v_nuevo_inicio date;
  v_nuevo_fin date;
  v_conflicto record;
begin
  select e.fecha_inicio, e.fecha_fin
    into v_nuevo_inicio, v_nuevo_fin
  from public.eventos e
  where e.id = p_evento_id;

  if v_nuevo_inicio is null then
    raise exception 'Evento no encontrado para validar solape: %', p_evento_id;
  end if;

  select h.id as horario_id, h.evento_id, e.nombre_principal
    into v_conflicto
  from public.horarios_evento h
  join public.eventos e on e.id = h.evento_id
  where h.salon_id = p_salon_id
    and h.dia_semana = p_dia
    and (p_hora_inicio < h.hora_fin and h.hora_inicio < p_hora_fin)
    and daterange(v_nuevo_inicio, v_nuevo_fin, '[]') && daterange(e.fecha_inicio, e.fecha_fin, '[]')
    and (p_horario_id is null or h.id <> p_horario_id)
  limit 1;

  if v_conflicto is not null then
    raise exception
      'Conflicto de solape: salon %, dia %, horario %-% con evento %',
      p_salon_id, p_dia, p_hora_inicio, p_hora_fin, v_conflicto.nombre_principal;
  end if;
end;
$$;

create or replace function public.trg_horarios_evento_no_solape()
returns trigger
language plpgsql
as $$
begin
  perform public.verificar_solape_horario(
    new.evento_id,
    new.salon_id,
    new.dia_semana,
    new.hora_inicio,
    new.hora_fin,
    new.id
  );

  return new;
end;
$$;

create or replace function public.trg_eventos_revalidar_solape_por_fecha()
returns trigger
language plpgsql
as $$
declare
  r record;
begin
  if new.fecha_inicio = old.fecha_inicio and new.fecha_fin = old.fecha_fin then
    return new;
  end if;

  for r in
    select h.id, h.salon_id, h.dia_semana, h.hora_inicio, h.hora_fin
    from public.horarios_evento h
    where h.evento_id = new.id
  loop
    perform public.verificar_solape_horario(
      new.id,
      r.salon_id,
      r.dia_semana,
      r.hora_inicio,
      r.hora_fin,
      r.id
    );
  end loop;

  return new;
end;
$$;

-- Supabase linter hardening for mutable search_path
alter function public.validar_evento_por_tipo()
  set search_path = public, pg_temp;

alter function public.verificar_solape_horario(
  uuid,
  uuid,
  public.dia_semana_enum,
  time,
  time,
  uuid
)
  set search_path = public, pg_temp;

alter function public.trg_horarios_evento_no_solape()
  set search_path = public, pg_temp;

alter function public.trg_eventos_revalidar_solape_por_fecha()
  set search_path = public, pg_temp;

drop trigger if exists trg_validar_evento_por_tipo on public.eventos;
create trigger trg_validar_evento_por_tipo
before insert or update on public.eventos
for each row
execute function public.validar_evento_por_tipo();

drop trigger if exists trg_horarios_evento_no_solape on public.horarios_evento;
create trigger trg_horarios_evento_no_solape
before insert or update on public.horarios_evento
for each row
execute function public.trg_horarios_evento_no_solape();

drop trigger if exists trg_eventos_revalidar_solape_por_fecha on public.eventos;
create trigger trg_eventos_revalidar_solape_por_fecha
before update of fecha_inicio, fecha_fin on public.eventos
for each row
execute function public.trg_eventos_revalidar_solape_por_fecha();

-- RLS hardening (only if roles exist; works in non-Supabase too)
do $$
declare
  tbl text;
  target_tables text[] := array[
    'tipos_reserva',
    'horarios_evento',
    'eventos',
    'salones',
    'facultades'
  ];
  has_anon boolean;
  has_authenticated boolean;
  has_service_role boolean;
begin
  select exists(select 1 from pg_roles where rolname = 'anon') into has_anon;
  select exists(select 1 from pg_roles where rolname = 'authenticated') into has_authenticated;
  select exists(select 1 from pg_roles where rolname = 'service_role') into has_service_role;

  foreach tbl in array target_tables loop
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
  end loop;
end $$;

-- Base faculties
insert into public.facultades (nombre)
values
  ('Facultad de Ciencias Administrativas y Contables'),
  ('Facultad de Ciencias Humanas y de la Educacion'),
  ('Facultad de Ciencias de la Salud'),
  ('Facultad de Ingenieria'),
  ('Facultad de Teologia y Religion')
on conflict (nombre) do nothing;

-- Official rooms catalog
insert into public.salones (nombre_bloque, piso, capacidad)
values
  ('Aula Foro Union 101', 1, 60),
  ('Aula Foro Unac 102', 1, 60),
  ('Sala Informatica 1 Bolivar', 1, 25),
  ('Sala Informatica 2 Bolivar', 1, 25),
  ('Salon 201', 2, 40),
  ('Salon 202', 2, 40),
  ('Salon 203', 2, 40),
  ('Laboratorio de Infantil 204', 2, 40),
  ('Salon 205', 2, 46),
  ('Salon 206', 2, 40),
  ('Salon 301', 3, 40),
  ('Salon 302', 3, 62),
  ('Salon 303', 3, 48),
  ('Salon 304', 3, 40),
  ('Salon 305', 3, 69),
  ('Laboratorio de Musica 308', 3, null),
  ('Salon 401', 4, 40),
  ('Salon 402', 4, 45),
  ('Laboratorio de simulacion financiera 403', 4, 40),
  ('Laboratorio de Desarrollo de Software (LDS) 404', 4, 40),
  ('Laboratorio de Fisica 405', 4, 44),
  ('Salon 406', 4, 42),
  ('Aula Interamericana 501', 5, 55),
  ('Aula Interamericana 502', 5, 55),
  ('Aula Interamericana 503', 5, 55),
  ('Salon 505', 5, 50),
  ('Salon 506', 5, 40)
on conflict (nombre_bloque) do update
set piso = excluded.piso,
    capacidad = excluded.capacidad;

commit;
