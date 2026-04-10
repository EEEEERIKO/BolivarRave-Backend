import { prisma } from "../../lib/prisma";

let schemaBootstrapPromise: Promise<void> | null = null;

async function bootstrapTasksSchema() {
  const statements = [
    `
      CREATE TABLE IF NOT EXISTS public.habilidades (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        nombre varchar(120) NOT NULL UNIQUE
      )
    `,
    `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'tarea_tipo_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE public.tarea_tipo_enum AS ENUM ('Recurrente', 'Esporadica');
        END IF;
      END
      $$
    `,
    `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'tarea_prioridad_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE public.tarea_prioridad_enum AS ENUM ('Baja', 'Media', 'Alta', 'Urgente');
        END IF;
      END
      $$
    `,
    `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'tarea_estado_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE public.tarea_estado_enum AS ENUM ('Pendiente', 'En Progreso', 'En Revision', 'Completada', 'Rechazada', 'Corregir', 'Cancelada');
        END IF;
      END
      $$
    `,
    `ALTER TYPE public.tarea_estado_enum ADD VALUE IF NOT EXISTS 'Rechazada'`,
    `ALTER TYPE public.tarea_estado_enum ADD VALUE IF NOT EXISTS 'Corregir'`,
    `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE t.typname = 'tarea_asignacion_modo_enum'
            AND n.nspname = 'public'
        ) THEN
          CREATE TYPE public.tarea_asignacion_modo_enum AS ENUM ('manual', 'automatica');
        END IF;
      END
      $$
    `,
    `
      CREATE TABLE IF NOT EXISTS public.staff_habilidades (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
        habilidad_id uuid NOT NULL REFERENCES public.habilidades(id) ON DELETE RESTRICT,
        CONSTRAINT staff_habilidades_staff_habilidad_uq UNIQUE (staff_id, habilidad_id)
      )
    `,
    `
      CREATE TABLE IF NOT EXISTS public.tareas_catalogo (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        nombre varchar(150) NOT NULL,
        tipo public.tarea_tipo_enum NOT NULL,
        habilidad_requerida_id uuid NULL REFERENCES public.habilidades(id) ON DELETE SET NULL,
        tiempo_estimado_min integer NOT NULL,
        puntos_otorgados integer NOT NULL,
        CONSTRAINT tareas_catalogo_tiempo_estimado_chk CHECK (tiempo_estimado_min > 0),
        CONSTRAINT tareas_catalogo_puntos_chk CHECK (puntos_otorgados >= 0)
      )
    `,
    `ALTER TABLE public.tareas_catalogo ADD COLUMN IF NOT EXISTS sector varchar(120) NOT NULL DEFAULT 'General'`,
    `ALTER TABLE public.tareas_catalogo ADD COLUMN IF NOT EXISTS modo_asignacion public.tarea_asignacion_modo_enum NOT NULL DEFAULT 'manual'`,
    `ALTER TABLE public.tareas_catalogo ADD COLUMN IF NOT EXISTS cantidad_personal integer NOT NULL DEFAULT 1`,
    `ALTER TABLE public.tareas_catalogo ADD COLUMN IF NOT EXISTS dias_semana smallint[] NULL`,
    `ALTER TABLE public.tareas_catalogo ADD COLUMN IF NOT EXISTS hora_programada time NULL`,
    `ALTER TABLE public.tareas_catalogo ADD COLUMN IF NOT EXISTS fecha_esporadica date NULL`,
    `ALTER TABLE public.tareas_catalogo ADD COLUMN IF NOT EXISTS hora_esporadica time NULL`,
    `ALTER TABLE public.tareas_catalogo ADD COLUMN IF NOT EXISTS requiere_finalizacion boolean NOT NULL DEFAULT false`,
    `ALTER TABLE public.tareas_catalogo ADD COLUMN IF NOT EXISTS tarea_finalizacion varchar(200) NULL`,
    `ALTER TABLE public.tareas_catalogo ADD COLUMN IF NOT EXISTS fecha_finalizacion date NULL`,
    `ALTER TABLE public.tareas_catalogo ADD COLUMN IF NOT EXISTS hora_finalizacion time NULL`,
    `ALTER TABLE public.tareas_catalogo ALTER COLUMN puntos_otorgados SET DEFAULT 0`,
    `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'tareas_catalogo_cantidad_personal_chk'
            AND conrelid = 'public.tareas_catalogo'::regclass
        ) THEN
          ALTER TABLE public.tareas_catalogo
            ADD CONSTRAINT tareas_catalogo_cantidad_personal_chk CHECK (cantidad_personal > 0 AND cantidad_personal <= 50);
        END IF;
      END
      $$
    `,
    `
      CREATE TABLE IF NOT EXISTS public.tareas_catalogo_habilidades (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tarea_catalogo_id uuid NOT NULL REFERENCES public.tareas_catalogo(id) ON DELETE CASCADE,
        habilidad_id uuid NOT NULL REFERENCES public.habilidades(id) ON DELETE RESTRICT,
        CONSTRAINT tareas_catalogo_habilidades_uq UNIQUE (tarea_catalogo_id, habilidad_id)
      )
    `,
    `
      INSERT INTO public.tareas_catalogo_habilidades (tarea_catalogo_id, habilidad_id)
      SELECT tc.id, tc.habilidad_requerida_id
      FROM public.tareas_catalogo tc
      WHERE tc.habilidad_requerida_id IS NOT NULL
      ON CONFLICT (tarea_catalogo_id, habilidad_id) DO NOTHING
    `,
    `
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
      )
    `,
    `
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
      )
    `,
    `ALTER TABLE public.tareas_asignaciones ADD COLUMN IF NOT EXISTS monitor_id uuid NULL REFERENCES public.staff(id) ON DELETE RESTRICT`,
    `ALTER TABLE public.tareas_asignaciones ADD COLUMN IF NOT EXISTS fecha_revision timestamptz NULL`,
    `ALTER TABLE public.tareas_asignaciones ADD COLUMN IF NOT EXISTS observaciones_revision text NULL`,
    `CREATE INDEX IF NOT EXISTS idx_staff_habilidades_staff_id ON public.staff_habilidades(staff_id)`,
    `CREATE INDEX IF NOT EXISTS idx_staff_habilidades_habilidad_id ON public.staff_habilidades(habilidad_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tareas_catalogo_tipo ON public.tareas_catalogo(tipo)`,
    `CREATE INDEX IF NOT EXISTS idx_tareas_catalogo_habilidad_req ON public.tareas_catalogo(habilidad_requerida_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tareas_catalogo_sector ON public.tareas_catalogo(sector)`,
    `CREATE INDEX IF NOT EXISTS idx_tareas_catalogo_modo_asignacion ON public.tareas_catalogo(modo_asignacion)`,
    `CREATE INDEX IF NOT EXISTS idx_tareas_catalogo_habilidades_catalogo_id ON public.tareas_catalogo_habilidades(tarea_catalogo_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tareas_catalogo_habilidades_habilidad_id ON public.tareas_catalogo_habilidades(habilidad_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tareas_instancias_catalogo_id ON public.tareas_instancias(tarea_catalogo_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tareas_instancias_salon_id ON public.tareas_instancias(salon_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tareas_instancias_estado ON public.tareas_instancias(estado)`,
    `CREATE INDEX IF NOT EXISTS idx_tareas_instancias_prioridad ON public.tareas_instancias(prioridad)`,
    `CREATE INDEX IF NOT EXISTS idx_tareas_instancias_fecha_hora ON public.tareas_instancias(fecha_programada, hora_programada)`,
    `CREATE INDEX IF NOT EXISTS idx_tareas_asignaciones_tarea_instancia_id ON public.tareas_asignaciones(tarea_instancia_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tareas_asignaciones_staff_id ON public.tareas_asignaciones(staff_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tareas_asignaciones_monitor_id ON public.tareas_asignaciones(monitor_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tareas_asignaciones_fecha_revision ON public.tareas_asignaciones(fecha_revision)`,
  ];

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
}

