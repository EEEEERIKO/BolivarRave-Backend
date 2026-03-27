import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { GroupedClass, ParsedScheduleRow } from "./types";

type ImportMeta = {
  conflictsDetected?: number | undefined;
  conflictsAccepted?: number | undefined;
  conflictsRejected?: number | undefined;
  importedBy?: string | undefined;
};

type ReservationTypeKey = "normal" | "momentanea" | "iglesia";

type CreateScheduleEventInput = {
  reservationType: ReservationTypeKey;
  faculty: string;
  code: string;
  subject: string;
  teacher: string;
  startDate: Date;
  endDate: Date;
  slots: Array<{
    day: string;
    room: string;
    startTime: string;
    endTime: string;
  }>;
};

type UpdateScheduleEventSlotInput = {
  eventId: string;
  slotId: string;
  faculty: string;
  code: string;
  subject: string;
  teacher: string;
  startDate: Date;
  endDate: Date;
  day: string;
  room: string;
  startTime: string;
  endTime: string;
};

const ensureImportsHistoryTable = async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.schedule_import_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      source_file text NOT NULL,
      imported_at timestamptz NOT NULL DEFAULT now(),
      rows_count integer NOT NULL,
      classes_count integer NOT NULL,
      slots_count integer NOT NULL,
      conflicts_detected integer NOT NULL DEFAULT 0,
      conflicts_accepted integer NOT NULL DEFAULT 0,
      conflicts_rejected integer NOT NULL DEFAULT 0,
      imported_by text,
      status text NOT NULL DEFAULT 'success'
    )
  `);
};

const COLORS: GroupedClass["color"][] = ["blue", "emerald", "amber", "violet"];

const colorForKey = (key: string): GroupedClass["color"] => {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash << 5) - hash + key.charCodeAt(i);
  return COLORS[Math.abs(hash) % COLORS.length] ?? "blue";
};

const cleanText = (value: string) =>
  value
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF\uFFFD]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const classKey = (row: ParsedScheduleRow) =>
  [
    cleanText(row.faculty),
    cleanText(row.code),
    cleanText(row.subject),
    cleanText(row.teacher),
    row.startDate.toISOString(),
    row.endDate.toISOString(),
  ].join("|");

const dayOrder: Record<string, number> = {
  Lunes: 1,
  Martes: 2,
  Miercoles: 3,
  Jueves: 4,
  Viernes: 5,
  Sabado: 6,
  Domingo: 7,
};

const roomKey = (room: string) =>
  room
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const roomCanonicalMap: Record<string, string> = {
  [roomKey("Salón 506 MD")]: "Salón 506",
  [roomKey("Salón 505 MD")]: "Salón 505",
  [roomKey("Salón 402 MD")]: "Salón 402",
  [roomKey("Salón 401 MD")]: "Salón 401",
  [roomKey("Salón 304 MD")]: "Salón 304",
  [roomKey("Salón 301 MD")]: "Salón 301",
  [roomKey("Aula Foro Unión 101")]: "Aula Foro Unión 101",
  [roomKey("Aula Foro Union")]: "Aula Foro Unión 101",
  [roomKey("Aula Foro Union 101")]: "Aula Foro Unión 101",
  [roomKey("Aula Foro UNAC 102")]: "Aula Foro Unac 102",
  [roomKey("Aula Foro UNAC")]: "Aula Foro Unac 102",
  [roomKey("Aula Foro Unac 102")]: "Aula Foro Unac 102",
  [roomKey("Sala Informatica 1 Bolivar")]: "Sala Informática 1 Bolivar",
  [roomKey("Sala de Informatica 1 Bolivar")]: "Sala Informática 1 Bolivar",
  [roomKey("Sala Informatica 2 Bolivar")]: "Sala Informática 2 Bolivar",
  [roomKey("Sala de Informatica 2 Bolivar")]: "Sala Informática 2 Bolivar",
  [roomKey("Laboratorio de analisis de datos y simulacion financiera")]: "Laboratorio de análisis de datos y simulación financiera 403",
  [roomKey("Laboratorio de simulacion financiera")]: "Laboratorio de análisis de datos y simulación financiera 403",
  [roomKey("Laboratorio de simulación financiera 403")]: "Laboratorio de análisis de datos y simulación financiera 403",
  [roomKey("Laboratorio de Desarrollo de Software LDS")]: "Laboratorio de Desarrollo de Software (LDS) 404",
  [roomKey("Laboratorio de Desarrollo de Software")]: "Laboratorio de Desarrollo de Software (LDS) 404",
  [roomKey("Laboratorio de Fisica")]: "Laboratorio Múltiple de Física 405",
  [roomKey("Laboratorio de Musica")]: "Laboratorio de Música 308",
  [roomKey("Laboratorio de Infantil")]: "Laboratorio de Infantil 204",
  [roomKey("Aula Interamericana 1")]: "Aula Interamericana 501",
  [roomKey("Aula Interamericana 2")]: "Aula Interamericana 502",
  [roomKey("Aula Interamericana 3")]: "Aula Interamericana 503",
};

const roomDisplayOrder = [
  "Aula Foro Unión 101",
  "Aula Foro Unac 102",
  "Sala Informática 1 Bolivar",
  "Sala Informática 2 Bolivar",
  "Salón 201",
  "Salón 202",
  "Salón 203",
  "Laboratorio de Infantil 204",
  "Salón 205",
  "Salón 206",
  "Salón 301",
  "Salón 302",
  "Salón 303",
  "Salón 304",
  "Salón 305",
  "Laboratorio de Música 308",
  "Salón 401",
  "Salón 402",
  "Laboratorio de análisis de datos y simulación financiera 403",
  "Laboratorio de Desarrollo de Software (LDS) 404",
  "Laboratorio Múltiple de Física 405",
  "Salón 406",
  "Aula Interamericana 501",
  "Aula Interamericana 502",
  "Aula Interamericana 503",
  "Salón 505",
  "Salón 506",
] as const;

const OFFICIAL_ROOM_SET = new Set<string>(roomDisplayOrder);

const officialRoomSeed: Array<{ nombre: string; piso: number | null; capacidad: number | null }> = [
  { nombre: "Aula Foro Unión 101", piso: 1, capacidad: 60 },
  { nombre: "Aula Foro Unac 102", piso: 1, capacidad: 60 },
  { nombre: "Sala Informática 1 Bolivar", piso: 1, capacidad: 25 },
  { nombre: "Sala Informática 2 Bolivar", piso: 1, capacidad: 25 },
  { nombre: "Salón 201", piso: 2, capacidad: 40 },
  { nombre: "Salón 202", piso: 2, capacidad: 40 },
  { nombre: "Salón 203", piso: 2, capacidad: 40 },
  { nombre: "Laboratorio de Infantil 204", piso: 2, capacidad: 40 },
  { nombre: "Salón 205", piso: 2, capacidad: 46 },
  { nombre: "Salón 206", piso: 2, capacidad: 40 },
  { nombre: "Salón 301", piso: 3, capacidad: 40 },
  { nombre: "Salón 302", piso: 3, capacidad: 62 },
  { nombre: "Salón 303", piso: 3, capacidad: 48 },
  { nombre: "Salón 304", piso: 3, capacidad: 40 },
  { nombre: "Salón 305", piso: 3, capacidad: 69 },
  { nombre: "Laboratorio de Música 308", piso: 3, capacidad: 40 },
  { nombre: "Salón 401", piso: 4, capacidad: 40 },
  { nombre: "Salón 402", piso: 4, capacidad: 45 },
  { nombre: "Laboratorio de análisis de datos y simulación financiera 403", piso: 4, capacidad: 40 },
  { nombre: "Laboratorio de Desarrollo de Software (LDS) 404", piso: 4, capacidad: 40 },
  { nombre: "Laboratorio Múltiple de Física 405", piso: 4, capacidad: 44 },
  { nombre: "Salón 406", piso: 4, capacidad: 42 },
  { nombre: "Aula Interamericana 501", piso: 5, capacidad: 55 },
  { nombre: "Aula Interamericana 502", piso: 5, capacidad: 55 },
  { nombre: "Aula Interamericana 503", piso: 5, capacidad: 55 },
  { nombre: "Salón 505", piso: 5, capacidad: 50 },
  { nombre: "Salón 506", piso: 5, capacidad: 40 },
];

const ensureOfficialRoomCatalog = async (
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
) => {
  for (const room of officialRoomSeed) {
    await tx.$executeRaw`
      INSERT INTO public.salones (nombre_bloque, capacidad, piso)
      VALUES (${room.nombre}, ${room.capacidad}, ${room.piso})
      ON CONFLICT (nombre_bloque) DO UPDATE
      SET
        capacidad = EXCLUDED.capacidad,
        piso = EXCLUDED.piso
    `;
  }
};

const canonicalRoomDisplayMap = new Map(roomDisplayOrder.map((room) => [roomKey(room), room]));

const roomAliasPatterns: Array<{ pattern: RegExp; canonical: string }> = [
  {
    pattern: /^aula foro union( 101)?$/,
    canonical: "Aula Foro Unión 101",
  },
  {
    pattern: /^aula foro unac( 102)?$/,
    canonical: "Aula Foro Unac 102",
  },
  {
    pattern: /^sala( de)? informatica 1 bolivar$/,
    canonical: "Sala Informática 1 Bolivar",
  },
  {
    pattern: /^sala( de)? informatica 2 bolivar$/,
    canonical: "Sala Informática 2 Bolivar",
  },
  {
    pattern: /^laboratorio de (analisis de datos y )?simulacion financiera( 403)?$/,
    canonical: "Laboratorio de análisis de datos y simulación financiera 403",
  },
  {
    pattern: /^laboratorio de desarrollo de software( lds)?( 404)?$/,
    canonical: "Laboratorio de Desarrollo de Software (LDS) 404",
  },
  {
    pattern: /^laboratorio de fisica( 405)?$/,
    canonical: "Laboratorio Múltiple de Física 405",
  },
  {
    pattern: /^laboratorio de musica( 308)?$/,
    canonical: "Laboratorio de Música 308",
  },
  {
    pattern: /^laboratorio de infantil( 204)?$/,
    canonical: "Laboratorio de Infantil 204",
  },
  {
    pattern: /^aula interamericana (501|1)$/,
    canonical: "Aula Interamericana 501",
  },
  {
    pattern: /^aula interamericana (502|2)$/,
    canonical: "Aula Interamericana 502",
  },
  {
    pattern: /^aula interamericana (503|3)$/,
    canonical: "Aula Interamericana 503",
  },
];

const canonicalRoomName = (room: string): string | null => {
  const normalized = roomKey(room).replace(/\bmd\b/g, " ").replace(/\s+/g, " ").trim();

  const directCanonical = roomCanonicalMap[normalized] ?? canonicalRoomDisplayMap.get(normalized);
  if (directCanonical) return OFFICIAL_ROOM_SET.has(directCanonical) ? directCanonical : null;

  const aliasPattern = roomAliasPatterns.find(({ pattern }) => pattern.test(normalized));
  if (aliasPattern) return OFFICIAL_ROOM_SET.has(aliasPattern.canonical) ? aliasPattern.canonical : null;

  const directMatch = canonicalRoomDisplayMap.get(normalized);
  if (directMatch) return directMatch;

  return null;
};

const toMinutes = (time: string) => {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return h * 60 + m;
};

const RESERVA_SEMESTRE_ID = 1;
const RESERVA_MOMENTANEA_ID = 2;
const RESERVA_IGLESIA_ID = 3;

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);

const reservationTypeToId = (type: ReservationTypeKey) => {
  if (type === "momentanea") return RESERVA_MOMENTANEA_ID;
  if (type === "iglesia") return RESERVA_IGLESIA_ID;
  return RESERVA_SEMESTRE_ID;
};

const resolveFacultadId = async (
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  facultyIdByName: Map<string, string>,
  facultyName: string
) => {
  let facultadId = facultyIdByName.get(facultyName);
  if (!facultadId) {
    facultadId = (
      await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO public.facultades (nombre)
        VALUES (${facultyName})
        ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre
        RETURNING id::text AS id
      `
    )[0]?.id;

    if (facultadId) {
      facultyIdByName.set(facultyName, facultadId);
    }
  }

  if (!facultadId) {
    throw new Error(`No se pudo resolver la facultad '${facultyName}'`);
  }

  return facultadId;
};

