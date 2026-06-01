import { prisma } from "../../lib/prisma";
import * as XLSX from "xlsx";

export type AuditorioEstado = "Pendiente" | "Aprobada" | "Cancelada";

export type AuditorioHorarioInput = {
  fechaEspecifica: Date;
  horaInicio: string;
  horaFin: string;
};

export type CreateReservaAuditorioInput = {
  nombreEvento: string;
  organizador: string;
  solicitanteNombre?: string | null;
  solicitanteTelefono?: string | null;
  fechaInicioPeriodo: Date;
  fechaFinPeriodo: Date;
  numeroAsistentes: number;
  requierePantalla: boolean;
  requiereSonido: boolean;
  requiereMonitor: boolean;
  requiereProyector: boolean;
  requiereFiltroAgua: boolean;
  observaciones: string | null;
  estado: AuditorioEstado;
  horarios: AuditorioHorarioInput[];
  encargadoStaffIds: string[];
};

export type UpdateReservaAuditorioInput = CreateReservaAuditorioInput & {
  id: string;
};

type AuditorioEncargado = {
  staffId: string;
  cedula: string;
  numeroStaff: number;
  nombreCompleto: string;
  rol: string;
  estado: string;
};

export type UpcomingAuditorioNotification = {
  id: string;
  reservaId: string;
  nombreEvento: string;
  organizador: string;
  estado: AuditorioEstado;
  fechaInicioPeriodo: string;
  fechaFinPeriodo: string;
  numeroAsistentes: number;
  requierePantalla: boolean;
  requiereSonido: boolean;
  requiereMonitor: boolean;
  requiereProyector: boolean;
  requiereFiltroAgua: boolean;
  observaciones: string | null;
  fechaEspecifica: string;
  horaInicio: string;
  horaFin: string;
  startsAt: string;
  notificationType: "en_curso" | "proximo";
  horarios: Array<{
    id: string;
    fechaEspecifica: string;
    horaInicio: string;
    horaFin: string;
  }>;
  solicitanteNombre?: string | null;
  solicitanteTelefono?: string | null;
  assignedWorkers: AuditorioEncargado[];
};

export type PendingAuditorioNotification = {
  id: string;
  reservaId: string;
  nombreEvento: string;
  organizador: string;
  fechaInicioPeriodo: string;
  fechaFinPeriodo: string;
  numeroAsistentes: number;
  createdAt: string;
  firstHorarioDate: string | null;
  firstHorarioStart: string | null;
  firstHorarioEnd: string | null;
  solicitanteNombre?: string | null;
  solicitanteTelefono?: string | null;
};

type ListUpcomingAuditorioNotificationsOptions = {
  assignedStaffId?: string | undefined;
};

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);

const previousBusinessDay = (value: Date) => {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - 1);

  while (result.getDay() === 0 || result.getDay() === 6) {
    result.setDate(result.getDate() - 1);
  }

  return result;
};

type AuditorioRequerimientosColumns = {
  requiereMonitor: string | null;
  requiereProyector: string | null;
  requiereFiltroAgua: string | null;
};

const quoteIdentifier = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

const pickExistingColumn = (available: Set<string>, candidates: string[]) => {
  for (const candidate of candidates) {
    if (available.has(candidate)) {
      return candidate;
    }
  }

  return null;
};

