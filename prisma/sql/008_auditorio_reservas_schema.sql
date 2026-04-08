begin;

-- Estado de una reserva de auditorio
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'auditorio_estado_enum'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.auditorio_estado_enum AS ENUM (
      'Pendiente',
      'Aprobada',
      'Cancelada'
    );
  END IF;
END $$;

-- Reserva principal del auditorio
CREATE TABLE IF NOT EXISTS public.reservas_auditorio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_evento varchar(255) NOT NULL,
  organizador varchar(200) NOT NULL,
  fecha_inicio_periodo date NOT NULL,
  fecha_fin_periodo date NOT NULL,
  numero_asistentes integer NOT NULL,
  requiere_pantalla boolean NOT NULL DEFAULT false,
  requiere_sonido boolean NOT NULL DEFAULT false,
  requiere_monitor boolean NOT NULL DEFAULT false,
  requiere_proyector boolean NOT NULL DEFAULT false,
  requiere_filtro_agua boolean NOT NULL DEFAULT false,
  observaciones text,
  estado public.auditorio_estado_enum NOT NULL DEFAULT 'Pendiente',
  fecha_creacion timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservas_auditorio_fechas_chk CHECK (fecha_fin_periodo >= fecha_inicio_periodo),
  CONSTRAINT reservas_auditorio_asistentes_chk CHECK (numero_asistentes > 0)
);

-- Bloques intercalados de fecha y hora por reserva
CREATE TABLE IF NOT EXISTS public.horarios_intercalados_auditorio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reserva_id uuid NOT NULL REFERENCES public.reservas_auditorio(id) ON DELETE CASCADE,
  fecha_especifica date NOT NULL,
  hora_inicio time NOT NULL,
  hora_fin time NOT NULL,
  CONSTRAINT horarios_intercalados_auditorio_hora_chk CHECK (hora_fin > hora_inicio)
);

CREATE INDEX IF NOT EXISTS idx_reservas_auditorio_estado ON public.reservas_auditorio(estado);
CREATE INDEX IF NOT EXISTS idx_reservas_auditorio_periodo ON public.reservas_auditorio(fecha_inicio_periodo, fecha_fin_periodo);
CREATE INDEX IF NOT EXISTS idx_horarios_intercalados_auditorio_reserva ON public.horarios_intercalados_auditorio(reserva_id);
CREATE INDEX IF NOT EXISTS idx_horarios_intercalados_auditorio_fecha ON public.horarios_intercalados_auditorio(fecha_especifica);

-- Valida que cada bloque pertenezca al periodo de la reserva.
CREATE OR REPLACE FUNCTION public.validar_horario_intercalado_auditorio()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_inicio date;
  v_fin date;
BEGIN
  SELECT r.fecha_inicio_periodo, r.fecha_fin_periodo
    INTO v_inicio, v_fin
  FROM public.reservas_auditorio r
  WHERE r.id = NEW.reserva_id;

  IF v_inicio IS NULL THEN
    RAISE EXCEPTION 'Reserva de auditorio no encontrada: %', NEW.reserva_id;
  END IF;

  IF NEW.fecha_especifica < v_inicio OR NEW.fecha_especifica > v_fin THEN
    RAISE EXCEPTION 'La fecha % debe estar dentro del periodo de la reserva (% a %)', NEW.fecha_especifica, v_inicio, v_fin;
  END IF;

  RETURN NEW;
END;
$$;

-- Evita solape del auditorio en la misma fecha/hora con otras reservas activas.
CREATE OR REPLACE FUNCTION public.verificar_solape_horario_auditorio()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_conflicto record;
BEGIN
  SELECT h.id AS horario_id, r.nombre_evento, r.estado
    INTO v_conflicto
  FROM public.horarios_intercalados_auditorio h
  JOIN public.reservas_auditorio r ON r.id = h.reserva_id
  JOIN public.reservas_auditorio r_new ON r_new.id = NEW.reserva_id
  WHERE h.fecha_especifica = NEW.fecha_especifica
    AND (NEW.hora_inicio < h.hora_fin AND h.hora_inicio < NEW.hora_fin)
    AND (NEW.id IS NULL OR h.id <> NEW.id)
    AND r.id <> NEW.reserva_id
    AND r.estado <> 'Cancelada'
    AND r_new.estado <> 'Cancelada'
  LIMIT 1;

  IF v_conflicto IS NOT NULL THEN
    RAISE EXCEPTION
      'Conflicto auditorio: % se solapa con reserva "%" en % (% - %)',
      NEW.fecha_especifica,
      v_conflicto.nombre_evento,
      NEW.fecha_especifica,
      NEW.hora_inicio,
      NEW.hora_fin;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.validar_horario_intercalado_auditorio()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.verificar_solape_horario_auditorio()
  SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_validar_horario_intercalado_auditorio ON public.horarios_intercalados_auditorio;
CREATE TRIGGER trg_validar_horario_intercalado_auditorio
BEFORE INSERT OR UPDATE ON public.horarios_intercalados_auditorio
FOR EACH ROW
EXECUTE FUNCTION public.validar_horario_intercalado_auditorio();

DROP TRIGGER IF EXISTS trg_solape_horario_auditorio ON public.horarios_intercalados_auditorio;
CREATE TRIGGER trg_solape_horario_auditorio
BEFORE INSERT OR UPDATE ON public.horarios_intercalados_auditorio
FOR EACH ROW
EXECUTE FUNCTION public.verificar_solape_horario_auditorio();

commit;