export async function ensureTasksSchema() {
  if (!schemaBootstrapPromise) {
    schemaBootstrapPromise = bootstrapTasksSchema().catch((error) => {
      schemaBootstrapPromise = null;
      throw error;
    });
  }

  await schemaBootstrapPromise;
}

export type TareaTipo = "Recurrente" | "Esporadica";
export type TareaPrioridad = "Baja" | "Media" | "Alta" | "Urgente";
export type TareaEstado = "Pendiente" | "En Progreso" | "En Revision" | "Completada" | "Rechazada" | "Corregir" | "Cancelada";
export type TareaModoAsignacion = "manual" | "automatica";

export type CatalogoTask = {
  id: string;
  nombre: string;
  tipo: TareaTipo;
  sector: string;
  modoAsignacion: TareaModoAsignacion;
  cantidadPersonal: number;
  habilidadesRequeridasIds: string[];
  diasSemana: number[];
  horaProgramada: string | null;
  fechaEsporadica: string | null;
  horaEsporadica: string | null;
  requiereFinalizacion: boolean;
  tareaFinalizacion: string | null;
  fechaFinalizacion: string | null;
  horaFinalizacion: string | null;
  tiempoEstimadoMin: number;
};

export type Habilidad = {
  id: string;
  nombre: string;
};

