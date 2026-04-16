-- Schedule room requests workflow
-- Idempotent table creation for room reservation requests and approvals.

CREATE TABLE IF NOT EXISTS public.solicitudes_salon (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id uuid NOT NULL UNIQUE REFERENCES public.eventos(id) ON DELETE CASCADE,
  estado text NOT NULL DEFAULT 'pendiente',
  solicitado_por_staff_id uuid,
  solicitado_por_nombre text NOT NULL,
  solicitado_por_rol text NOT NULL,
  resuelto_por_staff_id uuid,
  resuelto_por_nombre text,
  resuelto_en timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT solicitudes_salon_estado_chk CHECK (estado IN ('pendiente', 'aprobada', 'rechazada'))
);
