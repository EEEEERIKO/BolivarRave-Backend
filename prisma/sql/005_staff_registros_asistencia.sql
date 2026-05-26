CREATE TABLE IF NOT EXISTS public.staff_registros_asistencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  jornada_id uuid NOT NULL REFERENCES public.staff_jornada_semanal(id) ON DELETE RESTRICT,
  fecha date NOT NULL,
  hora_entrada timestamptz NOT NULL,
  hora_salida timestamptz,
  minutos_tarde integer NOT NULL DEFAULT 0,
  minutos_salida_anticipada integer NOT NULL DEFAULT 0,
  minutos_balance integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_registros_asistencia_unico_por_jornada UNIQUE (staff_id, jornada_id, fecha)
);

CREATE INDEX IF NOT EXISTS staff_registros_asistencia_staff_fecha_idx
  ON public.staff_registros_asistencia (staff_id, fecha DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS staff_registros_asistencia_fecha_idx
  ON public.staff_registros_asistencia (fecha DESC);