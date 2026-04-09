-- ==========================================
-- UNAC - Esquema de reservas en Supabase
-- Estructura solicitada:
--   1) facultades
--   2) salones
--   3) tipos_reserva
--   4) eventos
--   5) horarios_evento
-- Incluye:
--   - Validaciones por tipo de reserva
--   - Prevencion de solapes por salon/dia/hora/rango de fechas
--   - Inserts base para tipos y facultades
-- ==========================================

begin;

create extension if not exists pgcrypto;

-- 1) Tabla: facultades
create table if not exists public.facultades (
  id uuid primary key default gen_random_uuid(),
  nombre varchar(100) not null unique
);

-- 2) Tabla: salones
create table if not exists public.salones (
  id uuid primary key default gen_random_uuid(),
  nombre_bloque varchar(120) not null unique,
  piso int,
  capacidad int,
  constraint salones_piso_chk check (piso is null or piso > 0),
  constraint salones_capacidad_chk check (capacidad is null or capacidad > 0)
);

-- 3) Tabla: tipos_reserva
create table if not exists public.tipos_reserva (
  id int primary key,
  nombre varchar(50) not null unique
);

-- Tipos fijos para poder aplicar reglas de negocio de forma estable
insert into public.tipos_reserva (id, nombre)
values
  (1, 'Semestre'),
  (2, 'Momentanea'),
  (3, 'Iglesia')
on conflict (id) do update
set nombre = excluded.nombre;

-- Enum para dia_semana (tabla horarios_evento)
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

-- 4) Tabla: eventos (principal)
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

-- 5) Tabla: horarios_evento
create table if not exists public.horarios_evento (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos(id) on delete cascade,
  salon_id uuid not null references public.salones(id),
  dia_semana public.dia_semana_enum not null,
  hora_inicio time not null,
  hora_fin time not null,
  constraint horarios_evento_hora_chk check (hora_fin > hora_inicio)
);

-- Indices utiles
create index if not exists idx_eventos_tipo on public.eventos(tipo_reserva_id);
create index if not exists idx_eventos_facultad on public.eventos(facultad_id);
create index if not exists idx_eventos_fechas on public.eventos(fecha_inicio, fecha_fin);

create index if not exists idx_horarios_evento_evento on public.horarios_evento(evento_id);
create index if not exists idx_horarios_evento_salon_dia on public.horarios_evento(salon_id, dia_semana);
create index if not exists idx_horarios_evento_horas on public.horarios_evento(hora_inicio, hora_fin);

-- Validaciones por tipo de reserva
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

  -- Semestre: requiere facultad y codigo_materia, no requiere actividad
  if tipo_nombre = 'Semestre' then
    if new.facultad_id is null then
      raise exception 'Semestre requiere facultad_id';
    end if;
    if coalesce(trim(new.codigo_materia), '') = '' then
      raise exception 'Semestre requiere codigo_materia';
    end if;
  end if;

  -- Momentanea: fecha_inicio = fecha_fin, facultad/codigo opcionales
  if tipo_nombre = 'Momentanea' then
    if new.fecha_inicio <> new.fecha_fin then
      raise exception 'Momentanea requiere fecha_inicio igual a fecha_fin';
    end if;
  end if;

  -- Iglesia: actividad recomendada, facultad/codigo deben ir nulos
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

alter function public.validar_evento_por_tipo()
  set search_path = public, pg_temp;

drop trigger if exists trg_validar_evento_por_tipo on public.eventos;
create trigger trg_validar_evento_por_tipo
before insert or update on public.eventos
for each row
execute function public.validar_evento_por_tipo();

-- Verifica solape entre horarios tomando en cuenta rango de fechas del evento
create or replace function public.verificar_solape_horario(
  p_evento_id uuid,
  p_salon_id uuid,
  p_dia public.dia_semana_enum,
  p_hora_inicio time,
  p_hora_fin time,
  p_horario_id uuid default null,
  p_target_date date default null
)
returns void
language plpgsql
as $$
declare
  v_nuevo_inicio date;
  v_nuevo_fin date;
  v_target_date date;
  v_conflicto record;
  v_nombre_salon text;
  v_nombre_dia text;
  v_hora_conflicto text;