export type StaffHabilidad = {
  id: string;
  staffId: string;
  habilidadId: string;
  staffNombre: string | null;
  habilidadNombre: string | null;
};

export type TareaInstanciaResumen = {
  id: string;
  tareaCatalogoId: string;
  tareaNombre: string;
  estado: TareaEstado;
  prioridad: TareaPrioridad;
  fechaProgramada: string;
  horaProgramada: string;
  salonId: string | null;
  salonNombre: string | null;
  asignacionAutomatica: boolean;
  asignacionId: string | null;
  staffAsignadoId: string | null;
  staffAsignadoNombre: string | null;
  monitorId: string | null;
  monitorNombre: string | null;
  observacionesRevision: string | null;
};

export type CreateCatalogTaskInput = {
  nombre: string;
  tipo: TareaTipo;
  sector: string;
  modoAsignacion: TareaModoAsignacion;
  cantidadPersonal: number;
  habilidadesRequeridasIds: string[];
  diasSemana: number[];
  horaProgramada: string | null;
  fechaEsporadica: string | null;
  horaEsporadica: string | null;
  requiereFinalizacion: boolean;
  tareaFinalizacion: string | null;
  fechaFinalizacion: string | null;
  horaFinalizacion: string | null;
  tiempoEstimadoMin: number;
};

export type UpdateCatalogTaskInput = CreateCatalogTaskInput & {
  id: string;
};

export type CreateTaskInstanceInput = {
  tareaCatalogoId: string;
  salonId: string | null;
  detalleAdicional: string | null;
  prioridad: TareaPrioridad;
  fechaProgramada: string;
  horaProgramada: string;
  asignacionAutomatica: boolean;
};

export type AssignTaskInput = {
  tareaInstanciaId: string;
  staffId: string;
};

export type ReviewDecisionInput = {
  asignacionId: string;
  monitorId: string;
  aprobar: boolean;
  observacionesRevision: string | null;
  rechazoEstado: "Rechazada" | "Corregir";
};

export type CreateHabilidadInput = {
  nombre: string;
};

export type LinkStaffHabilidadInput = {
  staffId: string;
  habilidadId: string;
};

type CatalogoTaskRow = {
  id: string;
  nombre: string;
  tipo: TareaTipo;
  sector: string;
  modo_asignacion: TareaModoAsignacion;
  cantidad_personal: number;
  habilidades_requeridas_ids: string[];
  dias_semana: number[];
  hora_programada: string | null;
  fecha_esporadica: string | null;
  hora_esporadica: string | null;
  requiere_finalizacion: boolean;
  tarea_finalizacion: string | null;
  fecha_finalizacion: string | null;
  hora_finalizacion: string | null;
  tiempo_estimado_min: number;
};

type HabilidadRow = {
  id: string;
  nombre: string;
};

type StaffHabilidadRow = {
  id: string;
  staff_id: string;
  habilidad_id: string;
  staff_nombre: string | null;
  habilidad_nombre: string | null;
};

type InstanciaRow = {
  id: string;
  tarea_catalogo_id: string;
  tarea_nombre: string;
  estado: TareaEstado;
  prioridad: TareaPrioridad;
  fecha_programada: string;
  hora_programada: string;
  salon_id: string | null;
  salon_nombre: string | null;
  asignacion_automatica: boolean;
  asignacion_id: string | null;
  staff_asignado_id: string | null;
  staff_asignado_nombre: string | null;
  monitor_id: string | null;
  monitor_nombre: string | null;
  observaciones_revision: string | null;
};