const resolveSalonId = async (
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  roomIdByName: Map<string, string>,
  roomName: string
) => {
  let salonId = roomIdByName.get(roomName);

  if (!salonId) {
    throw new Error(`El salon '${roomName}' no existe en catalogo oficial`);
  }

  return salonId;
};

const mergeContiguousSlots = (slots: GroupedClass["slots"]) => {
  const sorted = [...slots].sort((a, b) => {
    const dayDelta = (dayOrder[a.day] ?? 99) - (dayOrder[b.day] ?? 99);
    if (dayDelta !== 0) return dayDelta;

    if (a.room !== b.room) return a.room.localeCompare(b.room);
    return toMinutes(a.startTime) - toMinutes(b.startTime);
  });

  const merged: GroupedClass["slots"] = [];
  for (const slot of sorted) {
    const last = merged[merged.length - 1];
    if (last && last.day === slot.day && last.room === slot.room && last.endTime === slot.startTime) {
      last.endTime = slot.endTime;
    } else {
      merged.push({ ...slot });
    }
  }

  return merged;
};

export const groupRowsIntoClasses = (rows: ParsedScheduleRow[]): GroupedClass[] => {
  const map = new Map<string, GroupedClass>();

  rows.forEach((row) => {
    const key = classKey(row);
    if (!map.has(key)) {
      map.set(key, {
        faculty: cleanText(row.faculty),
        code: cleanText(row.code),
        subject: cleanText(row.subject),
        teacher: cleanText(row.teacher),
        startDate: row.startDate,
        endDate: row.endDate,
        color: colorForKey(key),
        slots: [],
      });
    }

    const current = map.get(key)!;
    const slotKey = `${row.day}|${row.room}|${row.startTime}|${row.endTime}`;
    const exists = current.slots.some(
      (slot) => `${slot.day}|${slot.room}|${slot.startTime}|${slot.endTime}` === slotKey
    );

    if (!exists) {
      current.slots.push({
        day: cleanText(row.day),
        room: cleanText(row.room),
        startTime: row.startTime.trim(),
        endTime: row.endTime.trim(),
      });
    }
  });

  return [...map.values()].map((grouped) => ({
    ...grouped,
    slots: mergeContiguousSlots(grouped.slots),
  }));
};

