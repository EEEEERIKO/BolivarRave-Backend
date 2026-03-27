-- Limpieza de esquema anterior (Prisma viejo)
-- Ejecutar ANTES de 002_reservas_schema_supabase.sql

begin;

drop table if exists public."ClassSlot" cascade;
drop table if exists public."Class" cascade;
drop table if exists public."ScheduleImport" cascade;

commit;
