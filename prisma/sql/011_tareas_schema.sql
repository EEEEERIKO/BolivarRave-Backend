begin;

-- Dependencia para FK (si no existe en el esquema actual).
CREATE TABLE IF NOT EXISTS public.habilidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre varchar(120) NOT NULL UNIQUE
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'tarea_tipo_enum'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.tarea_tipo_enum AS ENUM (
      'Recurrente',
      'Esporadica'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'tarea_prioridad_enum'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.tarea_prioridad_enum AS ENUM (
      'Baja',
      'Media',
      'Alta',
      'Urgente'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'tarea_estado_enum'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.tarea_estado_enum AS ENUM (
      'Pendiente',
      'En Progreso',
      'En Revision',
      'Completada',
      'Rechazada',
      'Corregir',
      'Cancelada'
    );
  END IF;
END $$;

ALTER TYPE public.tarea_estado_enum ADD VALUE IF NOT EXISTS 'Rechazada';
ALTER TYPE public.tarea_estado_enum ADD VALUE IF NOT EXISTS 'Corregir';

CREATE TABLE IF NOT EXISTS public.staff_habilidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  habilidad_id uuid NOT NULL REFERENCES public.habilidades(id) ON DELETE RESTRICT,
  CONSTRAINT staff_habilidades_staff_habilidad_uq UNIQUE (staff_id, habilidad_id)
);

CREATE TABLE IF NOT EXISTS public.tareas_catalogo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre varchar(150) NOT NULL,
  tipo public.tarea_tipo_enum NOT NULL,
  habilidad_requerida_id uuid NULL REFERENCES public.habilidades(id) ON DELETE SET NULL,
  tiempo_estimado_min integer NOT NULL,
  puntos_otorgados integer NOT NULL,
  CONSTRAINT tareas_catalogo_tiempo_estimado_chk CHECK (tiempo_estimado_min > 0),
  CONSTRAINT tareas_catalogo_puntos_chk CHECK (puntos_otorgados >= 0)
);

CREATE TABLE IF NOT EXISTS public.tareas_instancias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarea_catalogo_id uuid NOT NULL REFERENCES public.tareas_catalogo(id) ON DELETE RESTRICT,
  salon_id uuid NULL REFERENCES public.salones(id) ON DELETE SET NULL,
  detalle_adicional text NULL,
  prioridad public.tarea_prioridad_enum NOT NULL DEFAULT 'Media',
  estado public.tarea_estado_enum NOT NULL DEFAULT 'Pendiente',
  fecha_programada date NOT NULL,
  hora_programada time NOT NULL,
  asignacion_automatica boolean NOT NULL DEFAULT false,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tareas_asignaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarea_instancia_id uuid NOT NULL REFERENCES public.tareas_instancias(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  monitor_id uuid NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  hora_inicio_real timestamptz NULL,
  hora_fin_real timestamptz NULL,
  fecha_revision timestamptz NULL,
  observaciones_revision text NULL,
  CONSTRAINT tareas_asignaciones_horas_chk CHECK (
    hora_fin_real IS NULL OR hora_inicio_real IS NULL OR hora_fin_real >= hora_inicio_real
  )
);

ALTER TABLE public.tareas_asignaciones
  ADD COLUMN IF NOT EXISTS monitor_id uuid NULL REFERENCES public.staff(id) ON DELETE RESTRICT;

ALTER TABLE public.tareas_asignaciones
  ADD COLUMN IF NOT EXISTS fecha_revision timestamptz NULL;

ALTER TABLE public.tareas_asignaciones
  ADD COLUMN IF NOT EXISTS observaciones_revision text NULL;

CREATE INDEX IF NOT EXISTS idx_staff_habilidades_staff_id ON public.staff_habilidades(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_habilidades_habilidad_id ON public.staff_habilidades(habilidad_id);

CREATE INDEX IF NOT EXISTS idx_tareas_catalogo_tipo ON public.tareas_catalogo(tipo);
CREATE INDEX IF NOT EXISTS idx_tareas_catalogo_habilidad_req ON public.tareas_catalogo(habilidad_requerida_id);

CREATE INDEX IF NOT EXISTS idx_tareas_instancias_catalogo_id ON public.tareas_instancias(tarea_catalogo_id);
CREATE INDEX IF NOT EXISTS idx_tareas_instancias_salon_id ON public.tareas_instancias(salon_id);
CREATE INDEX IF NOT EXISTS idx_tareas_instancias_estado ON public.tareas_instancias(estado);
CREATE INDEX IF NOT EXISTS idx_tareas_instancias_prioridad ON public.tareas_instancias(prioridad);
CREATE INDEX IF NOT EXISTS idx_tareas_instancias_fecha_hora ON public.tareas_instancias(fecha_programada, hora_programada);

CREATE INDEX IF NOT EXISTS idx_tareas_asignaciones_tarea_instancia_id ON public.tareas_asignaciones(tarea_instancia_id);
CREATE INDEX IF NOT EXISTS idx_tareas_asignaciones_staff_id ON public.tareas_asignaciones(staff_id);
CREATE INDEX IF NOT EXISTS idx_tareas_asignaciones_monitor_id ON public.tareas_asignaciones(monitor_id);
CREATE INDEX IF NOT EXISTS idx_tareas_asignaciones_fecha_revision ON public.tareas_asignaciones(fecha_revision);

commit;