export const listTaskCatalog = async () => {
  const rows = await prisma.$queryRaw<CatalogoTaskRow[]>`
    SELECT
      t.id::text AS id,
      t.nombre,
      t.tipo::text AS tipo,
      t.sector,
      t.modo_asignacion::text AS modo_asignacion,
      t.cantidad_personal,
      COALESCE(array_agg(DISTINCT tch.habilidad_id::text) FILTER (WHERE tch.habilidad_id IS NOT NULL), ARRAY[]::text[]) AS habilidades_requeridas_ids,
      COALESCE(t.dias_semana, ARRAY[]::smallint[])::int[] AS dias_semana,
      TO_CHAR(t.hora_programada, 'HH24:MI') AS hora_programada,
      TO_CHAR(t.fecha_esporadica, 'YYYY-MM-DD') AS fecha_esporadica,
      TO_CHAR(t.hora_esporadica, 'HH24:MI') AS hora_esporadica,
      t.requiere_finalizacion,
      t.tarea_finalizacion,
      TO_CHAR(t.fecha_finalizacion, 'YYYY-MM-DD') AS fecha_finalizacion,
      TO_CHAR(t.hora_finalizacion, 'HH24:MI') AS hora_finalizacion,
      t.tiempo_estimado_min
    FROM public.tareas_catalogo t
    LEFT JOIN public.tareas_catalogo_habilidades tch ON tch.tarea_catalogo_id = t.id
    GROUP BY t.id
    ORDER BY t.nombre ASC
  `;

  return rows.map((row) => ({
    id: row.id,
    nombre: row.nombre,
    tipo: row.tipo,
    sector: row.sector,
    modoAsignacion: row.modo_asignacion,
    cantidadPersonal: row.cantidad_personal,
    habilidadesRequeridasIds: row.habilidades_requeridas_ids,
    diasSemana: row.dias_semana,
    horaProgramada: row.hora_programada,
    fechaEsporadica: row.fecha_esporadica,
    horaEsporadica: row.hora_esporadica,
    requiereFinalizacion: row.requiere_finalizacion,
    tareaFinalizacion: row.tarea_finalizacion,
    fechaFinalizacion: row.fecha_finalizacion,
    horaFinalizacion: row.hora_finalizacion,
    tiempoEstimadoMin: row.tiempo_estimado_min,
  } satisfies CatalogoTask));
};

export const createTaskCatalog = async (payload: CreateCatalogTaskInput) => {
  return prisma.$transaction(async (tx) => {
    const created = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.tareas_catalogo (
        nombre,
        tipo,
        tiempo_estimado_min,
        puntos_otorgados,
        sector,
        modo_asignacion,
        cantidad_personal,
        dias_semana,
        hora_programada,
        fecha_esporadica,
        hora_esporadica,
        requiere_finalizacion,
        tarea_finalizacion,
        fecha_finalizacion,
        hora_finalizacion
      )
      VALUES (
        ${payload.nombre},
        ${payload.tipo}::public.tarea_tipo_enum,
        ${payload.tiempoEstimadoMin},
        0,
        ${payload.sector},
        ${payload.modoAsignacion}::public.tarea_asignacion_modo_enum,
        ${payload.cantidadPersonal},
        ${payload.diasSemana}::smallint[],
        ${payload.horaProgramada}::time,
        ${payload.fechaEsporadica}::date,
        ${payload.horaEsporadica}::time,
        ${payload.requiereFinalizacion},
        ${payload.tareaFinalizacion},
        ${payload.fechaFinalizacion}::date,
        ${payload.horaFinalizacion}::time
      )
      RETURNING id::text AS id
    `;

    const id = created[0]?.id;
    if (!id) {
      throw new Error("No se pudo crear la tarea de catalogo");
    }

    for (const skillId of payload.habilidadesRequeridasIds) {
      await tx.$executeRaw`
        INSERT INTO public.tareas_catalogo_habilidades (tarea_catalogo_id, habilidad_id)
        VALUES (${id}::uuid, ${skillId}::uuid)
        ON CONFLICT (tarea_catalogo_id, habilidad_id) DO NOTHING
      `;
    }

    return { id };
  });
};

export const updateTaskCatalog = async (payload: UpdateCatalogTaskInput) => {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE public.tareas_catalogo
      SET
        nombre = ${payload.nombre},
        tipo = ${payload.tipo}::public.tarea_tipo_enum,
        tiempo_estimado_min = ${payload.tiempoEstimadoMin},
        sector = ${payload.sector},
        modo_asignacion = ${payload.modoAsignacion}::public.tarea_asignacion_modo_enum,
        cantidad_personal = ${payload.cantidadPersonal},
        dias_semana = ${payload.diasSemana}::smallint[],
        hora_programada = ${payload.horaProgramada}::time,
        fecha_esporadica = ${payload.fechaEsporadica}::date,
        hora_esporadica = ${payload.horaEsporadica}::time,
        requiere_finalizacion = ${payload.requiereFinalizacion},
        tarea_finalizacion = ${payload.tareaFinalizacion},
        fecha_finalizacion = ${payload.fechaFinalizacion}::date,
        hora_finalizacion = ${payload.horaFinalizacion}::time
      WHERE id = ${payload.id}::uuid
      RETURNING id::text AS id
    `;

    const id = updated[0]?.id;
    if (!id) {
      throw new Error("No se encontro la tarea de catalogo a modificar");
    }

    await tx.$executeRaw`
      DELETE FROM public.tareas_catalogo_habilidades
      WHERE tarea_catalogo_id = ${id}::uuid
    `;

    for (const skillId of payload.habilidadesRequeridasIds) {
      await tx.$executeRaw`
        INSERT INTO public.tareas_catalogo_habilidades (tarea_catalogo_id, habilidad_id)
        VALUES (${id}::uuid, ${skillId}::uuid)
        ON CONFLICT (tarea_catalogo_id, habilidad_id) DO NOTHING
      `;
    }

    return { id };
  });
};

