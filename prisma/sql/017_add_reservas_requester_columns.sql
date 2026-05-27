begin;

ALTER TABLE IF EXISTS public.reservas_auditorio
  ADD COLUMN IF NOT EXISTS solicitante_nombre text,
  ADD COLUMN IF NOT EXISTS solicitante_telefono varchar(60);

commit;