const toSqlLocalTimestamp = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  const second = String(value.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

let ensureAuditorioEncargadosTablePromise: Promise<void> | null = null;

const ensureAuditorioEncargadosTableReady = async () => {
  if (!ensureAuditorioEncargadosTablePromise) {
    ensureAuditorioEncargadosTablePromise = (async () => {
      await prisma.$executeRawUnsafe(`
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
      `);
    })().catch((error) => {
      ensureAuditorioEncargadosTablePromise = null;
      throw error;
    });
  }

  await ensureAuditorioEncargadosTablePromise;
};

// Table to keep pending admin approval records for public auditorio reservas
let ensureAuditorioPendingTablePromise: Promise<void> | null = null;

const ensureAuditorioPendingTableReady = async () => {
  if (!ensureAuditorioPendingTablePromise) {
    ensureAuditorioPendingTablePromise = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS public.auditorio_reserva_solicitudes (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          reserva_id uuid NOT NULL REFERENCES public.reservas_auditorio(id) ON DELETE CASCADE,
          estado text NOT NULL DEFAULT 'pendiente',
          solicitado_por_staff_id uuid NULL REFERENCES public.staff(id) ON DELETE SET NULL,
          solicitado_por_nombre text NULL,
          solicitado_por_rol text NULL,
          resuelto_por_staff_id uuid NULL REFERENCES public.staff(id) ON DELETE SET NULL,
          resuelto_por_nombre text NULL,
          resuelto_en timestamptz NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT auditorio_reserva_solicitudes_reserva_uq UNIQUE (reserva_id)
        );

        CREATE INDEX IF NOT EXISTS idx_auditorio_reserva_solicitudes_reserva_id
          ON public.auditorio_reserva_solicitudes(reserva_id);

        CREATE INDEX IF NOT EXISTS idx_auditorio_reserva_solicitudes_estado
          ON public.auditorio_reserva_solicitudes(estado);
      `);
    })().catch((error) => {
      ensureAuditorioPendingTablePromise = null;
      throw error;
    });
  }

  await ensureAuditorioPendingTablePromise;
};

export const createPendingAuditorioSolicitud = async (
  reservaId: string,
  requestedByName?: string | null,
  requestedByRole?: string | null,
  requestedByStaffId?: string | null
) => {
  await ensureAuditorioPendingTableReady();

  await prisma.$executeRawUnsafe(
    `
    INSERT INTO public.auditorio_reserva_solicitudes (
      reserva_id,
      estado,
      solicitado_por_staff_id,
      solicitado_por_nombre,
      solicitado_por_rol,
      updated_at
    )
    VALUES (
      $1::uuid,
      'pendiente',
      $2::uuid,
      $3,
      $4,
      now()
    )
    ON CONFLICT (reserva_id) DO UPDATE SET
      estado = EXCLUDED.estado,
      solicitado_por_staff_id = EXCLUDED.solicitado_por_staff_id,
      solicitado_por_nombre = EXCLUDED.solicitado_por_nombre,
      solicitado_por_rol = EXCLUDED.solicitado_por_rol,
      updated_at = now()
  `,
    reservaId,
    requestedByStaffId ?? null,
    requestedByName ?? null,
    requestedByRole ?? null
  );
};


const syncReservaEncargadosTx = async (
  tx: Pick<typeof prisma, "$queryRaw" | "$executeRaw">,
  reservaId: string,
  encargadoStaffIds: string[]
) => {
  const uniqueIds = Array.from(new Set(encargadoStaffIds.map((value) => value.trim()).filter(Boolean)));

  await tx.$executeRaw`
    DELETE FROM public.auditorio_reserva_encargados
    WHERE reserva_id = ${reservaId}::uuid
  `;

  if (uniqueIds.length === 0) {
    return;
  }

  const existingStaff = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id
    FROM public.staff
    WHERE id::text = ANY(${uniqueIds})
  `;

  const existingIds = new Set(existingStaff.map((row) => row.id));
  const invalidIds = uniqueIds.filter((id) => !existingIds.has(id));

  if (invalidIds.length > 0) {
    throw new Error(`STAFF_ENCARGADO_INVALIDO|${invalidIds.join(",")}`);
  }

  for (const staffId of uniqueIds) {
    await tx.$executeRaw`
      INSERT INTO public.auditorio_reserva_encargados (
        reserva_id,
        staff_id,
        updated_at
      )
      VALUES (
        ${reservaId}::uuid,
        ${staffId}::uuid,
        NOW()
      )
      ON CONFLICT (reserva_id, staff_id)
      DO UPDATE SET
        updated_at = NOW()
    `;
  }
};

const getAuditorioRequerimientosColumns = async (): Promise<AuditorioRequerimientosColumns> => {
  const columns = await withTimeout(prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'reservas_auditorio'
  `, 6000, "Prisma auditorio schema columns timeout");

  const available = new Set(columns.map((row) => row.column_name));

  return {
    requiereMonitor: pickExistingColumn(available, ["requiere_monitor", "requiereMonitor"]),
    requiereProyector: pickExistingColumn(available, ["requiere_proyector", "requiereProyector"]),
    requiereFiltroAgua: pickExistingColumn(available, ["requiere_filtro_agua", "requiereFiltroAgua"]),
  };
};

export const listReservasAuditorio = async () => {
  await ensureAuditorioEncargadosTableReady();

  const requerimientosColumns = await getAuditorioRequerimientosColumns();
  const monitorSelect = requerimientosColumns.requiereMonitor
    ? `r.${quoteIdentifier(requerimientosColumns.requiereMonitor)} AS requiere_monitor,`
    : "false AS requiere_monitor,";
  const proyectorSelect = requerimientosColumns.requiereProyector
    ? `r.${quoteIdentifier(requerimientosColumns.requiereProyector)} AS requiere_proyector,`
    : "false AS requiere_proyector,";
  const filtroAguaSelect = requerimientosColumns.requiereFiltroAgua
    ? `r.${quoteIdentifier(requerimientosColumns.requiereFiltroAgua)} AS requiere_filtro_agua,`
    : "false AS requiere_filtro_agua,";

  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    nombre_evento: string;
    organizador: string;
    fecha_inicio_periodo: string;
    fecha_fin_periodo: string;
    numero_asistentes: number;
    requiere_pantalla: boolean;
    requiere_sonido: boolean;
    requiere_monitor: boolean;
    requiere_proyector: boolean;
    requiere_filtro_agua: boolean;
    observaciones: string | null;
    solicitante_nombre: string | null;
    solicitante_telefono: string | null;
    estado: AuditorioEstado;
    fecha_creacion: string;
    horario_id: string | null;
    fecha_especifica: string | null;
    hora_inicio: string | null;
    hora_fin: string | null;
  }>>(
    `
    SELECT
      r.id::text AS id,
      r.nombre_evento,
      r.organizador,
      TO_CHAR(r.fecha_inicio_periodo, 'YYYY-MM-DD') AS fecha_inicio_periodo,
      TO_CHAR(r.fecha_fin_periodo, 'YYYY-MM-DD') AS fecha_fin_periodo,
      r.numero_asistentes,
      r.requiere_pantalla,
      r.requiere_sonido,
      ${monitorSelect}
      ${proyectorSelect}
      ${filtroAguaSelect}
      r.observaciones,
      r.solicitante_nombre AS solicitante_nombre,
      r.solicitante_telefono AS solicitante_telefono,
      r.estado,
      TO_CHAR(r.fecha_creacion, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fecha_creacion,
      h.id::text AS horario_id,
      CASE
        WHEN h.fecha_especifica IS NULL THEN NULL
        ELSE TO_CHAR(h.fecha_especifica, 'YYYY-MM-DD')
      END AS fecha_especifica,
      CASE
        WHEN h.hora_inicio IS NULL THEN NULL
        ELSE TO_CHAR(h.hora_inicio, 'HH24:MI')
      END AS hora_inicio,
      CASE
        WHEN h.hora_fin IS NULL THEN NULL
        ELSE TO_CHAR(h.hora_fin, 'HH24:MI')
      END AS hora_fin
    FROM public.reservas_auditorio r
    LEFT JOIN public.horarios_intercalados_auditorio h ON h.reserva_id = r.id
    ORDER BY r.fecha_creacion DESC, h.fecha_especifica ASC NULLS LAST, h.hora_inicio ASC NULLS LAST
  `
  );

  const byId = new Map<string, {
    id: string;
    nombreEvento: string;
    organizador: string;
    fechaInicioPeriodo: string;
    fechaFinPeriodo: string;
    numeroAsistentes: number;
    requierePantalla: boolean;
    requiereSonido: boolean;
    requiereMonitor: boolean;
    requiereProyector: boolean;
    requiereFiltroAgua: boolean;
    observaciones: string | null;
    solicitanteNombre?: string | null;
    solicitanteTelefono?: string | null;
    estado: AuditorioEstado;
    fechaCreacion: string;
    encargados: AuditorioEncargado[];
    horarios: Array<{
      id: string;
      fechaEspecifica: string;
      horaInicio: string;
      horaFin: string;
    }>;
  }>();

  for (const row of rows) {
    const current = byId.get(row.id);

    if (!current) {
      byId.set(row.id, {
        id: row.id,
        nombreEvento: row.nombre_evento,
        organizador: row.organizador,
        solicitanteNombre: row.solicitante_nombre ?? null,
        solicitanteTelefono: row.solicitante_telefono ?? null,
        fechaInicioPeriodo: row.fecha_inicio_periodo,
        fechaFinPeriodo: row.fecha_fin_periodo,
        numeroAsistentes: row.numero_asistentes,
        requierePantalla: row.requiere_pantalla,
        requiereSonido: row.requiere_sonido,
        requiereMonitor: row.requiere_monitor,
        requiereProyector: row.requiere_proyector,
        requiereFiltroAgua: row.requiere_filtro_agua,
        observaciones: row.observaciones,
        estado: row.estado,
        fechaCreacion: row.fecha_creacion,
        encargados: [],
        horarios: row.horario_id && row.fecha_especifica && row.hora_inicio && row.hora_fin
          ? [{
              id: row.horario_id,
              fechaEspecifica: row.fecha_especifica,
              horaInicio: row.hora_inicio,
              horaFin: row.hora_fin,
            }]
          : [],
      });
      continue;
    }

    if (row.horario_id && row.fecha_especifica && row.hora_inicio && row.hora_fin) {
      current.horarios.push({
        id: row.horario_id,
        fechaEspecifica: row.fecha_especifica,
        horaInicio: row.hora_inicio,
        horaFin: row.hora_fin,
      });
    }
  }

  const encargadosRows = await prisma.$queryRaw<Array<{
    reserva_id: string;
    staff_id: string;
    cedula: string;
    numero_staff: number;
    nombres: string;
    apellidos: string;
    rol: string;
    estado: string;
  }>>`
    SELECT
      a.reserva_id::text AS reserva_id,
      s.id::text AS staff_id,
      s.cedula,
      s.numero_staff,
      s.nombres,
      s.apellidos,
      s.rol,
      s.estado::text AS estado
    FROM public.auditorio_reserva_encargados a
    INNER JOIN public.staff s ON s.id = a.staff_id
    ORDER BY a.reserva_id, s.nombres, s.apellidos
  `;

  for (const row of encargadosRows) {
    const target = byId.get(row.reserva_id);
    if (!target) continue;

    target.encargados.push({
      staffId: row.staff_id,
      cedula: row.cedula,
      numeroStaff: Number(row.numero_staff ?? 0),
      nombreCompleto: `${row.nombres} ${row.apellidos}`.trim(),
      rol: row.rol,
      estado: row.estado,
    });
  }

  return Array.from(byId.values());
};

export const listUpcomingAuditorioNotifications = async (
  options?: ListUpcomingAuditorioNotificationsOptions
): Promise<UpcomingAuditorioNotification[]> => {
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setHours(0, 0, 0, 0);

  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + 7);
  windowEnd.setHours(23, 59, 59, 999);

  const startSql = toSqlLocalTimestamp(windowStart);
  const endSql = toSqlLocalTimestamp(windowEnd);

  const rows = await withTimeout(prisma.$queryRaw<
    Array<{
      reserva_id: string;
      horario_id: string;
      nombre_evento: string;
      organizador: string;
      estado: AuditorioEstado;
      fecha_especifica: string;
      hora_inicio: string;
      hora_fin: string;
      starts_at: string;
      ends_at: string;
    }>
  >`
    SELECT
      r.id::text AS reserva_id,
      h.id::text AS horario_id,
      r.nombre_evento,
      r.organizador,
      r.estado,
      TO_CHAR(h.fecha_especifica, 'YYYY-MM-DD') AS fecha_especifica,
      TO_CHAR(h.hora_inicio, 'HH24:MI') AS hora_inicio,
      TO_CHAR(h.hora_fin, 'HH24:MI') AS hora_fin,
      TO_CHAR((h.fecha_especifica + h.hora_inicio), 'YYYY-MM-DD"T"HH24:MI:SS') AS starts_at,
      TO_CHAR((h.fecha_especifica + h.hora_fin), 'YYYY-MM-DD"T"HH24:MI:SS') AS ends_at
    FROM public.reservas_auditorio r
    INNER JOIN public.horarios_intercalados_auditorio h ON h.reserva_id = r.id
    WHERE r.estado <> 'Cancelada'::public.auditorio_estado_enum
      AND (
        (h.fecha_especifica + h.hora_inicio) BETWEEN ${startSql}::timestamp AND ${endSql}::timestamp
        OR (${startSql}::timestamp BETWEEN (h.fecha_especifica + h.hora_inicio) AND (h.fecha_especifica + h.hora_fin))
      )
    ORDER BY (h.fecha_especifica + h.hora_inicio) ASC, h.hora_fin ASC
  `, 6000, "Prisma auditorio notifications query timeout");

  const reservationIds = Array.from(new Set(rows.map((row) => row.reserva_id)));
  const encargadosByReserva = new Map<string, AuditorioEncargado[]>();
  const horariosByReserva = new Map<string, Array<{ id: string; fechaEspecifica: string; horaInicio: string; horaFin: string }>>();
  const reservaById = new Map<string, {
    nombreEvento: string;
    organizador: string;
    estado: AuditorioEstado;
    fechaInicioPeriodo: string;
    fechaFinPeriodo: string;
    numeroAsistentes: number;
    requierePantalla: boolean;
    requiereSonido: boolean;
    requiereMonitor: boolean;
    requiereProyector: boolean;
    requiereFiltroAgua: boolean;
    observaciones: string | null;
  }>();

  if (reservationIds.length > 0) {
    const requerimientosColumns = await getAuditorioRequerimientosColumns();
    const monitorSelect = requerimientosColumns.requiereMonitor
      ? `r.${quoteIdentifier(requerimientosColumns.requiereMonitor)} AS requiere_monitor,`
      : "false AS requiere_monitor,";
    const proyectorSelect = requerimientosColumns.requiereProyector
      ? `r.${quoteIdentifier(requerimientosColumns.requiereProyector)} AS requiere_proyector,`
      : "false AS requiere_proyector,";
    const filtroAguaSelect = requerimientosColumns.requiereFiltroAgua
      ? `r.${quoteIdentifier(requerimientosColumns.requiereFiltroAgua)} AS requiere_filtro_agua,`
      : "false AS requiere_filtro_agua,";

    const reservasRows = await withTimeout(prisma.$queryRawUnsafe<Array<{
      reserva_id: string;
      nombre_evento: string;
      organizador: string;
      estado: AuditorioEstado;
      fecha_inicio_periodo: string;
      fecha_fin_periodo: string;
      numero_asistentes: number;
      requiere_pantalla: boolean;
      requiere_sonido: boolean;
      requiere_monitor: boolean;
      requiere_proyector: boolean;
      requiere_filtro_agua: boolean;
      observaciones: string | null;
    }>>(
      `
      SELECT
        r.id::text AS reserva_id,
        r.nombre_evento,
        r.organizador,
        r.estado,
        TO_CHAR(r.fecha_inicio_periodo, 'YYYY-MM-DD') AS fecha_inicio_periodo,
        TO_CHAR(r.fecha_fin_periodo, 'YYYY-MM-DD') AS fecha_fin_periodo,
        r.numero_asistentes,
        r.requiere_pantalla,
        r.requiere_sonido,
        ${monitorSelect}
        ${proyectorSelect}
        ${filtroAguaSelect}
        r.observaciones
      FROM public.reservas_auditorio r
      WHERE r.id::text = ANY($1)
    `,
      reservationIds
    ), 6000, "Prisma auditorio reservas details timeout");

    for (const row of reservasRows) {
      reservaById.set(row.reserva_id, {
        nombreEvento: row.nombre_evento,
        organizador: row.organizador,
        estado: row.estado,
        fechaInicioPeriodo: row.fecha_inicio_periodo,
        fechaFinPeriodo: row.fecha_fin_periodo,
        numeroAsistentes: Number(row.numero_asistentes ?? 0),
        requierePantalla: Boolean(row.requiere_pantalla),
        requiereSonido: Boolean(row.requiere_sonido),
        requiereMonitor: Boolean(row.requiere_monitor),
        requiereProyector: Boolean(row.requiere_proyector),
        requiereFiltroAgua: Boolean(row.requiere_filtro_agua),
        observaciones: row.observaciones,
      });
    }

    const horariosRows = await withTimeout(prisma.$queryRaw<Array<{
      reserva_id: string;
      horario_id: string;
      fecha_especifica: string;
      hora_inicio: string;
      hora_fin: string;
    }>>`
      SELECT
        h.reserva_id::text AS reserva_id,
        h.id::text AS horario_id,
        TO_CHAR(h.fecha_especifica, 'YYYY-MM-DD') AS fecha_especifica,
        TO_CHAR(h.hora_inicio, 'HH24:MI') AS hora_inicio,
        TO_CHAR(h.hora_fin, 'HH24:MI') AS hora_fin
      FROM public.horarios_intercalados_auditorio h
      WHERE h.reserva_id::text = ANY(${reservationIds})
      ORDER BY h.fecha_especifica ASC, h.hora_inicio ASC
    `, 6000, "Prisma auditorio horarios timeout");

    for (const row of horariosRows) {
      const bucket = horariosByReserva.get(row.reserva_id) ?? [];
      bucket.push({
        id: row.horario_id,
        fechaEspecifica: row.fecha_especifica,
        horaInicio: row.hora_inicio,
        horaFin: row.hora_fin,
      });
      horariosByReserva.set(row.reserva_id, bucket);
    }

    const encargadosRows = await withTimeout(prisma.$queryRaw<Array<{
      reserva_id: string;
      staff_id: string;
      cedula: string;
      numero_staff: number;
      nombres: string;
      apellidos: string;
      rol: string;
      estado: string;
    }>>`
      SELECT
        a.reserva_id::text AS reserva_id,
        s.id::text AS staff_id,
        s.cedula,
        s.numero_staff,
        s.nombres,
        s.apellidos,
        s.rol,
        s.estado::text AS estado
      FROM public.auditorio_reserva_encargados a
      INNER JOIN public.staff s ON s.id = a.staff_id
      WHERE a.reserva_id::text = ANY(${reservationIds})
      ORDER BY a.reserva_id, s.nombres, s.apellidos
    `, 6000, "Prisma auditorio encargados timeout");

    for (const row of encargadosRows) {
      const bucket = encargadosByReserva.get(row.reserva_id) ?? [];
      bucket.push({
        staffId: row.staff_id,
        cedula: row.cedula,
        numeroStaff: Number(row.numero_staff ?? 0),
        nombreCompleto: `${row.nombres} ${row.apellidos}`.trim(),
        rol: row.rol,
        estado: row.estado,
      });
      encargadosByReserva.set(row.reserva_id, bucket);
    }
  }

  const nowTime = now.getTime();

  return rows
    .filter((row) => {
      const eventDay = new Date(`${row.fecha_especifica}T00:00:00`);
      const notificationStartMs = previousBusinessDay(eventDay).getTime();
      const notificationEndMs = new Date(row.ends_at).getTime();

      if (!Number.isFinite(notificationEndMs) || nowTime < notificationStartMs || nowTime > notificationEndMs) {
        return false;
      }

      if (!options?.assignedStaffId) {
        return true;
      }

      const workers = encargadosByReserva.get(row.reserva_id) ?? [];
      return workers.some((worker) => worker.staffId === options.assignedStaffId);
    })
    .map((row) => {
      const reserva = reservaById.get(row.reserva_id);

      return {
        id: `${row.reserva_id}:${row.horario_id}`,
        reservaId: row.reserva_id,
        nombreEvento: reserva?.nombreEvento ?? row.nombre_evento,
        organizador: reserva?.organizador ?? row.organizador,
        estado: reserva?.estado ?? row.estado,
        fechaInicioPeriodo: reserva?.fechaInicioPeriodo ?? row.fecha_especifica,
        fechaFinPeriodo: reserva?.fechaFinPeriodo ?? row.fecha_especifica,
        numeroAsistentes: reserva?.numeroAsistentes ?? 0,
        requierePantalla: reserva?.requierePantalla ?? false,
        requiereSonido: reserva?.requiereSonido ?? false,
        requiereMonitor: reserva?.requiereMonitor ?? false,
        requiereProyector: reserva?.requiereProyector ?? false,
        requiereFiltroAgua: reserva?.requiereFiltroAgua ?? false,
        observaciones: reserva?.observaciones ?? null,
        fechaEspecifica: row.fecha_especifica,
        horaInicio: row.hora_inicio,
        horaFin: row.hora_fin,
        startsAt: row.starts_at,
        notificationType: nowTime >= new Date(row.starts_at).getTime() && nowTime <= new Date(row.ends_at).getTime() ? "en_curso" : "proximo",
        horarios: horariosByReserva.get(row.reserva_id) ?? [],
        assignedWorkers: encargadosByReserva.get(row.reserva_id) ?? [],
      };
    });
};

export const listPendingAuditorioNotifications = async (): Promise<PendingAuditorioNotification[]> => {
  const rows = await withTimeout(prisma.$queryRaw<Array<{
    reserva_id: string;
    nombre_evento: string;
    organizador: string;
    fecha_inicio_periodo: string;
    fecha_fin_periodo: string;
    numero_asistentes: number;
    created_at: string;
    first_horario_date: string | null;
    first_horario_start: string | null;
    first_horario_end: string | null;
  }>>`
    SELECT
      r.id::text AS reserva_id,
      r.nombre_evento,
      r.organizador,
      TO_CHAR(r.fecha_inicio_periodo, 'YYYY-MM-DD') AS fecha_inicio_periodo,
      TO_CHAR(r.fecha_fin_periodo, 'YYYY-MM-DD') AS fecha_fin_periodo,
      r.numero_asistentes,
      TO_CHAR(r.fecha_creacion, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
      CASE WHEN h.fecha_especifica IS NULL THEN NULL ELSE TO_CHAR(h.fecha_especifica, 'YYYY-MM-DD') END AS first_horario_date,
      CASE WHEN h.hora_inicio IS NULL THEN NULL ELSE TO_CHAR(h.hora_inicio, 'HH24:MI') END AS first_horario_start,
      CASE WHEN h.hora_fin IS NULL THEN NULL ELSE TO_CHAR(h.hora_fin, 'HH24:MI') END AS first_horario_end
    FROM public.reservas_auditorio r
    LEFT JOIN LATERAL (
      SELECT
        hi.fecha_especifica,
        hi.hora_inicio,
        hi.hora_fin
      FROM public.horarios_intercalados_auditorio hi
      WHERE hi.reserva_id = r.id
      ORDER BY hi.fecha_especifica ASC, hi.hora_inicio ASC
      LIMIT 1
    ) h ON TRUE
    WHERE r.estado = 'Pendiente'::public.auditorio_estado_enum
    ORDER BY r.fecha_creacion DESC
    LIMIT 25
  `, 6000, "Prisma auditorio pending notifications timeout");

  return rows.map((row) => ({
    id: `pending:${row.reserva_id}`,
    reservaId: row.reserva_id,
    nombreEvento: row.nombre_evento,
    organizador: row.organizador,
    fechaInicioPeriodo: row.fecha_inicio_periodo,
    fechaFinPeriodo: row.fecha_fin_periodo,
    numeroAsistentes: Number(row.numero_asistentes ?? 0),
    createdAt: row.created_at,
    firstHorarioDate: row.first_horario_date,
    firstHorarioStart: row.first_horario_start,
    firstHorarioEnd: row.first_horario_end,
  }));
};

export const createReservaAuditorio = async (payload: CreateReservaAuditorioInput) => {
  return prisma.$transaction(async (tx) => {
    await ensureAuditorioEncargadosTableReady();

    const requerimientosColumns = await getAuditorioRequerimientosColumns();
    const columns = [
      "nombre_evento",
      "organizador",
      "fecha_inicio_periodo",
      "fecha_fin_periodo",
      "numero_asistentes",
      "requiere_pantalla",
      "requiere_sonido",
    ];
    const values = [
      "$1",
      "$2",
      "$3::date",
      "$4::date",
      "$5",
      "$6",
      "$7",
    ];
    const params: Array<string | number | boolean | null> = [
      payload.nombreEvento,
      payload.organizador,
      toIsoDate(payload.fechaInicioPeriodo),
      toIsoDate(payload.fechaFinPeriodo),
      payload.numeroAsistentes,
      payload.requierePantalla,
      payload.requiereSonido,
    ];

    if (requerimientosColumns.requiereMonitor) {
      columns.push(quoteIdentifier(requerimientosColumns.requiereMonitor));
      values.push(`$${params.length + 1}`);
      params.push(payload.requiereMonitor);
    }

    if (requerimientosColumns.requiereProyector) {
      columns.push(quoteIdentifier(requerimientosColumns.requiereProyector));
      values.push(`$${params.length + 1}`);
      params.push(payload.requiereProyector);
    }

    if (requerimientosColumns.requiereFiltroAgua) {
      columns.push(quoteIdentifier(requerimientosColumns.requiereFiltroAgua));
      values.push(`$${params.length + 1}`);
      params.push(payload.requiereFiltroAgua);
    }

    columns.push("observaciones", "estado");
    values.push(`$${params.length + 1}`, `$${params.length + 2}::public.auditorio_estado_enum`);
    params.push(payload.observaciones, payload.estado);

    // Optional requester fields (may not exist in older DBs)
    columns.push("solicitante_nombre", "solicitante_telefono");
    values.push(`$${params.length + 1}`, `$${params.length + 2}`);
    params.push(payload.solicitanteNombre ?? null, payload.solicitanteTelefono ?? null);

    const reserva = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `
      INSERT INTO public.reservas_auditorio (
        ${columns.join(",\n        ")}
      )
      VALUES (
        ${values.join(",\n        ")}
      )
      RETURNING id::text AS id
    `,
      ...params
    );

    const reservaId = reserva[0]?.id;
    if (!reservaId) {
      throw new Error("No se pudo crear la reserva de auditorio");
    }

    for (const horario of payload.horarios) {
      await tx.$executeRaw`
        INSERT INTO public.horarios_intercalados_auditorio (
          reserva_id,
          fecha_especifica,
          hora_inicio,
          hora_fin
        )
        VALUES (
          ${reservaId}::uuid,
          ${toIsoDate(horario.fechaEspecifica)}::date,
          ${horario.horaInicio}::time,
          ${horario.horaFin}::time
        )
      `;
    }

    await syncReservaEncargadosTx(tx, reservaId, payload.encargadoStaffIds);

    return { reservaId };
  });
};

export const updateReservaAuditorio = async (payload: UpdateReservaAuditorioInput) => {
  return prisma.$transaction(async (tx) => {
    await ensureAuditorioEncargadosTableReady();

    const requerimientosColumns = await getAuditorioRequerimientosColumns();
    const assignments = [
      "nombre_evento = $1",
      "organizador = $2",
      "fecha_inicio_periodo = $3::date",
      "fecha_fin_periodo = $4::date",
      "numero_asistentes = $5",
      "requiere_pantalla = $6",
      "requiere_sonido = $7",
    ];
    const params: Array<string | number | boolean | null> = [
      payload.nombreEvento,
      payload.organizador,
      toIsoDate(payload.fechaInicioPeriodo),
      toIsoDate(payload.fechaFinPeriodo),
      payload.numeroAsistentes,
      payload.requierePantalla,
      payload.requiereSonido,
    ];

    if (requerimientosColumns.requiereMonitor) {
      assignments.push(`${quoteIdentifier(requerimientosColumns.requiereMonitor)} = $${params.length + 1}`);
      params.push(payload.requiereMonitor);
    }

    if (requerimientosColumns.requiereProyector) {
      assignments.push(`${quoteIdentifier(requerimientosColumns.requiereProyector)} = $${params.length + 1}`);
      params.push(payload.requiereProyector);
    }

    if (requerimientosColumns.requiereFiltroAgua) {
      assignments.push(`${quoteIdentifier(requerimientosColumns.requiereFiltroAgua)} = $${params.length + 1}`);
      params.push(payload.requiereFiltroAgua);
    }

    // optional requester fields
    assignments.push("solicitante_nombre = $" + (params.length + 1));
    params.push(payload.solicitanteNombre ?? null);
    assignments.push("solicitante_telefono = $" + (params.length + 1));
    params.push(payload.solicitanteTelefono ?? null);

    assignments.push(
      `observaciones = $${params.length + 1}`,
      `estado = $${params.length + 2}::public.auditorio_estado_enum`
    );
    params.push(payload.observaciones, payload.estado);

    const whereIdParam = `$${params.length + 1}`;
    params.push(payload.id);

    const updated = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `
      UPDATE public.reservas_auditorio
      SET
        ${assignments.join(",\n        ")}
      WHERE id = ${whereIdParam}::uuid
      RETURNING id::text AS id
    `,
      ...params
    );

    if (!updated[0]?.id) {
      throw new Error("No se encontro la reserva de auditorio a modificar");
    }

    await tx.$executeRaw`
      DELETE FROM public.horarios_intercalados_auditorio
      WHERE reserva_id = ${payload.id}::uuid
    `;

    for (const horario of payload.horarios) {
      await tx.$executeRaw`
        INSERT INTO public.horarios_intercalados_auditorio (
          reserva_id,
          fecha_especifica,
          hora_inicio,
          hora_fin
        )
        VALUES (
          ${payload.id}::uuid,
          ${toIsoDate(horario.fechaEspecifica)}::date,
          ${horario.horaInicio}::time,
          ${horario.horaFin}::time
        )
      `;
    }

    await syncReservaEncargadosTx(tx, payload.id, payload.encargadoStaffIds);

    return { reservaId: payload.id };
  });
};

export const updateEstadoReservaAuditorio = async (id: string, estado: AuditorioEstado) => {
  const updated = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE public.reservas_auditorio
    SET estado = ${estado}::public.auditorio_estado_enum
    WHERE id = ${id}::uuid
    RETURNING id::text AS id
  `;

  if (!updated[0]?.id) {
    throw new Error("No se encontro la reserva de auditorio a modificar");
  }

  return { reservaId: id };
};

export const deleteReservaAuditorio = async (id: string) => {
  const deleted = await prisma.$queryRaw<Array<{ id: string }>>`
    DELETE FROM public.reservas_auditorio
    WHERE id = ${id}::uuid
    RETURNING id::text AS id
  `;

  if (!deleted[0]?.id) {
    throw new Error("No se encontro la reserva de auditorio a eliminar");
  }

  return { reservaId: id };
};

export const buildReservasAuditorioHistoryExcel = async () => {
  const reservas = await listReservasAuditorio();

  const rows = reservas.flatMap((reserva) => {
    if (reserva.horarios.length === 0) {
      return [
        {
          "ID Reserva": reserva.id,
          "Evento": reserva.nombreEvento,
          "Organizador": reserva.organizador,
          "Estado": reserva.estado,
          "Fecha Creacion": reserva.fechaCreacion,
          "Fecha Inicio Periodo": reserva.fechaInicioPeriodo,
          "Fecha Fin Periodo": reserva.fechaFinPeriodo,
          "Asistentes": reserva.numeroAsistentes,
          "Pantalla": reserva.requierePantalla ? "Si" : "No",
          "Sonido": reserva.requiereSonido ? "Si" : "No",
          "Monitor": reserva.requiereMonitor ? "Si" : "No",
          "Proyector": reserva.requiereProyector ? "Si" : "No",
          "Filtro Agua": reserva.requiereFiltroAgua ? "Si" : "No",
          "Encargados": reserva.encargados.map((item) => item.nombreCompleto).join(", "),
          "Fecha Bloque": "",
          "Hora Inicio Bloque": "",
          "Hora Fin Bloque": "",
          "Observaciones": reserva.observaciones ?? "",
        },
      ];
    }

    return reserva.horarios.map((horario) => ({
      "ID Reserva": reserva.id,
      "Evento": reserva.nombreEvento,
      "Organizador": reserva.organizador,
      "Estado": reserva.estado,
      "Fecha Creacion": reserva.fechaCreacion,
      "Fecha Inicio Periodo": reserva.fechaInicioPeriodo,
      "Fecha Fin Periodo": reserva.fechaFinPeriodo,
      "Asistentes": reserva.numeroAsistentes,
      "Pantalla": reserva.requierePantalla ? "Si" : "No",
      "Sonido": reserva.requiereSonido ? "Si" : "No",
      "Monitor": reserva.requiereMonitor ? "Si" : "No",
      "Proyector": reserva.requiereProyector ? "Si" : "No",
      "Filtro Agua": reserva.requiereFiltroAgua ? "Si" : "No",
      "Encargados": reserva.encargados.map((item) => item.nombreCompleto).join(", "),
      "Fecha Bloque": horario.fechaEspecifica,
      "Hora Inicio Bloque": horario.horaInicio,
      "Hora Fin Bloque": horario.horaFin,
      "Observaciones": reserva.observaciones ?? "",
    }));
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Historial Auditorio");

  const buffer = XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }) as Buffer;

  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;

  return {
    buffer,
    fileName: `historial_auditorio_${stamp}.xlsx`,
  };
};