export const deleteTaskCatalog = async (id: string) => {
  return prisma.$transaction(async (tx) => {
    const usage = await tx.$queryRaw<Array<{ total: number }>>`
      SELECT COUNT(*)::int AS total
      FROM public.tareas_instancias
      WHERE tarea_catalogo_id = ${id}::uuid
    `;

    if ((usage[0]?.total ?? 0) > 0) {
      throw new Error("No se puede eliminar: esta tarea de catalogo ya tiene instancias creadas");
    }

    const deleted = await tx.$queryRaw<Array<{ id: string }>>`
      DELETE FROM public.tareas_catalogo
      WHERE id = ${id}::uuid
      RETURNING id::text AS id
    `;

    const deletedId = deleted[0]?.id;
    if (!deletedId) {
      // Idempotent delete: if the record is already gone, treat it as deleted.
      return { id };
    }

    return { id: deletedId };
  });
};

export const listHabilidades = async () => {
  const rows = await prisma.$queryRaw<HabilidadRow[]>`
    SELECT
      h.id::text AS id,
      h.nombre
    FROM public.habilidades h
    ORDER BY h.nombre ASC
  `;

  return rows.map((row) => ({
    id: row.id,
    nombre: row.nombre,
  } satisfies Habilidad));
};

export const createHabilidad = async (payload: CreateHabilidadInput) => {
  const created = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO public.habilidades (nombre)
    VALUES (${payload.nombre})
    RETURNING id::text AS id
  `;

  const id = created[0]?.id;
  if (!id) {
    throw new Error("No se pudo crear la habilidad");
  }

  return { id };
};

export type UpdateHabilidadInput = {
  id: string;
  nombre: string;
};

export const updateHabilidad = async (payload: UpdateHabilidadInput) => {
  const updated = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE public.habilidades
    SET nombre = ${payload.nombre}
    WHERE id = ${payload.id}::uuid
    RETURNING id::text AS id
  `;

  const id = updated[0]?.id;
  if (!id) {
    throw new Error("No se encontro la habilidad a modificar");
  }

  return { id };
};

export const deleteHabilidad = async (id: string) => {
  const deleted = await prisma.$queryRaw<Array<{ id: string }>>`
    DELETE FROM public.habilidades
    WHERE id = ${id}::uuid
    RETURNING id::text AS id
  `;

  const deletedId = deleted[0]?.id;
  if (!deletedId) {
    throw new Error("No se encontro la habilidad a eliminar");
  }

  return { id: deletedId };
};

export const listStaffHabilidades = async (staffId?: string) => {
  const rows = staffId
    ? await prisma.$queryRaw<StaffHabilidadRow[]>`
      SELECT
        sh.id::text AS id,
        sh.staff_id::text AS staff_id,
        sh.habilidad_id::text AS habilidad_id,
        CONCAT(s.nombres, ' ', s.apellidos) AS staff_nombre,
        h.nombre AS habilidad_nombre
      FROM public.staff_habilidades sh
      INNER JOIN public.staff s ON s.id = sh.staff_id
      INNER JOIN public.habilidades h ON h.id = sh.habilidad_id
      WHERE sh.staff_id = ${staffId}::uuid
      ORDER BY h.nombre ASC
    `
    : await prisma.$queryRaw<StaffHabilidadRow[]>`
      SELECT
        sh.id::text AS id,
        sh.staff_id::text AS staff_id,
        sh.habilidad_id::text AS habilidad_id,
        CONCAT(s.nombres, ' ', s.apellidos) AS staff_nombre,
        h.nombre AS habilidad_nombre
      FROM public.staff_habilidades sh
      INNER JOIN public.staff s ON s.id = sh.staff_id
      INNER JOIN public.habilidades h ON h.id = sh.habilidad_id
      ORDER BY s.nombres ASC, s.apellidos ASC, h.nombre ASC
    `;

  return rows.map((row) => ({
    id: row.id,
    staffId: row.staff_id,
    habilidadId: row.habilidad_id,
    staffNombre: row.staff_nombre,
    habilidadNombre: row.habilidad_nombre,
  } satisfies StaffHabilidad));
};