export const replaceAllSchedulesFromRows = async (
  sourceFile: string,
  rows: ParsedScheduleRow[],
  meta?: ImportMeta
) => {
  const classes = groupRowsIntoClasses(rows);
  const importId = randomUUID();
  const importedAt = new Date();

  await ensureImportsHistoryTable();

  return prisma.$transaction(async (tx) => {
    await ensureOfficialRoomCatalog(tx);

    await tx.$executeRawUnsafe(`TRUNCATE TABLE public.horarios_evento, public.eventos CASCADE`);

    // Elimina salones no oficiales para evitar duplicados heredados de imports antiguos.
    await tx.$executeRawUnsafe(`
      DELETE FROM public.salones
      WHERE nombre_bloque <> ALL(ARRAY[
        ${roomDisplayOrder.map((name) => `'${name.replace(/'/g, "''")}'`).join(",")}
      ]::text[])
    `);

    const facultyIdByName = new Map<string, string>();
    const existingFacultades = await tx.$queryRaw<Array<{ id: string; nombre: string }>>`
      SELECT id::text AS id, nombre
      FROM public.facultades
    `;
    existingFacultades.forEach((facultad) => facultyIdByName.set(facultad.nombre, facultad.id));

    const roomIdByName = new Map<string, string>();
    const existingSalones = await tx.$queryRaw<Array<{ id: string; nombre: string }>>`
      SELECT id::text AS id, nombre_bloque AS nombre
      FROM public.salones
    `;
    existingSalones.forEach((salon) => roomIdByName.set(salon.nombre, salon.id));

    let skippedSlots = 0;
    let skippedClasses = 0;
    let importedClasses = 0;
    let importedSlots = 0;

    for (const cls of classes) {
      cls.slots.forEach((slot) => {
        if (!dayOrder[slot.day]) {
          throw new Error(`Dia invalido en importacion: '${slot.day}'`);
        }
      });

      const validSlots = cls.slots
        .map((slot) => ({ slot, canonicalRoom: canonicalRoomName(slot.room) }))
        .filter((entry) => entry.canonicalRoom !== null);

      skippedSlots += cls.slots.length - validSlots.length;

      if (validSlots.length === 0) {
        skippedClasses += 1;
        continue;
      }

      const facultadId = await resolveFacultadId(tx, facultyIdByName, cls.faculty);

      const evento = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO public.eventos (
          tipo_reserva_id,
          facultad_id,
          codigo_materia,
          nombre_principal,
          responsable,
          actividad,
          fecha_inicio,
          fecha_fin
        )
        VALUES (
          ${RESERVA_SEMESTRE_ID},
          ${facultadId}::uuid,
          ${cls.code},
          ${cls.subject},
          ${cls.teacher},
          ${null},
          ${toIsoDate(cls.startDate)}::date,
          ${toIsoDate(cls.endDate)}::date
        )
        RETURNING id::text AS id
      `;

      const eventoId = evento[0]?.id;
      if (!eventoId) {
        throw new Error(`No se pudo crear el evento para '${cls.code} | ${cls.subject}'`);
      }

      importedClasses += 1;

      for (const { slot, canonicalRoom } of validSlots) {
        const resolvedRoomName = canonicalRoom!;

        const salonId = await resolveSalonId(tx, roomIdByName, resolvedRoomName);

        await tx.$executeRaw`
          INSERT INTO public.horarios_evento (
            evento_id,
            salon_id,
            dia_semana,
            hora_inicio,
            hora_fin
          )
          VALUES (
            ${eventoId}::uuid,
            ${salonId}::uuid,
            ${slot.day}::public.dia_semana_enum,
            ${slot.startTime}::time,
            ${slot.endTime}::time
          )
        `;

        importedSlots += 1;
      }
    }

    await tx.$executeRaw`
      INSERT INTO public.schedule_import_history (
        id,
        source_file,
        imported_at,
        rows_count,
        classes_count,
        slots_count,
        conflicts_detected,
        conflicts_accepted,
        conflicts_rejected,
        imported_by,
        status
      )
      VALUES (
        ${importId}::uuid,
        ${sourceFile},
        ${importedAt.toISOString()}::timestamptz,
        ${rows.length},
        ${importedClasses},
        ${importedSlots},
        ${meta?.conflictsDetected ?? 0},
        ${meta?.conflictsAccepted ?? 0},
        ${meta?.conflictsRejected ?? 0},
        ${meta?.importedBy ?? "frontend-client"},
        ${"success"}
      )
    `;

    return {
      importBatch: {
        id: importId,
        sourceFile,
        importedAt,
      },
      classesCount: importedClasses,
      rowsCount: rows.length,
      slotsCount: importedSlots,
      skippedClasses,
      skippedSlots,
    };
  }, { maxWait: 30000, timeout: 600000 });
};

