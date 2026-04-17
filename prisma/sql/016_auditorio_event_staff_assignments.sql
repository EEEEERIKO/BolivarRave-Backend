-- Assign one or more staff members as responsible workers for each auditorio reservation.

CREATE TABLE IF NOT EXISTS public.auditorio_reserva_encargados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reserva_id uuid NOT NULL REFERENCES public.reservas_auditorio(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auditorio_reserva_encargados_reserva_staff_uq UNIQUE (reserva_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_auditorio_reserva_encargados_reserva_id
  ON public.auditorio_reserva_encargados(reserva_id);

CREATE INDEX IF NOT EXISTS idx_auditorio_reserva_encargados_staff_id
  ON public.auditorio_reserva_encargados(staff_id);