export const linkStaffHabilidad = async (payload: LinkStaffHabilidadInput) => {
  const created = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO public.staff_habilidades (staff_id, habilidad_id)
    VALUES (${payload.staffId}::uuid, ${payload.habilidadId}::uuid)
    ON CONFLICT (staff_id, habilidad_id) DO NOTHING
    RETURNING id::text AS id
  `;

  if (created[0]?.id) {
    return { id: created[0].id, alreadyLinked: false };
  }

  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id
    FROM public.staff_habilidades
    WHERE staff_id = ${payload.staffId}::uuid
      AND habilidad_id = ${payload.habilidadId}::uuid
    LIMIT 1
  `;

  const id = existing[0]?.id;
  if (!id) {
    throw new Error("No se pudo vincular la habilidad al staff");
  }

  return { id, alreadyLinked: true };
};

export const unlinkStaffHabilidad = async (id: string) => {
  const deleted = await prisma.$queryRaw<Array<{ id: string }>>`
    DELETE FROM public.staff_habilidades
    WHERE id = ${id}::uuid
    RETURNING id::text AS id
  `;

  if (!deleted[0]?.id) {
    throw new Error("No se encontro el vinculo staff-habilidad");
  }

  return { id: deleted[0].id };
};

export const listTaskInstances = async (estado?: TareaEstado) => {
  const rows = estado
    ? await prisma.$queryRaw<InstanciaRow[]>`
      SELECT
        ti.id::text AS id,
        ti.tarea_catalogo_id::text AS tarea_catalogo_id,
        tc.nombre AS tarea_nombre,
        ti.estado::text AS estado,
        ti.prioridad::text AS prioridad,
        TO_CHAR(ti.fecha_programada, 'YYYY-MM-DD') AS fecha_programada,
        TO_CHAR(ti.hora_programada, 'HH24:MI') AS hora_programada,
        ti.salon_id::text AS salon_id,
        s.nombre_bloque AS salon_nombre,
        ti.asignacion_automatica,
        ta.id::text AS asignacion_id,
        ta.staff_id::text AS staff_asignado_id,
        CASE
          WHEN st.id IS NULL THEN NULL
          ELSE st.nombres || ' ' || st.apellidos
        END AS staff_asignado_nombre,
        ta.monitor_id::text AS monitor_id,
        CASE
          WHEN m.id IS NULL THEN NULL
          ELSE m.nombres || ' ' || m.apellidos
        END AS monitor_nombre,
        ta.observaciones_revision
      FROM public.tareas_instancias ti
      INNER JOIN public.tareas_catalogo tc ON tc.id = ti.tarea_catalogo_id
      LEFT JOIN public.salones s ON s.id = ti.salon_id
      LEFT JOIN public.tareas_asignaciones ta ON ta.tarea_instancia_id = ti.id
      LEFT JOIN public.staff st ON st.id = ta.staff_id
      LEFT JOIN public.staff m ON m.id = ta.monitor_id
      WHERE ti.estado = ${estado}::public.tarea_estado_enum
      ORDER BY ti.fecha_programada ASC, ti.hora_programada ASC
    `
    : await prisma.$queryRaw<InstanciaRow[]>`
      SELECT
        ti.id::text AS id,
        ti.tarea_catalogo_id::text AS tarea_catalogo_id,
        tc.nombre AS tarea_nombre,
        ti.estado::text AS estado,
        ti.prioridad::text AS prioridad,
        TO_CHAR(ti.fecha_programada, 'YYYY-MM-DD') AS fecha_programada,
        TO_CHAR(ti.hora_programada, 'HH24:MI') AS hora_programada,
        ti.salon_id::text AS salon_id,
        s.nombre_bloque AS salon_nombre,
        ti.asignacion_automatica,
        ta.id::text AS asignacion_id,
        ta.staff_id::text AS staff_asignado_id,
        CASE
          WHEN st.id IS NULL THEN NULL
          ELSE st.nombres || ' ' || st.apellidos
        END AS staff_asignado_nombre,
        ta.monitor_id::text AS monitor_id,
        CASE
          WHEN m.id IS NULL THEN NULL
          ELSE m.nombres || ' ' || m.apellidos
        END AS monitor_nombre,
        ta.observaciones_revision
      FROM public.tareas_instancias ti
      INNER JOIN public.tareas_catalogo tc ON tc.id = ti.tarea_catalogo_id
      LEFT JOIN public.salones s ON s.id = ti.salon_id
      LEFT JOIN public.tareas_asignaciones ta ON ta.tarea_instancia_id = ti.id
      LEFT JOIN public.staff st ON st.id = ta.staff_id
      LEFT JOIN public.staff m ON m.id = ta.monitor_id
      ORDER BY ti.fecha_programada ASC, ti.hora_programada ASC
    `;

  return rows.map((row) => ({
    id: row.id,
    tareaCatalogoId: row.tarea_catalogo_id,
    tareaNombre: row.tarea_nombre,
    estado: row.estado,
    prioridad: row.prioridad,
    fechaProgramada: row.fecha_programada,
    horaProgramada: row.hora_programada,
    salonId: row.salon_id,
    salonNombre: row.salon_nombre,
    asignacionAutomatica: row.asignacion_automatica,
    asignacionId: row.asignacion_id,
    staffAsignadoId: row.staff_asignado_id,
    staffAsignadoNombre: row.staff_asignado_nombre,
    monitorId: row.monitor_id,
    monitorNombre: row.monitor_nombre,
    observacionesRevision: row.observaciones_revision,
  } satisfies TareaInstanciaResumen));
};

