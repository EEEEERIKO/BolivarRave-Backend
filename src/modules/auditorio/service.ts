import { prisma } from "../../lib/prisma";

export type AuditorioEstado = "Pendiente" | "Aprobada" | "Cancelada";

export type AuditorioHorarioInput = {
  fechaEspecifica: Date;
  horaInicio: string;
  horaFin: string;
};

export type CreateReservaAuditorioInput = {
  nombreEvento: string;
  organizador: string;
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
};

export type UpdateReservaAuditorioInput = CreateReservaAuditorioInput & {
  id: string;
};

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);

export const listReservasAuditorio = async () => {
  const rows = await prisma.$queryRaw<Array<{
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
    estado: AuditorioEstado;
    fecha_creacion: string;
    horario_id: string | null;
    fecha_especifica: string | null;
    hora_inicio: string | null;
    hora_fin: string | null;
  }>>`
    SELECT
      r.id::text AS id,
      r.nombre_evento,
      r.organizador,
      TO_CHAR(r.fecha_inicio_periodo, 'YYYY-MM-DD') AS fecha_inicio_periodo,
      TO_CHAR(r.fecha_fin_periodo, 'YYYY-MM-DD') AS fecha_fin_periodo,
      r.numero_asistentes,
      r.requiere_pantalla,
      r.requiere_sonido,
      r.requiere_monitor,
      r.requiere_proyector,
      r.requiere_filtro_agua,
      r.observaciones,
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
  `;

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
    estado: AuditorioEstado;
    fechaCreacion: string;
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

  return Array.from(byId.values());
};

export const createReservaAuditorio = async (payload: CreateReservaAuditorioInput) => {
  return prisma.$transaction(async (tx) => {
    const reserva = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.reservas_auditorio (
        nombre_evento,
        organizador,
        fecha_inicio_periodo,
        fecha_fin_periodo,
        numero_asistentes,
        requiere_pantalla,
        requiere_sonido,
        requiere_monitor,
        requiere_proyector,
        requiere_filtro_agua,
        observaciones,
        estado
      )
      VALUES (
        ${payload.nombreEvento},
        ${payload.organizador},
        ${toIsoDate(payload.fechaInicioPeriodo)}::date,
        ${toIsoDate(payload.fechaFinPeriodo)}::date,
        ${payload.numeroAsistentes},
        ${payload.requierePantalla},
        ${payload.requiereSonido},
        ${payload.requiereMonitor},
        ${payload.requiereProyector},
        ${payload.requiereFiltroAgua},
        ${payload.observaciones},
        ${payload.estado}::public.auditorio_estado_enum
      )
      RETURNING id::text AS id
    `;

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

    return { reservaId };
  });
};

export const updateReservaAuditorio = async (payload: UpdateReservaAuditorioInput) => {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE public.reservas_auditorio
      SET
        nombre_evento = ${payload.nombreEvento},
        organizador = ${payload.organizador},
        fecha_inicio_periodo = ${toIsoDate(payload.fechaInicioPeriodo)}::date,
        fecha_fin_periodo = ${toIsoDate(payload.fechaFinPeriodo)}::date,
        numero_asistentes = ${payload.numeroAsistentes},
        requiere_pantalla = ${payload.requierePantalla},
        requiere_sonido = ${payload.requiereSonido},
        requiere_monitor = ${payload.requiereMonitor},
        requiere_proyector = ${payload.requiereProyector},
        requiere_filtro_agua = ${payload.requiereFiltroAgua},
        observaciones = ${payload.observaciones},
        estado = ${payload.estado}::public.auditorio_estado_enum
      WHERE id = ${payload.id}::uuid
      RETURNING id::text AS id
    `;

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
