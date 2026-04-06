begin;

-- Reutiliza public.dia_semana_enum ya existente en el esquema base.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'staff_tipo_pausa_enum'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.staff_tipo_pausa_enum AS ENUM (
      'Comida',
      'Descanso'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.staff_jornada_semanal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  dia_semana public.dia_semana_enum NOT NULL,
  hora_entrada time NOT NULL,
  hora_salida time NOT NULL,
  total_horas_dia numeric(5,2) NOT NULL,
  CONSTRAINT staff_jornada_rango_hora_chk CHECK (hora_salida > hora_entrada),
  CONSTRAINT staff_jornada_horas_positivas_chk CHECK (total_horas_dia >= 0),
  CONSTRAINT staff_jornada_staff_dia_uq UNIQUE (staff_id, dia_semana)
);

CREATE TABLE IF NOT EXISTS public.staff_pausas_programadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL,
  tipo_pausa public.staff_tipo_pausa_enum NOT NULL,
  dia_semana public.dia_semana_enum NOT NULL,
  hora_inicio time NOT NULL,
  hora_fin time NOT NULL,
  CONSTRAINT staff_pausas_rango_hora_chk CHECK (hora_fin > hora_inicio),
  CONSTRAINT staff_pausas_jornada_fk
    FOREIGN KEY (staff_id, dia_semana)
    REFERENCES public.staff_jornada_semanal(staff_id, dia_semana)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.staff_resumen_contrato (
  staff_id uuid PRIMARY KEY REFERENCES public.staff(id) ON DELETE CASCADE,
  horas_semanales_contrato integer NOT NULL,
  balance_horas numeric(8,2) NOT NULL DEFAULT 0,
  CONSTRAINT staff_resumen_horas_semanales_chk CHECK (horas_semanales_contrato > 0)
);

CREATE INDEX IF NOT EXISTS idx_staff_jornada_staff_id ON public.staff_jornada_semanal(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_jornada_dia ON public.staff_jornada_semanal(dia_semana);

CREATE INDEX IF NOT EXISTS idx_staff_pausas_staff_id ON public.staff_pausas_programadas(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_pausas_dia ON public.staff_pausas_programadas(dia_semana);
CREATE INDEX IF NOT EXISTS idx_staff_pausas_tipo ON public.staff_pausas_programadas(tipo_pausa);

commit;