export const createTaskInstance = async (payload: CreateTaskInstanceInput) => {
  const created = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO public.tareas_instancias (
      tarea_catalogo_id,
      salon_id,
      detalle_adicional,
      prioridad,
      estado,
      fecha_programada,
      hora_programada,
      asignacion_automatica
    )
    VALUES (
      ${payload.tareaCatalogoId}::uuid,
      ${payload.salonId}::uuid,
      ${payload.detalleAdicional},
      ${payload.prioridad}::public.tarea_prioridad_enum,
      'Pendiente'::public.tarea_estado_enum,
      ${payload.fechaProgramada}::date,
      ${payload.horaProgramada}::time,
      ${payload.asignacionAutomatica}
    )
    RETURNING id::text AS id
  `;

  const id = created[0]?.id;
  if (!id) {
    throw new Error("No se pudo crear la instancia de tarea");
  }

  return { id };
};

export const assignTaskToStaff = async (payload: AssignTaskInput) => {
  return prisma.$transaction(async (tx) => {
    const instance = await tx.$queryRaw<Array<{ id: string; estado: TareaEstado; cantidad_personal: number }>>`
      SELECT
        ti.id::text AS id,
        ti.estado::text AS estado,
        tc.cantidad_personal
      FROM public.tareas_instancias ti
      INNER JOIN public.tareas_catalogo tc ON tc.id = ti.tarea_catalogo_id
      WHERE ti.id = ${payload.tareaInstanciaId}::uuid
      LIMIT 1
    `;

    const target = instance[0];
    if (!target) {
      throw new Error("No se encontro la instancia de tarea");
    }

    const assignmentCount = await tx.$queryRaw<Array<{ total: number }>>`
      SELECT COUNT(*)::int AS total
      FROM public.tareas_asignaciones
      WHERE tarea_instancia_id = ${payload.tareaInstanciaId}::uuid
    `;

    if ((assignmentCount[0]?.total ?? 0) >= target.cantidad_personal) {
      throw new Error("La tarea ya alcanzo la cantidad maxima de personal asignado");
    }

    const staffExists = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id
      FROM public.staff
      WHERE id = ${payload.staffId}::uuid
      LIMIT 1
    `;

    if (!staffExists[0]?.id) {
      throw new Error("No se encontro el staff asignado");
    }

    const existing = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id
      FROM public.tareas_asignaciones
      WHERE tarea_instancia_id = ${payload.tareaInstanciaId}::uuid
        AND staff_id = ${payload.staffId}::uuid
      LIMIT 1
    `;

    if (existing[0]?.id) {
      return { asignacionId: existing[0].id, alreadyAssigned: true };
    }

    const created = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.tareas_asignaciones (
        tarea_instancia_id,
        staff_id
      )
      VALUES (
        ${payload.tareaInstanciaId}::uuid,
        ${payload.staffId}::uuid
      )
      RETURNING id::text AS id
    `;

    const asignacionId = created[0]?.id;
    if (!asignacionId) {
      throw new Error("No se pudo crear la asignacion de tarea");
    }

    return { asignacionId, alreadyAssigned: false };
  });
};

