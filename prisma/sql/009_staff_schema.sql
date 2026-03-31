begin;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'staff_estado_enum'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.staff_estado_enum AS ENUM (
      'Active',
      'Inactive'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_staff integer NOT NULL,
  rol varchar(100) NOT NULL,
  nombres varchar(150) NOT NULL,
  apellidos varchar(150) NOT NULL,
  cedula varchar(20) NOT NULL,
  telefono varchar(20) NOT NULL,
  fecha_nacimiento date NOT NULL,
  carrera varchar(150) NOT NULL,
  tipo_contrato varchar(50) NOT NULL,
  conocimiento_sonido boolean NOT NULL DEFAULT false,
  estado public.staff_estado_enum NOT NULL DEFAULT 'Active',
  balance_horas double precision NOT NULL DEFAULT 0,
  fecha_creacion timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_numero_staff_chk CHECK (numero_staff > 0),
  CONSTRAINT staff_tipo_contrato_chk CHECK (tipo_contrato IN ('Plan 1', 'Plan 2', 'Plan 3', 'Plan Monitoria', 'Plan Especial'))
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_numero_staff_uq ON public.staff(numero_staff);
CREATE UNIQUE INDEX IF NOT EXISTS staff_cedula_uq ON public.staff(cedula);
CREATE INDEX IF NOT EXISTS idx_staff_estado ON public.staff(estado);

CREATE TABLE IF NOT EXISTS public.staff_bloqueos_clase (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  dia_semana varchar(15) NOT NULL,
  hora_inicio time NOT NULL,
  hora_fin time NOT NULL,
  CONSTRAINT staff_bloqueos_clase_dia_chk CHECK (dia_semana IN ('Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo')),
  CONSTRAINT staff_bloqueos_clase_hora_chk CHECK (hora_fin > hora_inicio)
);

CREATE INDEX IF NOT EXISTS idx_staff_bloqueos_staff_id ON public.staff_bloqueos_clase(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_bloqueos_dia ON public.staff_bloqueos_clase(dia_semana);

commit;