export const createScheduleEvent = async (payload: CreateScheduleEventInput) => {
  return prisma.$transaction(async (tx) => {
    const facultyIdByName = new Map<string, string>();
    const roomIdByName = new Map<string, string>();

    const facultades = await tx.$queryRaw<Array<{ id: string; nombre: string }>>`
      SELECT id::text AS id, nombre
      FROM public.facultades
    `;
    facultades.forEach((facultad) => facultyIdByName.set(facultad.nombre, facultad.id));

    const salones = await tx.$queryRaw<Array<{ id: string; nombre: string }>>`
      SELECT id::text AS id, nombre_bloque AS nombre
      FROM public.salones
    `;
    salones.forEach((salon) => roomIdByName.set(salon.nombre, salon.id));

    payload.slots.forEach((slot) => {
      if (!dayOrder[slot.day]) {
        throw new Error(`Dia invalido en creacion: '${slot.day}'`);
      }
    });

    const facultadId = await resolveFacultadId(tx, facultyIdByName, payload.faculty);

    const evento = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.eventos (
        tipo_reserva_id,
        facultad_id,
        codigo_materia,
        nombre_principal,
        responsable,
        actividad,
        fecha_inicio,
        fecha_fin
      )
      VALUES (
        ${reservationTypeToId(payload.reservationType)},
        ${facultadId}::uuid,
        ${payload.code},
        ${payload.subject},
        ${payload.teacher},
        ${null},
        ${toIsoDate(payload.startDate)}::date,
        ${toIsoDate(payload.endDate)}::date
      )
      RETURNING id::text AS id
    `;

    const eventId = evento[0]?.id;
    if (!eventId) {
      throw new Error("No se pudo crear el evento");
    }

    for (const slot of payload.slots) {
      const resolvedRoomName = canonicalRoomName(slot.room);
      if (!resolvedRoomName) {
        throw new Error(`El salon '${slot.room}' no pertenece al catalogo oficial`);
      }
      const salonId = await resolveSalonId(tx, roomIdByName, resolvedRoomName);

      await tx.$executeRaw`
        INSERT INTO public.horarios_evento (
          evento_id,
          salon_id,
          dia_semana,
          hora_inicio,
          hora_fin
        )
        VALUES (
          ${eventId}::uuid,
          ${salonId}::uuid,
          ${slot.day}::public.dia_semana_enum,
          ${slot.startTime}::time,
          ${slot.endTime}::time
        )
      `;
    }

    return { eventId };
  });
};

export const updateScheduleEventSlot = async (payload: UpdateScheduleEventSlotInput) => {
  return prisma.$transaction(async (tx) => {
    if (!dayOrder[payload.day]) {
      throw new Error(`Dia invalido en modificacion: '${payload.day}'`);
    }

    const facultyIdByName = new Map<string, string>();
    const roomIdByName = new Map<string, string>();

    const facultades = await tx.$queryRaw<Array<{ id: string; nombre: string }>>`
      SELECT id::text AS id, nombre
      FROM public.facultades
    `;
    facultades.forEach((facultad) => facultyIdByName.set(facultad.nombre, facultad.id));

    const salones = await tx.$queryRaw<Array<{ id: string; nombre: string }>>`
      SELECT id::text AS id, nombre_bloque AS nombre
      FROM public.salones
    `;
    salones.forEach((salon) => roomIdByName.set(salon.nombre, salon.id));

    const facultadId = await resolveFacultadId(tx, facultyIdByName, payload.faculty);
    const resolvedRoomName = canonicalRoomName(payload.room);
    if (!resolvedRoomName) {
      throw new Error(`El salon '${payload.room}' no pertenece al catalogo oficial`);
    }
    const salonId = await resolveSalonId(tx, roomIdByName, resolvedRoomName);

    const updatedEvent = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE public.eventos
      SET
        facultad_id = ${facultadId}::uuid,
        codigo_materia = ${payload.code},
        nombre_principal = ${payload.subject},
        responsable = ${payload.teacher},
        fecha_inicio = ${toIsoDate(payload.startDate)}::date,
        fecha_fin = ${toIsoDate(payload.endDate)}::date
      WHERE id = ${payload.eventId}::uuid
      RETURNING id::text AS id
    `;

    if (!updatedEvent[0]?.id) {
      throw new Error("No se encontro el evento a modificar");
    }

    const updatedSlot = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE public.horarios_evento
      SET
        salon_id = ${salonId}::uuid,
        dia_semana = ${payload.day}::public.dia_semana_enum,
        hora_inicio = ${payload.startTime}::time,
        hora_fin = ${payload.endTime}::time
      WHERE id = ${payload.slotId}::uuid
        AND evento_id = ${payload.eventId}::uuid
      RETURNING id::text AS id
    `;

    if (!updatedSlot[0]?.id) {
      throw new Error("No se encontro el horario a modificar");
    }
  });
};

export const deleteScheduleEventSlot = async (eventId: string, slotId: string) => {
  return prisma.$transaction(async (tx) => {
    const deleted = await tx.$queryRaw<Array<{ id: string }>>`
      DELETE FROM public.horarios_evento
      WHERE id = ${slotId}::uuid
        AND evento_id = ${eventId}::uuid
      RETURNING id::text AS id
    `;

    if (!deleted[0]?.id) {
      throw new Error("No se encontro el horario a eliminar");
    }

    const remaining = await tx.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM public.horarios_evento
      WHERE evento_id = ${eventId}::uuid
    `;

    const remainingCount = Number(remaining[0]?.count ?? 0n);
    if (remainingCount === 0) {
      await tx.$executeRaw`
        DELETE FROM public.eventos
        WHERE id = ${eventId}::uuid
      `;
    }
  });
};