export const markTaskInProgress = async (asignacionId: string) => {
  return prisma.$transaction(async (tx) => {
    const assignment = await tx.$queryRaw<Array<{ id: string; tarea_instancia_id: string }>>`
      SELECT id::text AS id, tarea_instancia_id::text AS tarea_instancia_id
      FROM public.tareas_asignaciones
      WHERE id = ${asignacionId}::uuid
      LIMIT 1
    `;

    const current = assignment[0];
    if (!current) {
      throw new Error("No se encontro la asignacion de tarea");
    }

    const updated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE public.tareas_instancias
      SET estado = 'En Progreso'::public.tarea_estado_enum
      WHERE id = ${current.tarea_instancia_id}::uuid
        AND estado IN ('Pendiente'::public.tarea_estado_enum, 'Corregir'::public.tarea_estado_enum)
      RETURNING id::text AS id
    `;

    if (!updated[0]?.id) {
      throw new Error("La tarea no puede iniciar en su estado actual");
    }

    await tx.$executeRaw`
      UPDATE public.tareas_asignaciones
      SET hora_inicio_real = COALESCE(hora_inicio_real, now())
      WHERE id = ${asignacionId}::uuid
    `;

    return { tareaInstanciaId: current.tarea_instancia_id };
  });
};

export const sendTaskToReview = async (asignacionId: string) => {
  return prisma.$transaction(async (tx) => {
    const assignment = await tx.$queryRaw<Array<{ id: string; tarea_instancia_id: string }>>`
      SELECT id::text AS id, tarea_instancia_id::text AS tarea_instancia_id
      FROM public.tareas_asignaciones
      WHERE id = ${asignacionId}::uuid
      LIMIT 1
    `;

    const current = assignment[0];
    if (!current) {
      throw new Error("No se encontro la asignacion de tarea");
    }

    const updated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE public.tareas_instancias
      SET estado = 'En Revision'::public.tarea_estado_enum
      WHERE id = ${current.tarea_instancia_id}::uuid
        AND estado = 'En Progreso'::public.tarea_estado_enum
      RETURNING id::text AS id
    `;

    if (!updated[0]?.id) {
      throw new Error("La tarea debe estar en progreso para enviarse a revision");
    }

    await tx.$executeRaw`
      UPDATE public.tareas_asignaciones
      SET hora_fin_real = COALESCE(hora_fin_real, now())
      WHERE id = ${asignacionId}::uuid
    `;

    return { tareaInstanciaId: current.tarea_instancia_id };
  });
};

export const reviewTaskAssignment = async (payload: ReviewDecisionInput) => {
  return prisma.$transaction(async (tx) => {
    const row = await tx.$queryRaw<Array<{ id: string; tarea_instancia_id: string }>>`
      SELECT id::text AS id, tarea_instancia_id::text AS tarea_instancia_id
      FROM public.tareas_asignaciones
      WHERE id = ${payload.asignacionId}::uuid
      LIMIT 1
    `;

    const assignment = row[0];
    if (!assignment) {
      throw new Error("No se encontro la asignacion de tarea");
    }

    const monitor = await tx.$queryRaw<Array<{ id: string; role_id: number }>>`
      SELECT id::text AS id, role_id
      FROM public.staff
      WHERE id = ${payload.monitorId}::uuid
      LIMIT 1
    `;

    if (!monitor[0]?.id) {
      throw new Error("No se encontro el monitor revisor");
    }

    if (monitor[0].role_id !== 1 && monitor[0].role_id !== 2) {
      throw new Error("Solo un monitor o admin puede revisar tareas");
    }

    const targetState: TareaEstado = payload.aprobar ? "Completada" : payload.rechazoEstado;

    const updatedInstance = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE public.tareas_instancias
      SET estado = ${targetState}::public.tarea_estado_enum
      WHERE id = ${assignment.tarea_instancia_id}::uuid
        AND estado = 'En Revision'::public.tarea_estado_enum
      RETURNING id::text AS id
    `;

    const instance = updatedInstance[0];
    if (!instance?.id) {
      throw new Error("La tarea debe estar en revision para aprobar o rechazar");
    }

    await tx.$executeRaw`
      UPDATE public.tareas_asignaciones
      SET
        monitor_id = ${payload.monitorId}::uuid,
        fecha_revision = now(),
        observaciones_revision = ${payload.observacionesRevision}
      WHERE id = ${payload.asignacionId}::uuid
    `;

    return { tareaInstanciaId: assignment.tarea_instancia_id, estado: targetState };
  });
};
