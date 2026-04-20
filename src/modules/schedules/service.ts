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

type ScheduleRequestStatus = "pendiente" | "aprobada" | "rechazada";

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
  requestStatus?: ScheduleRequestStatus;
  requestedByStaffId?: string;
  requestedByName?: string;
  requestedByRole?: string;
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
  targetDate?: Date;
  updateScope?: "always" | "week";
};

type SearchAvailableRoomsInput = {
  date: string;
  day: string;
  startTime: string;
  endTime: string;
  minCapacity: number;
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

const ensureSlotExceptionsTable = async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.horarios_evento_excepciones (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      horario_id uuid NOT NULL REFERENCES public.horarios_evento(id) ON DELETE CASCADE,
      fecha date NOT NULL,
      dia_semana public.dia_semana_enum NOT NULL,
      salon_id uuid NOT NULL REFERENCES public.salones(id),
      hora_inicio time NOT NULL,
      hora_fin time NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT horarios_evento_excepciones_hora_chk CHECK (hora_fin > hora_inicio),
      CONSTRAINT horarios_evento_excepciones_unique UNIQUE (horario_id, fecha)
    )
  `);
};

let ensureSlotExceptionsTablePromise: Promise<void> | null = null;

const ensureSlotExceptionsTableReady = async () => {
  if (!ensureSlotExceptionsTablePromise) {
    ensureSlotExceptionsTablePromise = ensureSlotExceptionsTable().catch((error) => {
      ensureSlotExceptionsTablePromise = null;
      throw error;
    });
  }

  await ensureSlotExceptionsTablePromise;
};

const ensureScheduleRequestsTable = async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.solicitudes_salon (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      evento_id uuid NOT NULL UNIQUE REFERENCES public.eventos(id) ON DELETE CASCADE,
      estado text NOT NULL DEFAULT 'pendiente',
      solicitado_por_staff_id uuid,
      solicitado_por_nombre text NOT NULL,
      solicitado_por_rol text NOT NULL,
      resuelto_por_staff_id uuid,
      resuelto_por_nombre text,
      resuelto_en timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT solicitudes_salon_estado_chk CHECK (estado IN ('pendiente', 'aprobada', 'rechazada'))
    )
  `);
};

let ensureScheduleRequestsTablePromise: Promise<void> | null = null;

const ensureScheduleRequestsTableReady = async () => {
  if (!ensureScheduleRequestsTablePromise) {
    ensureScheduleRequestsTablePromise = ensureScheduleRequestsTable().catch((error) => {
      ensureScheduleRequestsTablePromise = null;
      throw error;
    });
  }

  await ensureScheduleRequestsTablePromise;
};

let ensureOverlapFunctionPromise: Promise<void> | null = null;

const ensureOverlapValidationFunction = async () => {
  await ensureSlotExceptionsTableReady();

  await prisma.$executeRawUnsafe(`
    create or replace function public.verificar_solape_horario(
      p_evento_id uuid,
      p_salon_id uuid,
      p_dia public.dia_semana_enum,
      p_hora_inicio time,
      p_hora_fin time,
      p_horario_id uuid default null,
      p_target_date date default null
    )
    returns void
    language plpgsql
    as $$
    declare
      v_nuevo_inicio date;
      v_nuevo_fin date;
      v_target_date date;
      v_conflicto record;
      v_nombre_salon text;
      v_nombre_dia text;
      v_hora_conflicto text;
    begin
      select e.fecha_inicio, e.fecha_fin
        into v_nuevo_inicio, v_nuevo_fin
      from public.eventos e
      where e.id = p_evento_id;

      if v_nuevo_inicio is null then
        raise exception 'Evento no encontrado para validar solape: %', p_evento_id;
      end if;

      v_target_date := p_target_date;
      if v_target_date is null and v_nuevo_inicio = v_nuevo_fin then
        v_target_date := v_nuevo_inicio;
      end if;

      select
        h.id,
        h.evento_id,
        e.nombre_principal,
        coalesce(x.hora_inicio, h.hora_inicio) as hora_inicio,
        coalesce(x.hora_fin, h.hora_fin) as hora_fin,
        coalesce(sx.nombre_bloque, sb.nombre_bloque) as nombre_bloque,
        coalesce(x.dia_semana, h.dia_semana) as dia_semana
        into v_conflicto
      from public.horarios_evento h
      join public.eventos e on e.id = h.evento_id
      join public.salones sb on sb.id = h.salon_id
      left join public.solicitudes_salon sr on sr.evento_id = e.id
      left join public.horarios_evento_excepciones x
        on x.horario_id = h.id
       and x.fecha = v_target_date
      left join public.salones sx on sx.id = x.salon_id
      where coalesce(x.salon_id, h.salon_id) = p_salon_id
        and coalesce(x.dia_semana, h.dia_semana) = p_dia
        and (p_hora_inicio < coalesce(x.hora_fin, h.hora_fin) and coalesce(x.hora_inicio, h.hora_inicio) < p_hora_fin)
        and coalesce(sr.estado, 'aprobada') <> 'rechazada'
        and (v_target_date is null or
            (v_target_date >= v_nuevo_inicio and v_target_date <= v_nuevo_fin and
             v_target_date >= e.fecha_inicio and v_target_date <= e.fecha_fin))
        and (v_target_date is not null or
             daterange(v_nuevo_inicio, v_nuevo_fin, '[]') && daterange(e.fecha_inicio, e.fecha_fin, '[]'))
        and (p_horario_id is null or h.id <> p_horario_id)
        and h.evento_id <> p_evento_id
      limit 1;

      if v_conflicto is not null then
        v_nombre_salon := coalesce(v_conflicto.nombre_bloque, 'Salón desconocido');
        v_nombre_dia := case p_dia
          when 'Lunes'::public.dia_semana_enum then 'Lunes'
          when 'Martes'::public.dia_semana_enum then 'Martes'
          when 'Miercoles'::public.dia_semana_enum then 'Miércoles'
          when 'Jueves'::public.dia_semana_enum then 'Jueves'
          when 'Viernes'::public.dia_semana_enum then 'Viernes'
          when 'Sabado'::public.dia_semana_enum then 'Sábado'
          when 'Domingo'::public.dia_semana_enum then 'Domingo'
          else 'Día desconocido'
        end;
        v_hora_conflicto := (v_conflicto.hora_inicio)::text || '-' || (v_conflicto.hora_fin)::text;

        raise exception
          'CONFLICTO_SOLAPE|%|%|%|%|%',
          v_nombre_salon,
          v_nombre_dia,
          v_hora_conflicto,
          p_hora_inicio::text || '-' || p_hora_fin::text,
          v_conflicto.nombre_principal;
      end if;
    end;
    $$;

    alter function public.verificar_solape_horario(
      uuid,
      uuid,
      public.dia_semana_enum,
      time,
      time,
      uuid,
      date
    ) set search_path = public, pg_temp;
  `);

  await prisma.$executeRawUnsafe(`
    create or replace function public.trg_horarios_evento_no_solape()
    returns trigger
    language plpgsql
    as $$
    declare
      v_evento_inicio date;
      v_evento_fin date;
      v_target_date date;
    begin
      select e.fecha_inicio, e.fecha_fin
        into v_evento_inicio, v_evento_fin
      from public.eventos e
      where e.id = new.evento_id;

      v_target_date := null;
      if v_evento_inicio is not null and v_evento_fin is not null and v_evento_inicio = v_evento_fin then
        v_target_date := v_evento_inicio;
      end if;

      perform public.verificar_solape_horario(
        new.evento_id,
        new.salon_id,
        new.dia_semana,
        new.hora_inicio,
        new.hora_fin,
        new.id,
        v_target_date
      );

      return new;
    end;
    $$;

    alter function public.trg_horarios_evento_no_solape()
      set search_path = public, pg_temp;

    drop trigger if exists trg_horarios_evento_no_solape on public.horarios_evento;

    create trigger trg_horarios_evento_no_solape
      before insert or update on public.horarios_evento
      for each row
      execute function public.trg_horarios_evento_no_solape();
  `);
};

