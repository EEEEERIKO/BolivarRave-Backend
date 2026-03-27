-- Carga curada de facultades y salones (lista oficial)
-- Objetivo: evitar registros previos inconsistentes (variantes de acentos/nombre)
-- ADVERTENCIA: limpia eventos/horarios existentes antes de cargar el catalogo curado.

begin;

-- 1) Asegurar estructura de salones solicitada
alter table if exists public.salones
  add column if not exists piso int;

alter table if exists public.salones
  drop constraint if exists salones_piso_chk;

alter table if exists public.salones
  add constraint salones_piso_chk check (piso is null or piso > 0);

-- 2) Limpiar datos operativos para no romper FKs
truncate table public.horarios_evento, public.eventos cascade;

-- 3) Limpiar catalogos para evitar duplicados historicos
truncate table public.salones restart identity cascade;
truncate table public.facultades restart identity cascade;

-- 4) Facultades oficiales
insert into public.facultades (nombre)
values
  ('Facultad de Ciencias Administrativas y Contables'),
  ('Facultad de Ciencias Humanas y de la Educación'),
  ('Facultad de Ciencias de la Salud'),
  ('Facultad de Ingeniería'),
  ('Facultad de Teología y Religión');

-- 5) Salones oficiales (nombre, piso, aforo)
insert into public.salones (nombre_bloque, piso, capacidad)
values
  ('Aula Foro Unión 101', 1, 60),
  ('Aula Foro Unac 102', 1, 60),
  ('Sala Informática 1 Bolivar', 1, 25),
  ('Sala Informática 2 Bolivar', 1, 25),
  ('Salón 201', 2, 40),
  ('Salón 202', 2, 40),
  ('Salón 203', 2, 40),
  ('Laboratorio de Infantil 204', 2, 40),
  ('Salón 205', 2, 46),
  ('Salón 206', 2, 40),
  ('Salón 301', 3, 40),
  ('Salón 302', 3, 62),
  ('Salón 303', 3, 48),
  ('Salón 304', 3, 40),
  ('Salón 305', 3, 69),
  ('Laboratorio de Música 308', 3, null),
  ('Salón 401', 4, 40),
  ('Salón 402', 4, 45),
  ('Laboratorio de simulación financiera 403', 4, 40),
  ('Laboratorio de Desarrollo de Software (LDS) 404', 4, 40),
  ('Laboratorio de Física 405', 4, 44),
  ('Salón 406', 4, 42),
  ('Aula Interamericana 501', 5, 55),
  ('Aula Interamericana 502', 5, 55),
  ('Aula Interamericana 503', 5, 55),
  ('Salón 505', 5, 50),
  ('Salón 506', 5, 40);

commit;
