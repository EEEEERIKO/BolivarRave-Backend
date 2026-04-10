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

const getAuditorioRequerimientosColumns = async (): Promise<AuditorioRequerimientosColumns> => {
  const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'reservas_auditorio'
  `;

  const available = new Set(columns.map((row) => row.column_name));

  return {
    requiereMonitor: pickExistingColumn(available, ["requiere_monitor", "requiereMonitor"]),
    requiereProyector: pickExistingColumn(available, ["requiere_proyector", "requiereProyector"]),
    requiereFiltroAgua: pickExistingColumn(available, ["requiere_filtro_agua", "requiereFiltroAgua"]),
  };
};

export const listReservasAuditorio = async () => {
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

    return { reservaId };
  });
};

export const updateReservaAuditorio = async (payload: UpdateReservaAuditorioInput) => {
  return prisma.$transaction(async (tx) => {
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