export const getImportsHistory = async () => {
  await ensureImportsHistoryTable();

  return prisma.$queryRaw<
    Array<{
      id: string;
      source_file: string;
      imported_at: string;
      rows_count: number;
      classes_count: number;
      slots_count: number;
      conflicts_detected: number;
      conflicts_accepted: number;
      conflicts_rejected: number;
      imported_by: string | null;
      status: string;
    }>
  >`
    SELECT
      id::text AS id,
      source_file,
      TO_CHAR(imported_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS imported_at,
      rows_count,
      classes_count,
      slots_count,
      conflicts_detected,
      conflicts_accepted,
      conflicts_rejected,
      imported_by,
      status
    FROM public.schedule_import_history
    ORDER BY imported_at DESC
    LIMIT 50
  `;
};

export const clearAllSchedules = async (requestedBy = "schedules-ui") => {
  await ensureImportsHistoryTable();
  const clearedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`TRUNCATE TABLE public.horarios_evento, public.eventos CASCADE`);

    await tx.$executeRaw`
      INSERT INTO public.schedule_import_history (
        source_file,
        imported_at,
        rows_count,
        classes_count,
        slots_count,
        conflicts_detected,
        conflicts_accepted,
        conflicts_rejected,
        imported_by,
        status
      )
      VALUES (
        ${"manual-clear"},
        ${clearedAt.toISOString()}::timestamptz,
        0,
        0,
        0,
        0,
        0,
        0,
        ${requestedBy},
        ${"cleared"}
      )
    `;
  });
};