begin
  select e.fecha_inicio, e.fecha_fin
    into v_nuevo_inicio, v_nuevo_fin
  from public.eventos e
  where e.id = p_evento_id;

  if v_nuevo_inicio is null then
    raise exception 'Evento no encontrado para validar solape: %', p_evento_id;
  end if;

  v_target_date := p_target_date;
  if v_target_date is null and v_nuevo_inicio = v_nuevo_fin then
    v_target_date := v_nuevo_inicio;
  end if;

  select 
    h.id, 
    h.evento_id, 
    e.nombre_principal,
    coalesce(x.hora_inicio, h.hora_inicio) as hora_inicio,
    coalesce(x.hora_fin, h.hora_fin) as hora_fin,
    coalesce(sx.nombre_bloque, sb.nombre_bloque) as nombre_bloque,
    coalesce(x.dia_semana, h.dia_semana) as dia_semana
    into v_conflicto
  from public.horarios_evento h
  join public.eventos e on e.id = h.evento_id
  join public.salones sb on sb.id = h.salon_id
  left join public.horarios_evento_excepciones x
    on x.horario_id = h.id
   and x.fecha = v_target_date
  left join public.salones sx on sx.id = x.salon_id
  where coalesce(x.salon_id, h.salon_id) = p_salon_id
    and coalesce(x.dia_semana, h.dia_semana) = p_dia
    and (p_hora_inicio < coalesce(x.hora_fin, h.hora_fin) and coalesce(x.hora_inicio, h.hora_inicio) < p_hora_fin)
    and (v_target_date is null or 
         (v_target_date >= v_nuevo_inicio and v_target_date <= v_nuevo_fin and
          v_target_date >= e.fecha_inicio and v_target_date <= e.fecha_fin))
    and (v_target_date is not null or
         daterange(v_nuevo_inicio, v_nuevo_fin, '[]') && daterange(e.fecha_inicio, e.fecha_fin, '[]'))
    and (p_horario_id is null or h.id <> p_horario_id)
    and h.evento_id <> p_evento_id
  limit 1;

  if v_conflicto is not null then
    v_nombre_salon := COALESCE(v_conflicto.nombre_bloque, 'Salón desconocido');
    v_nombre_dia := CASE p_dia
      WHEN 'Lunes'::public.dia_semana_enum THEN 'Lunes'
      WHEN 'Martes'::public.dia_semana_enum THEN 'Martes'
      WHEN 'Miercoles'::public.dia_semana_enum THEN 'Miércoles'
      WHEN 'Jueves'::public.dia_semana_enum THEN 'Jueves'
      WHEN 'Viernes'::public.dia_semana_enum THEN 'Viernes'
      WHEN 'Sabado'::public.dia_semana_enum THEN 'Sábado'
      WHEN 'Domingo'::public.dia_semana_enum THEN 'Domingo'
      ELSE 'Día desconocido'
    END;
    v_hora_conflicto := (v_conflicto.hora_inicio)::text || '-' || (v_conflicto.hora_fin)::text;
    
    raise exception 
      'CONFLICTO_SOLAPE|%|%|%|%|%',
      v_nombre_salon,
      v_nombre_dia,
      v_hora_conflicto,
      p_hora_inicio::text || '-' || p_hora_fin::text,
      v_conflicto.nombre_principal;
  end if;
end;
$$;

alter function public.verificar_solape_horario(
  uuid,
  uuid,
  public.dia_semana_enum,
  time,
  time,
  uuid,
  date
)
  set search_path = public, pg_temp;

-- Trigger: valida solape al crear/editar horarios_evento
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

alter function public.trg_horarios_evento_no_solape()
  set search_path = public, pg_temp;

drop trigger if exists trg_horarios_evento_no_solape on public.horarios_evento;
create trigger trg_horarios_evento_no_solape
before insert or update on public.horarios_evento
for each row
execute function public.trg_horarios_evento_no_solape();

-- Trigger: revalida solapes si cambian fechas de un evento
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

alter function public.trg_eventos_revalidar_solape_por_fecha()
  set search_path = public, pg_temp;

drop trigger if exists trg_eventos_revalidar_solape_por_fecha on public.eventos;
create trigger trg_eventos_revalidar_solape_por_fecha
before update of fecha_inicio, fecha_fin on public.eventos
for each row
execute function public.trg_eventos_revalidar_solape_por_fecha();

-- Facultades base solicitadas
insert into public.facultades (nombre)
values
  ('Facultad de Ciencias Administrativas y Contables'),
  ('Facultad de Ciencias Humanas y de la Educación'),
  ('Facultad de Ciencias de la Salud'),
  ('Facultad de Ingeniería'),
  ('Facultad de Teología y Religión')
on conflict (nombre) do nothing;

commit;
