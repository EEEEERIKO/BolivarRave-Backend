begin;

ALTER TABLE IF EXISTS public.reservas_auditorio
  ADD COLUMN IF NOT EXISTS requiere_monitor boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requiere_proyector boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requiere_filtro_agua boolean NOT NULL DEFAULT false;

commit;