const ensureOverlapValidationReady = async () => {
  if (!ensureOverlapFunctionPromise) {
    ensureOverlapFunctionPromise = ensureOverlapValidationFunction().catch((error) => {
      ensureOverlapFunctionPromise = null;
      throw error;
    });
  }

  await ensureOverlapFunctionPromise;
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

const normalizeDayKey = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();

const canonicalDayName = (value: string) => {
  switch (normalizeDayKey(value)) {
    case "lunes":
      return "Lunes";
    case "martes":
      return "Martes";
    case "miercoles":
      return "Miercoles";
    case "jueves":
      return "Jueves";
    case "viernes":
      return "Viernes";
    case "sabado":
      return "Sabado";
    case "domingo":
      return "Domingo";
    default:
      return null;
  }
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

const toIsoDate = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getColombiaTodayIsoDate = () => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
};

const maxIsoDate = (left: string, right: string) => (left >= right ? left : right);

const previousIsoDate = (isoDate: string) => {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  date.setDate(date.getDate() - 1);
  return toIsoDate(date);
};

const weekdayFromIsoDate = (isoDate: string) => {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  const names = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"] as const;
  return names[date.getDay()] ?? "Lunes";
};

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

  console.groupCollapsed("[Schedules Import] replaceAllSchedulesFromRows");
  console.log("sourceFile:", sourceFile);
  console.log("rows:", rows.length);
  console.log("grouped classes:", classes.length);
  console.log("meta:", meta ?? null);
  console.groupEnd();

  await ensureImportsHistoryTable();
  await ensureOverlapValidationReady();

  return prisma.$transaction(async (tx) => {
    await ensureOfficialRoomCatalog(tx);

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

    const existingNormalEventsCount = await tx.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM public.eventos
      WHERE tipo_reserva_id = ${RESERVA_SEMESTRE_ID}
    `;

    const replacedEvents = existingNormalEventsCount[0]?.count ?? 0;

    // Excel import only synchronizes academic classes (normal reservation type).
    // Keep momentary/church reservations untouched.
    await tx.$executeRaw`
      DELETE FROM public.horarios_evento h
      USING public.eventos e
      WHERE h.evento_id = e.id
        AND e.tipo_reserva_id = ${RESERVA_SEMESTRE_ID}
    `;

    await tx.$executeRaw`
      DELETE FROM public.eventos
      WHERE tipo_reserva_id = ${RESERVA_SEMESTRE_ID}
    `;

    for (const cls of classes) {
      cls.slots.forEach((slot) => {
        const canonicalDay = canonicalDayName(slot.day);
        if (!canonicalDay) {
          console.error("[Schedules Import] Invalid day", {
            sourceFile,
            classKey: `${cls.faculty} | ${cls.code} | ${cls.subject}`,
            slot,
          });
          throw new Error(`Dia invalido en importacion: '${slot.day}'`);
        }

        slot.day = canonicalDay;
      });

      const validSlots = cls.slots
        .map((slot) => ({ slot, canonicalRoom: canonicalRoomName(slot.room) }))
        .filter((entry) => entry.canonicalRoom !== null);

      const discardedSlots = cls.slots.length - validSlots.length;
      if (discardedSlots > 0) {
        console.warn("[Schedules Import] Discarded non-official rooms", {
          sourceFile,
          classKey: `${cls.faculty} | ${cls.code} | ${cls.subject}`,
          discardedSlots,
          originalRooms: cls.slots.map((slot) => slot.room),
        });
      }

      skippedSlots += cls.slots.length - validSlots.length;

      if (validSlots.length === 0) {
        skippedClasses += 1;
        continue;
      }

      const classStartIso = toIsoDate(cls.startDate);
      const classEndIso = toIsoDate(cls.endDate);

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
      replacedEvents,
      skippedClasses,
      skippedSlots,
    };
  }, { maxWait: 30000, timeout: 600000 });
};

export const createScheduleEvent = async (payload: CreateScheduleEventInput) => {
  await ensureOverlapValidationReady();
  await ensureScheduleRequestsTableReady();

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

    const normalizedStartDateIso = toIsoDate(payload.startDate);
    const normalizedEndDateIso = toIsoDate(payload.endDate);
    const forcedMomentaneaDay =
      payload.reservationType === "momentanea" && normalizedStartDateIso === normalizedEndDateIso
        ? weekdayFromIsoDate(normalizedStartDateIso)
        : null;

    payload.slots.forEach((slot) => {
      const canonicalDay = forcedMomentaneaDay ?? canonicalDayName(slot.day);
      if (!canonicalDay) {
        throw new Error(`Dia invalido en creacion: '${slot.day}'`);
      }

      slot.day = canonicalDay;
    });

    const seenSlots = new Set<string>();
    for (const slot of payload.slots) {
      const slotKey = [slot.day, canonicalRoomName(slot.room) ?? slot.room, slot.startTime, slot.endTime].join("|");
      if (seenSlots.has(slotKey)) {
        throw new Error(
          `HORARIO_DUPLICADO_EN_FORMULARIO|${slot.room}|${slot.day}|${slot.startTime}-${slot.endTime}|${payload.subject}`
        );
      }
      seenSlots.add(slotKey);
    }

    if (normalizedStartDateIso > normalizedEndDateIso) {
      throw new Error(
        `FECHAS_INVALIDAS|${normalizedStartDateIso}|${normalizedEndDateIso}|${payload.subject}`
      );
    }

    const reservationTypeId = reservationTypeToId(payload.reservationType);
    const isIglesiaReservation = reservationTypeId === RESERVA_IGLESIA_ID;

    const facultadId = isIglesiaReservation
      ? null
      : await resolveFacultadId(tx, facultyIdByName, payload.faculty);
    const materialCode = isIglesiaReservation ? null : payload.code;
    const activity = isIglesiaReservation ? payload.subject : null;

    const targetDateIso = normalizedStartDateIso === normalizedEndDateIso ? normalizedStartDateIso : null;

    for (const slot of payload.slots) {
      const resolvedRoomName = canonicalRoomName(slot.room);
      if (!resolvedRoomName) {
        throw new Error(`El salon '${slot.room}' no pertenece al catalogo oficial`);
      }

      const resolvedSalonId = await resolveSalonId(tx, roomIdByName, resolvedRoomName);

      const conflict = await tx.$queryRaw<
        Array<{
          subject: string;
          room: string;
          start_time: string;
          end_time: string;
          existing_start_date: string;
          existing_end_date: string;
        }>
      >`
        SELECT
          e.nombre_principal AS subject,
          COALESCE(sx.nombre_bloque, sb.nombre_bloque) AS room,
          TO_CHAR(COALESCE(x.hora_inicio, h.hora_inicio), 'HH24:MI:SS') AS start_time,
          TO_CHAR(COALESCE(x.hora_fin, h.hora_fin), 'HH24:MI:SS') AS end_time,
          TO_CHAR(e.fecha_inicio, 'YYYY-MM-DD') AS existing_start_date,
          TO_CHAR(e.fecha_fin, 'YYYY-MM-DD') AS existing_end_date
        FROM public.horarios_evento h
        INNER JOIN public.eventos e ON e.id = h.evento_id
        INNER JOIN public.salones sb ON sb.id = h.salon_id
        LEFT JOIN public.solicitudes_salon sr ON sr.evento_id = e.id
        LEFT JOIN public.horarios_evento_excepciones x
          ON x.horario_id = h.id
          AND x.fecha = ${targetDateIso}::date
        LEFT JOIN public.salones sx ON sx.id = x.salon_id
        WHERE COALESCE(x.salon_id, h.salon_id) = ${resolvedSalonId}::uuid
          AND COALESCE(x.dia_semana, h.dia_semana) = ${slot.day}::public.dia_semana_enum
          AND (${slot.startTime}::time < COALESCE(x.hora_fin, h.hora_fin)
            AND COALESCE(x.hora_inicio, h.hora_inicio) < ${slot.endTime}::time)
          AND COALESCE(sr.estado, 'aprobada') <> 'rechazada'
          AND (
            ${targetDateIso}::date IS NULL OR
            (
              ${targetDateIso}::date >= ${normalizedStartDateIso}::date
              AND ${targetDateIso}::date <= ${normalizedEndDateIso}::date
              AND ${targetDateIso}::date >= e.fecha_inicio
              AND ${targetDateIso}::date <= e.fecha_fin
            )
          )
          AND (
            ${targetDateIso}::date IS NOT NULL OR
            (${normalizedStartDateIso}::date <= e.fecha_fin AND ${normalizedEndDateIso}::date >= e.fecha_inicio)
          )
        LIMIT 1
      `;

      if (conflict[0]) {
        throw new Error(
          `CONFLICTO_SOLAPE|${conflict[0].room}|${slot.day}|${conflict[0].start_time}-${conflict[0].end_time}|${slot.startTime}-${slot.endTime}|${conflict[0].subject}|${conflict[0].existing_start_date} a ${conflict[0].existing_end_date}`
        );
      }
    }

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
        ${reservationTypeId},
        ${facultadId}::uuid,
        ${materialCode},
        ${payload.subject},
        ${payload.teacher},
        ${activity},
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

    await tx.$executeRaw`
      INSERT INTO public.solicitudes_salon (
        evento_id,
        estado,
        solicitado_por_staff_id,
        solicitado_por_nombre,
        solicitado_por_rol,
        resuelto_por_staff_id,
        resuelto_por_nombre,
        resuelto_en,
        updated_at
      )
      VALUES (
        ${eventId}::uuid,
        ${payload.requestStatus ?? "aprobada"},
        ${payload.requestedByStaffId ?? null},
        ${payload.requestedByName ?? "Sistema"},
        ${payload.requestedByRole ?? "admin"},
        ${payload.requestStatus === "aprobada" ? (payload.requestedByStaffId ?? null) : null},
        ${payload.requestStatus === "aprobada" ? (payload.requestedByName ?? "Sistema") : null},
        ${payload.requestStatus === "aprobada" ? new Date().toISOString() : null}::timestamptz,
        now()
      )
      ON CONFLICT (evento_id) DO UPDATE SET
        estado = EXCLUDED.estado,
        solicitado_por_staff_id = EXCLUDED.solicitado_por_staff_id,
        solicitado_por_nombre = EXCLUDED.solicitado_por_nombre,
        solicitado_por_rol = EXCLUDED.solicitado_por_rol,
        resuelto_por_staff_id = EXCLUDED.resuelto_por_staff_id,
        resuelto_por_nombre = EXCLUDED.resuelto_por_nombre,
        resuelto_en = EXCLUDED.resuelto_en,
        updated_at = now()
    `;
    }

    return { eventId };
  });
};

export const updateScheduleEventSlot = async (payload: UpdateScheduleEventSlotInput) => {
  await ensureOverlapValidationReady();

  return prisma.$transaction(async (tx) => {
    const canonicalDay = canonicalDayName(payload.day);
    if (!canonicalDay) {
      throw new Error(`Dia invalido en modificacion: '${payload.day}'`);
    }

    // Prefer explicit scope from client. If absent, fallback to week when targetDate exists.
    const updateScope = payload.updateScope ?? (payload.targetDate ? "week" : "always");

    const roomIdByName = new Map<string, string>();

    const salones = await tx.$queryRaw<Array<{ id: string; nombre: string }>>`
      SELECT id::text AS id, nombre_bloque AS nombre
      FROM public.salones
    `;
    salones.forEach((salon) => roomIdByName.set(salon.nombre, salon.id));

    const currentEvent = await tx.$queryRaw<Array<{ tipo_reserva_id: number; fecha_inicio: string; fecha_fin: string }>>`
      SELECT tipo_reserva_id, TO_CHAR(fecha_inicio, 'YYYY-MM-DD') AS fecha_inicio, TO_CHAR(fecha_fin, 'YYYY-MM-DD') AS fecha_fin
      FROM public.eventos
      WHERE id = ${payload.eventId}::uuid
      LIMIT 1
    `;

    const currentEventRow = currentEvent[0];
    const currentReservationTypeId = currentEventRow?.tipo_reserva_id;
    if (!currentReservationTypeId) {
      throw new Error("No se encontro el evento a modificar");
    }

    const currentSlotRows = await tx.$queryRaw<Array<{
      id: string;
      salon_id: string;
      dia_semana: string;
      hora_inicio: string;
      hora_fin: string;
    }>>`
      SELECT
        h.id::text AS id,
        h.salon_id::text AS salon_id,
        h.dia_semana::text AS dia_semana,
        TO_CHAR(h.hora_inicio, 'HH24:MI') AS hora_inicio,
        TO_CHAR(h.hora_fin, 'HH24:MI') AS hora_fin
      FROM public.horarios_evento h
      WHERE h.id = ${payload.slotId}::uuid
        AND h.evento_id = ${payload.eventId}::uuid
      LIMIT 1
    `;

    const currentSlot = currentSlotRows[0];
    if (!currentSlot?.id) {
      throw new Error("No se encontro el horario a modificar");
    }

    const resolvedRoomName = canonicalRoomName(payload.room);
    if (!resolvedRoomName) {
      throw new Error(`El salon '${payload.room}' no pertenece al catalogo oficial`);
    }
    const salonId = await resolveSalonId(tx, roomIdByName, resolvedRoomName);

    if (updateScope === "week") {
      if (process.env.NODE_ENV !== "production") {
        console.log("[Schedules][week-update] incoming payload", {
          eventId: payload.eventId,
          slotId: payload.slotId,
          targetDate: payload.targetDate ? toIsoDate(payload.targetDate) : null,
          day: payload.day,
          room: payload.room,
          startTime: payload.startTime,
          endTime: payload.endTime,
        });
      }

      await ensureSlotExceptionsTableReady();

      if (!payload.targetDate) {
        throw new Error("Debes enviar targetDate para modificar solo esta semana");
      }

      const targetDateIso = toIsoDate(payload.targetDate);
      const eventStart = currentEventRow.fecha_inicio;
      const eventEnd = currentEventRow.fecha_fin;

      if (targetDateIso < eventStart || targetDateIso > eventEnd) {
        throw new Error("La fecha seleccionada no pertenece al rango activo de la clase");
      }

      const conflict = await tx.$queryRaw<
        Array<{
          subject: string;
          room: string;
          start_time: string;
          end_time: string;
        }>
      >`
        SELECT
          e.nombre_principal AS subject,
          COALESCE(sx.nombre_bloque, sb.nombre_bloque) AS room,
          TO_CHAR(COALESCE(x.hora_inicio, h.hora_inicio), 'HH24:MI:SS') AS start_time,
          TO_CHAR(COALESCE(x.hora_fin, h.hora_fin), 'HH24:MI:SS') AS end_time
        FROM public.horarios_evento h
        INNER JOIN public.eventos e ON e.id = h.evento_id
        INNER JOIN public.salones sb ON sb.id = h.salon_id
        LEFT JOIN public.solicitudes_salon sr ON sr.evento_id = e.id
        LEFT JOIN public.horarios_evento_excepciones x
          ON x.horario_id = h.id
         AND x.fecha = ${targetDateIso}::date
        LEFT JOIN public.salones sx ON sx.id = x.salon_id
        WHERE ${targetDateIso}::date BETWEEN e.fecha_inicio AND e.fecha_fin
          AND COALESCE(x.dia_semana, h.dia_semana) = ${canonicalDay}::public.dia_semana_enum
          AND COALESCE(x.salon_id, h.salon_id) = ${salonId}::uuid
          AND (${payload.startTime}::time < COALESCE(x.hora_fin, h.hora_fin)
            AND COALESCE(x.hora_inicio, h.hora_inicio) < ${payload.endTime}::time)
          AND COALESCE(sr.estado, 'aprobada') <> 'rechazada'
          AND NOT (h.id = ${payload.slotId}::uuid AND h.evento_id = ${payload.eventId}::uuid)
        LIMIT 1
      `;

      if (conflict[0]) {
        const dayLabel =
          canonicalDay === "Miercoles"
            ? "Miércoles"
            : canonicalDay === "Sabado"
              ? "Sábado"
              : canonicalDay;

        throw new Error(
          `CONFLICTO_SOLAPE|${conflict[0].room}|${dayLabel}|${conflict[0].start_time}-${conflict[0].end_time}|${payload.startTime}:00-${payload.endTime}:00|${conflict[0].subject}`
        );
      }

      await tx.$executeRaw`
        INSERT INTO public.horarios_evento_excepciones (
          horario_id,
          fecha,
          dia_semana,
          salon_id,
          hora_inicio,
          hora_fin,
          updated_at
        )
        VALUES (
          ${payload.slotId}::uuid,
          ${targetDateIso}::date,
          ${canonicalDay}::public.dia_semana_enum,
          ${salonId}::uuid,
          ${payload.startTime}::time,
          ${payload.endTime}::time,
          NOW()
        )
        ON CONFLICT (horario_id, fecha)
        DO UPDATE SET
          dia_semana = EXCLUDED.dia_semana,
          salon_id = EXCLUDED.salon_id,
          hora_inicio = EXCLUDED.hora_inicio,
          hora_fin = EXCLUDED.hora_fin,
          updated_at = NOW()
      `;

      if (process.env.NODE_ENV !== "production") {
        const persistedOverride = await tx.$queryRaw<
          Array<{
            date: string;
            day: string;
            room: string;
            start: string;
            end: string;
          }>
        >`
          SELECT
            TO_CHAR(x.fecha, 'YYYY-MM-DD') AS date,
            x.dia_semana::text AS day,
            s.nombre_bloque AS room,
            TO_CHAR(x.hora_inicio, 'HH24:MI') AS start,
            TO_CHAR(x.hora_fin, 'HH24:MI') AS "end"
          FROM public.horarios_evento_excepciones x
          INNER JOIN public.salones s ON s.id = x.salon_id
          WHERE x.horario_id = ${payload.slotId}::uuid
            AND x.fecha = ${targetDateIso}::date
          LIMIT 1
        `;

        console.log("[Schedules][week-update] persisted override", {
          eventId: payload.eventId,
          slotId: payload.slotId,
          targetDate: targetDateIso,
          found: Boolean(persistedOverride[0]),
          override: persistedOverride[0] ?? null,
        });
      }

      return;
    }

    const facultyIdByName = new Map<string, string>();
    const facultades = await tx.$queryRaw<Array<{ id: string; nombre: string }>>`
      SELECT id::text AS id, nombre
      FROM public.facultades
    `;
    facultades.forEach((facultad) => facultyIdByName.set(facultad.nombre, facultad.id));

    const isIglesiaReservation = currentReservationTypeId === RESERVA_IGLESIA_ID;
    const facultadId = isIglesiaReservation
      ? null
      : await resolveFacultadId(tx, facultyIdByName, payload.faculty);
    const materialCode = isIglesiaReservation ? null : payload.code;
    const activity = isIglesiaReservation ? payload.subject : null;

    const eventStartIso = currentEventRow.fecha_inicio;
    const eventEndIso = currentEventRow.fecha_fin;
    const targetDateIso = payload.targetDate ? toIsoDate(payload.targetDate) : getColombiaTodayIsoDate();
    const effectiveStartIso = maxIsoDate(eventStartIso, targetDateIso);

    if (effectiveStartIso <= eventEndIso) {
      const conflict = await tx.$queryRaw<
        Array<{
          subject: string;
          room: string;
          start_time: string;
          end_time: string;
          day_label: string;
        }>
      >`
        SELECT
          e.nombre_principal AS subject,
          COALESCE(sx.nombre_bloque, sb.nombre_bloque) AS room,
          TO_CHAR(COALESCE(x.hora_inicio, h.hora_inicio), 'HH24:MI:SS') AS start_time,
          TO_CHAR(COALESCE(x.hora_fin, h.hora_fin), 'HH24:MI:SS') AS end_time,
          COALESCE(x.dia_semana, h.dia_semana)::text AS day_label
        FROM public.horarios_evento h
        INNER JOIN public.eventos e ON e.id = h.evento_id
        INNER JOIN public.salones sb ON sb.id = h.salon_id
        LEFT JOIN public.solicitudes_salon sr ON sr.evento_id = e.id
        LEFT JOIN public.horarios_evento_excepciones x
          ON x.horario_id = h.id
         AND x.fecha = ${effectiveStartIso}::date
        LEFT JOIN public.salones sx ON sx.id = x.salon_id
        WHERE COALESCE(x.salon_id, h.salon_id) = ${salonId}::uuid
          AND COALESCE(x.dia_semana, h.dia_semana) = ${canonicalDay}::public.dia_semana_enum
          AND (${payload.startTime}::time < COALESCE(x.hora_fin, h.hora_fin)
            AND COALESCE(x.hora_inicio, h.hora_inicio) < ${payload.endTime}::time)
          AND COALESCE(sr.estado, 'aprobada') <> 'rechazada'
          AND (${effectiveStartIso}::date <= e.fecha_fin AND ${eventEndIso}::date >= e.fecha_inicio)
          AND NOT (h.id = ${payload.slotId}::uuid AND h.evento_id = ${payload.eventId}::uuid)
        LIMIT 1
      `;

      if (conflict[0]) {
        const dayLabelRaw = conflict[0].day_label;
        const dayLabel = dayLabelRaw === "Miercoles" ? "Miércoles" : dayLabelRaw === "Sabado" ? "Sábado" : dayLabelRaw;
        throw new Error(
          `CONFLICTO_SOLAPE|${conflict[0].room}|${dayLabel}|${conflict[0].start_time}-${conflict[0].end_time}|${payload.startTime}:00-${payload.endTime}:00|${conflict[0].subject}`
        );
      }
    }

    await ensureSlotExceptionsTableReady();

    const preservePastUntilIso = previousIsoDate(effectiveStartIso);
    if (eventStartIso <= preservePastUntilIso) {
      await tx.$executeRawUnsafe(
        `
          INSERT INTO public.horarios_evento_excepciones (
            horario_id,
            fecha,
            dia_semana,
            salon_id,
            hora_inicio,
            hora_fin,
            created_at,
            updated_at
          )
          SELECT
            $1::uuid,
            gs::date,
            $2::public.dia_semana_enum,
            $3::uuid,
            $4::time,
            $5::time,
            now(),
            now()
          FROM generate_series($6::date, $7::date, interval '1 day') AS gs
          WHERE EXTRACT(ISODOW FROM gs::date) =
            CASE $2
              WHEN 'Lunes' THEN 1
              WHEN 'Martes' THEN 2
              WHEN 'Miercoles' THEN 3
              WHEN 'Jueves' THEN 4
              WHEN 'Viernes' THEN 5
              WHEN 'Sabado' THEN 6
              WHEN 'Domingo' THEN 7
              ELSE 0
            END
          ON CONFLICT (horario_id, fecha)
          DO NOTHING
        `,
        payload.slotId,
        currentSlot.dia_semana,
        currentSlot.salon_id,
        currentSlot.hora_inicio,
        currentSlot.hora_fin,
        eventStartIso,
        preservePastUntilIso,
      );
    }

    const updatedEvent = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE public.eventos
      SET
        facultad_id = ${facultadId}::uuid,
        codigo_materia = ${materialCode},
        nombre_principal = ${payload.subject},
        responsable = ${payload.teacher},
        actividad = ${activity},
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
        dia_semana = ${canonicalDay}::public.dia_semana_enum,
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
  // En entornos con permisos restringidos, la creación/consulta de tablas auxiliares
  // puede fallar. Este endpoint debe seguir devolviendo eventos base.
  try {
    await ensureSlotExceptionsTableReady();
  } catch (error) {
    console.warn("[schedules] No fue posible asegurar horarios_evento_excepciones:", error);
  }

  try {
    await ensureScheduleRequestsTableReady();
  } catch (error) {
    console.warn("[schedules] No fue posible asegurar solicitudes_salon:", error);
  }

  let events: Array<{
    evento_id: string;
    horario_id: string;
    request_id: string | null;
    requested_by_staff_id: string | null;
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
    request_status: ScheduleRequestStatus | null;
  }> = [];

  try {
    events = await prisma.$queryRaw<
      Array<{
        evento_id: string;
        horario_id: string;
        request_id: string | null;
        requested_by_staff_id: string | null;
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
        request_status: ScheduleRequestStatus | null;
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
        e.tipo_reserva_id,
        sr.id::text AS request_id,
        sr.solicitado_por_staff_id::text AS requested_by_staff_id,
        sr.estado AS request_status
      FROM public.eventos e
      INNER JOIN public.horarios_evento h ON h.evento_id = e.id
      INNER JOIN public.salones s ON s.id = h.salon_id
      LEFT JOIN public.facultades f ON f.id = e.facultad_id
      LEFT JOIN public.solicitudes_salon sr ON sr.evento_id = e.id
      WHERE COALESCE(sr.estado, 'aprobada') <> 'rechazada'
      ORDER BY e.nombre_principal ASC
    `;
  } catch (error) {
    console.warn("[schedules] Fallback sin solicitudes_salon:", error);
    events = await prisma.$queryRaw<
      Array<{
        evento_id: string;
        horario_id: string;
        request_id: string | null;
        requested_by_staff_id: string | null;
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
        request_status: ScheduleRequestStatus | null;
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
        e.tipo_reserva_id,
        NULL::text AS request_id,
        NULL::text AS requested_by_staff_id,
        NULL::text AS request_status
      FROM public.eventos e
      INNER JOIN public.horarios_evento h ON h.evento_id = e.id
      INNER JOIN public.salones s ON s.id = h.salon_id
      LEFT JOIN public.facultades f ON f.id = e.facultad_id
      ORDER BY e.nombre_principal ASC
    `;
  }

  let overrides: Array<{
    horario_id: string;
    date: string;
    day: string;
    room: string;
    start: string;
    end: string;
  }> = [];

  try {
    overrides = await prisma.$queryRaw<
      Array<{
        horario_id: string;
        date: string;
        day: string;
        room: string;
        start: string;
        end: string;
      }>
    >`
      SELECT
        x.horario_id::text AS horario_id,
        TO_CHAR(x.fecha, 'YYYY-MM-DD') AS date,
        x.dia_semana::text AS day,
        s.nombre_bloque AS room,
        TO_CHAR(x.hora_inicio, 'HH24:MI') AS start,
        TO_CHAR(x.hora_fin, 'HH24:MI') AS "end"
      FROM public.horarios_evento_excepciones x
      INNER JOIN public.salones s ON s.id = x.salon_id
    `;
  } catch (error) {
    console.warn("[schedules] Fallback sin horarios_evento_excepciones:", error);
  }

  const overridesBySlot = new Map<string, Array<{ date: string; day: string; room: string; start: string; end: string }>>();

  overrides.forEach((item) => {
    const bucket = overridesBySlot.get(item.horario_id) ?? [];
    bucket.push({
      date: item.date,
      day: item.day,
      room: canonicalRoomName(item.room) ?? item.room,
      start: item.start,
      end: item.end,
    });
    overridesBySlot.set(item.horario_id, bucket);
  });

  return events.map((item) => ({
    id: `${item.evento_id}:${item.horario_id}`,
    classId: item.evento_id,
    requestId: item.request_id ?? undefined,
    requestedByStaffId: item.requested_by_staff_id ?? undefined,
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
    overrides: overridesBySlot.get(item.horario_id) ?? [],
    reservationType: item.tipo_reserva_id === 3 ? "iglesia" : item.tipo_reserva_id === 2 ? "momentanea" : "normal",
    color: item.tipo_reserva_id === 3 ? "red" : item.tipo_reserva_id === 2 ? "amber" : "blue",
    requestStatus: item.request_status ?? "aprobada",
  }));
};

export const getPendingScheduleRequests = async () => {
  await ensureScheduleRequestsTableReady();

  const requests = await prisma.$queryRaw<
    Array<{
      request_id: string;
      event_id: string;
      status: ScheduleRequestStatus;
      requested_by_staff_id: string | null;
      requested_by_name: string;
      requested_by_role: string;
      faculty: string;
      code: string;
      subject: string;
      teacher: string;
      room: string;
      day: string;
      start: string;
      end: string;
      start_date: string;
      end_date: string;
      created_at: string;
    }>
  >`
    SELECT DISTINCT ON (sr.id)
      sr.id::text AS request_id,
      e.id::text AS event_id,
      sr.estado AS status,
      sr.solicitado_por_staff_id::text AS requested_by_staff_id,
      sr.solicitado_por_nombre AS requested_by_name,
      sr.solicitado_por_rol AS requested_by_role,
      COALESCE(f.nombre, 'Reserva') AS faculty,
      COALESCE(e.codigo_materia, 'SOLICITUD') AS code,
      e.nombre_principal AS subject,
      e.responsable AS teacher,
      s.nombre_bloque AS room,
      h.dia_semana::text AS day,
      TO_CHAR(h.hora_inicio, 'HH24:MI') AS start,
      TO_CHAR(h.hora_fin, 'HH24:MI') AS "end",
      TO_CHAR(e.fecha_inicio, 'YYYY-MM-DD') AS start_date,
      TO_CHAR(e.fecha_fin, 'YYYY-MM-DD') AS end_date,
      TO_CHAR(sr.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
    FROM public.solicitudes_salon sr
    INNER JOIN public.eventos e ON e.id = sr.evento_id
    INNER JOIN public.horarios_evento h ON h.evento_id = e.id
    INNER JOIN public.salones s ON s.id = h.salon_id
    LEFT JOIN public.facultades f ON f.id = e.facultad_id
    WHERE sr.estado = 'pendiente'
    ORDER BY sr.id, h.dia_semana, h.hora_inicio
  `;

  return requests.map((request) => ({
    id: request.request_id,
    eventId: request.event_id,
    status: request.status,
    requestedByStaffId: request.requested_by_staff_id ?? undefined,
    requestedByName: request.requested_by_name,
    requestedByRole: request.requested_by_role,
    faculty: request.faculty,
    code: request.code,
    subject: request.subject,
    teacher: request.teacher,
    room: canonicalRoomName(request.room) ?? request.room,
    day: request.day,
    start: request.start,
    end: request.end,
    startDate: request.start_date,
    endDate: request.end_date,
    createdAt: request.created_at,
  }));
};

export const updateScheduleRequestStatus = async (
  requestId: string,
  status: Exclude<ScheduleRequestStatus, "pendiente">,
  reviewer: { staffId: string; name: string; role: string }
) => {
  await ensureScheduleRequestsTableReady();

  const updated = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE public.solicitudes_salon
    SET
      estado = ${status},
      resuelto_por_staff_id = ${reviewer.staffId}::uuid,
      resuelto_por_nombre = ${reviewer.name},
      resuelto_en = now(),
      updated_at = now()
    WHERE id = ${requestId}::uuid
      AND estado = 'pendiente'
    RETURNING id::text AS id
  `;

  if (!updated[0]?.id) {
    throw new Error("No se encontro la solicitud pendiente");
  }

  return { requestId: updated[0].id };
};

export const updatePendingScheduleRequest = async (
  requestId: string,
  payload: CreateScheduleEventInput,
  actor: { staffId: string; role: "admin" | "monitor"; name: string },
) => {
  await ensureScheduleRequestsTableReady();

  const requestRows = await prisma.$queryRaw<Array<{
    request_id: string;
    event_id: string;
    requested_by_staff_id: string | null;
    status: ScheduleRequestStatus;
    slot_id: string;
    slots_count: number;
  }>>`
    SELECT
      sr.id::text AS request_id,
      e.id::text AS event_id,
      sr.solicitado_por_staff_id::text AS requested_by_staff_id,
      sr.estado AS status,
      h.id::text AS slot_id,
      COUNT(*) OVER (PARTITION BY e.id)::int AS slots_count
    FROM public.solicitudes_salon sr
    INNER JOIN public.eventos e ON e.id = sr.evento_id
    INNER JOIN public.horarios_evento h ON h.evento_id = e.id
    WHERE sr.id = ${requestId}::uuid
    LIMIT 1
  `;

  const requestRow = requestRows[0];
  if (!requestRow?.request_id) {
    throw new Error("No se encontro la solicitud pendiente");
  }

  if (requestRow.status !== "pendiente") {
    throw new Error("Solo puedes editar solicitudes pendientes");
  }

  if (actor.role === "monitor" && requestRow.requested_by_staff_id !== actor.staffId) {
    throw new Error("Solo puedes editar tus propias solicitudes pendientes");
  }

  if (requestRow.slots_count !== 1) {
    throw new Error("La solicitud debe tener un unico horario para poder editarse");
  }

  await updateScheduleEventSlot({
    eventId: requestRow.event_id,
    slotId: requestRow.slot_id,
    faculty: payload.faculty,
    code: payload.code,
    subject: payload.subject,
    teacher: payload.teacher,
    startDate: payload.startDate,
    endDate: payload.endDate,
    day: payload.slots[0]?.day ?? "",
    room: payload.slots[0]?.room ?? "",
    startTime: payload.slots[0]?.startTime ?? "",
    endTime: payload.slots[0]?.endTime ?? "",
  });

  await prisma.$executeRaw`
    UPDATE public.solicitudes_salon
    SET updated_at = now()
    WHERE id = ${requestId}::uuid
      AND estado = 'pendiente'
  `;

  return { requestId, eventId: requestRow.event_id };
};

export const deletePendingScheduleRequest = async (
  requestId: string,
  actor: { staffId: string; role: "admin" | "monitor"; name: string },
) => {
  await ensureScheduleRequestsTableReady();

  const requestRows = await prisma.$queryRaw<Array<{
    request_id: string;
    event_id: string;
    requested_by_staff_id: string | null;
    status: ScheduleRequestStatus;
  }>>`
    SELECT
      sr.id::text AS request_id,
      e.id::text AS event_id,
      sr.solicitado_por_staff_id::text AS requested_by_staff_id,
      sr.estado AS status
    FROM public.solicitudes_salon sr
    INNER JOIN public.eventos e ON e.id = sr.evento_id
    WHERE sr.id = ${requestId}::uuid
    LIMIT 1
  `;

  const requestRow = requestRows[0];
  if (!requestRow?.request_id) {
    throw new Error("No se encontro la solicitud pendiente");
  }

  if (requestRow.status !== "pendiente") {
    throw new Error("Solo puedes eliminar solicitudes pendientes");
  }

  if (actor.role === "monitor" && requestRow.requested_by_staff_id !== actor.staffId) {
    throw new Error("Solo puedes eliminar tus propias solicitudes pendientes");
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM public.eventos
      WHERE id = ${requestRow.event_id}::uuid
    `;
  });

  return { requestId, eventId: requestRow.event_id };
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

export const findAvailableRooms = async (payload: SearchAvailableRoomsInput) => {
  const rows = await prisma.$queryRaw<Array<{ room: string; capacity: number; floor: number }>>`
    SELECT
      s.nombre_bloque AS room,
      COALESCE(s.capacidad, 0) AS capacity,
      COALESCE(s.piso, 0) AS floor
    FROM public.salones s
    WHERE COALESCE(s.capacidad, 0) >= ${payload.minCapacity}
      AND NOT EXISTS (
        SELECT 1
        FROM public.horarios_evento h
        INNER JOIN public.eventos e ON e.id = h.evento_id
        WHERE h.salon_id = s.id
          AND h.dia_semana = ${payload.day}::public.dia_semana_enum
          AND e.fecha_inicio <= ${payload.date}::date
          AND e.fecha_fin >= ${payload.date}::date
          AND (${payload.startTime}::time < h.hora_fin AND h.hora_inicio < ${payload.endTime}::time)
      )
    ORDER BY COALESCE(s.capacidad, 0) ASC, COALESCE(s.piso, 0) ASC, s.nombre_bloque ASC
  `;

  return rows.map((row) => ({
    room: canonicalRoomName(row.room) ?? row.room,
    capacity: Number(row.capacity ?? 0),
    floor: Number(row.floor ?? 0),
  }));
};
