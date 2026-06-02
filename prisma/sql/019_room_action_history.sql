-- Historial de acciones operativas sobre salones
-- Incluye inhabilitacion/habilitacion, reportes de dano y marcacion de salon limpio.

CREATE TABLE IF NOT EXISTS public.schedule_room_action_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id uuid NOT NULL REFERENCES public.salones(id) ON DELETE CASCADE,
  room_name text NOT NULL,
  action_type text NOT NULL,
  note text,
  created_by_staff_id uuid,
  created_by_name text,
  created_by_role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_room_action_history_action_chk
    CHECK (action_type IN ('inhabilitado', 'habilitado', 'danio_reportado', 'salon_limpio'))
);

CREATE INDEX IF NOT EXISTS idx_schedule_room_action_history_salon_date
  ON public.schedule_room_action_history (salon_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_schedule_room_action_history_action
  ON public.schedule_room_action_history (action_type, created_at DESC);