export const getScheduleEvents = async () => {
  const events = await prisma.$queryRaw<
    Array<{
      evento_id: string;
      horario_id: string;
      day: string;
      room: string;
      start: string;
      end: string;
      faculty: string;
      code: string;
      subject: string;
      teacher: string;
      start_date: string;
      end_date: string;
      tipo_reserva_id: number;
    }>
  >`
    SELECT
      e.id::text AS evento_id,
      h.id::text AS horario_id,
      h.dia_semana::text AS day,
      s.nombre_bloque AS room,
      TO_CHAR(h.hora_inicio, 'HH24:MI') AS start,
      TO_CHAR(h.hora_fin, 'HH24:MI') AS "end",
      COALESCE(f.nombre, 'Reserva') AS faculty,
      COALESCE(e.codigo_materia, 'RESERVA') AS code,
      e.nombre_principal AS subject,
      e.responsable AS teacher,
      TO_CHAR(e.fecha_inicio, 'YYYY-MM-DD') AS start_date,
      TO_CHAR(e.fecha_fin, 'YYYY-MM-DD') AS end_date,
      e.tipo_reserva_id
    FROM public.eventos e
    INNER JOIN public.horarios_evento h ON h.evento_id = e.id
    INNER JOIN public.salones s ON s.id = h.salon_id
    LEFT JOIN public.facultades f ON f.id = e.facultad_id
    ORDER BY e.nombre_principal ASC
  `;

  return events.map((item) => ({
    id: `${item.evento_id}:${item.horario_id}`,
    classId: item.evento_id,
    day: item.day,
    room: canonicalRoomName(item.room) ?? item.room,
    start: item.start,
    end: item.end,
    faculty: item.faculty,
    code: item.code,
    subject: item.subject,
    teacher: item.teacher,
    startDate: item.start_date,
    endDate: item.end_date,
    reservationType: item.tipo_reserva_id === 3 ? "iglesia" : item.tipo_reserva_id === 2 ? "momentanea" : "normal",
    color: item.tipo_reserva_id === 3 ? "red" : item.tipo_reserva_id === 2 ? "amber" : "blue",
  }));
};

export const getRooms = async () => {
  const rooms = await prisma.$queryRaw<Array<{ room: string }>>`
    SELECT nombre_bloque AS room
    FROM public.salones
  `;

  const roomKeysInDb = new Set(rooms.map((item) => roomKey(canonicalRoomName(item.room) ?? item.room)));

  // Return only the official room catalog in the exact order requested by business rules.
  return roomDisplayOrder.filter((room) => roomKeysInDb.has(roomKey(room)));
};
