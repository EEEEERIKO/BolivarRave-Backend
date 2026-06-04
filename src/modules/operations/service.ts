import { prisma } from "../../lib/prisma";
import { getRooms, getScheduleEvents } from "../schedules/service";
import { listAllStaffJornadasSemanales, listAllStaffPausasProgramadas, listStaff } from "../staff/service";
import { listReservationRequests, type ReservationRequestRow } from "../reservas/service";
import { getAttendanceDashboard, type ExpectedStaffEntry } from "../registro/service";

type RoomCatalogItem = {
  id: string;
  name: string;
  piso: number | null;
  capacidad: number | null;
};

type RoomActionRow = {
  id: string;
  roomId: string;
  roomName: string;
  actionType: "inhabilitado" | "habilitado" | "danio_reportado" | "salon_limpio";
  note: string | null;
  createdAt: string;
  createdByStaffId: string | null;
  createdByName: string | null;
  createdByRole: string | null;
};

type ScheduleEventRow = Awaited<ReturnType<typeof getScheduleEvents>>[number];

export type OperationsDashboardStaffItem = {
  id: string;
  nombre: string;
  cedula: string;
  rol: string;
  estado: string;
  fechaCreacion: string;
  attendanceStatus: "registrado" | "no_registrado";
};

export type OperationsDashboardLoanItem = {
  id: string;
  resourceType: ReservationRequestRow["resourceType"];
  resourceLabel: string;
  resourceContext: string | null;
  destinationRoomLabel: string | null;
  requesterName: string;
  requesterDocument: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  status: string;
  minutesUntilStart: number;
  minutesUntilEnd: number;
  badge: "proximo" | "vigente" | "vencido" | "alerta";
  nextAction: "desplazar" | "devolver" | "revisar";
  actionLabel: string;
};

export type OperationsDashboardRoomItem = {
  id: string;
  name: string;
  piso: number | null;
  capacidad: number | null;
  lastCleanAt: string | null;
  lastDamageAt: string | null;
  nextClassAt: string | null;
  nextClassLabel: string | null;
  minutesSinceLastClean: number | null;
  minutesUntilNextClass: number | null;
  priorityScore: number;
  urgency: "inmediata" | "alta" | "media" | "baja" | "limpio";
  displayState: "ocupado" | "requerido" | "recomendado" | "limpio";
  reason: string;
  cleanedByName: string | null;
  occupiedNow: boolean;
};

export type OperationsDashboardAlertItem = {
  id: string;
  kind: "damage" | "clean" | "staff" | "room" | "loan";
  severity: "info" | "warning" | "danger";
  title: string;
  message: string;
  createdAt: string;
  roomName?: string | null;
};

export type OperationsDashboardResponse = {
  generatedAt: string;
  operationsStatus: {
    label: "bien" | "mal";
    message: string;
    cleanCoverage5hPercent: number;
  };
  summary: {
    rooms: number;
    immediatePriorities: number;
    activeLoans: number;
    staff: number;
    damageReports: number;
    cleanReports: number;
    cleanCoverage5hPercent: number;
    cleanedRoomsLast5h: number;
  };
  topCleanTasks: OperationsDashboardRoomItem[];
  urgentRooms: OperationsDashboardRoomItem[];
  staff: OperationsDashboardStaffItem[];
  activeLoans: OperationsDashboardLoanItem[];
  roomReports: RoomActionRow[];
  alerts: OperationsDashboardAlertItem[];
};

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"] as const;
const MINUTES_PER_DAY = 24 * 60;
const WORK_START_MINUTE = 5 * 60;
const WORK_END_MINUTE = 22 * 60;
const REQUIRED_CLEANING_THRESHOLD_MINUTES = 5 * 60;
const BOGOTA_UTC_OFFSET_MINUTES = -5 * 60;

const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const roomKey = (value: string) => normalizeText(value);

const toMinutes = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
};

const isMinuteInRange = (minute: number, start: string, end: string) => {
  const startMinute = toMinutes(start);
  const endMinute = toMinutes(end);
  return minute >= startMinute && minute < endMinute;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const parseIsoDate = (value: string | null | undefined) => {
  if (!value || typeof value !== "string") {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
};

const parseDateTime = (dateValue: Date, timeValue: string) => {
  const [hour, minute] = timeValue.split(":").map(Number);
  const result = new Date(dateValue);
  result.setHours(hour ?? 0, minute ?? 0, 0, 0);
  return result;
};

const parseReservationDateTime = (dateText: string | null | undefined, timeValue: string) => {
  const datePart = parseIsoDate(dateText);
  if (!datePart) {
    return null;
  }

  return parseDateTime(datePart, timeValue);
};

const containsGhostTestValue = (value: string | null | undefined) => {
  if (!value) {
    return false;
  }

  return normalizeText(value).includes("test");
};

const formatDateTimeLabel = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
};

const formatTimeAmPm = (value: string) => {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return value;
  }

  const suffix = hour >= 12 ? "PM" : "AM";
  const normalizedHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${normalizedHour}:${String(minute).padStart(2, "0")} ${suffix}`;
};

const getTodayDayName = (date: Date) => DAY_NAMES[date.getDay()] ?? "Lunes";

const isRoomOccupiedNow = (roomName: string, events: ScheduleEventRow[], now: Date) => {
  const normalizedRoom = roomKey(roomName);
  const currentDayName = getTodayDayName(now);

  for (const event of events) {
    const startDateText = event.startDate;
    const endDateText = event.endDate;

    if (!event.room || !event.day || !event.start || !event.end || !startDateText || !endDateText) {
      continue;
    }

    if (roomKey(event.room) !== normalizedRoom) {
      continue;
    }

    if (normalizeText(event.day) !== normalizeText(currentDayName)) {
      continue;
    }

    const eventStartDate = parseIsoDate(startDateText);
    const eventEndDate = parseIsoDate(endDateText);
    const todayKey = new Date(now);
    todayKey.setHours(0, 0, 0, 0);

    if (!eventStartDate || !eventEndDate) {
      continue;
    }

    if (todayKey < eventStartDate || todayKey > eventEndDate) {
      continue;
    }

    const start = parseDateTime(now, event.start);
    const end = parseDateTime(now, event.end);
    if (now >= start && now < end) {
      return true;
    }
  }

  return false;
};

const getBogotaClock = (date: Date) => {
  const formatter = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const weekday = (parts.find((part) => part.type === "weekday")?.value ?? "lunes").trim();
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");

  return {
    weekday,
    minutes: (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0),
  };
};

const getWorkingMinutesElapsed = (start: Date | null, end: Date) => {
  if (!start) {
    return null;
  }

  const startMs = start.getTime();
  const endMs = end.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 0;
  }

  const offsetMs = BOGOTA_UTC_OFFSET_MINUTES * 60 * 1000;
  const localStartMs = startMs + offsetMs;
  const localEndMs = endMs + offsetMs;
  const dayMs = MINUTES_PER_DAY * 60 * 1000;

  const startDayIndex = Math.floor(localStartMs / dayMs);
  const endDayIndex = Math.floor(localEndMs / dayMs);

  let totalMs = 0;

  for (let dayIndex = startDayIndex; dayIndex <= endDayIndex; dayIndex += 1) {
    const dayStartMs = dayIndex * dayMs;
    const workStartMs = dayStartMs + WORK_START_MINUTE * 60 * 1000;
    const workEndMs = dayStartMs + WORK_END_MINUTE * 60 * 1000;

    const windowStart = Math.max(localStartMs, workStartMs);
    const windowEnd = Math.min(localEndMs, workEndMs);

    if (windowEnd > windowStart) {
      totalMs += windowEnd - windowStart;
    }
  }

  return Math.max(0, Math.round(totalMs / 60000));
};

const safe = async <T>(promise: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await promise;
  } catch {
    return fallback;
  }
};

const listRoomActions = async (): Promise<RoomActionRow[]> => {
  const rows = await prisma.$queryRaw<Array<RoomActionRow>>`
    SELECT
      h.id::text AS id,
      h.salon_id::text AS "roomId",
      h.room_name AS "roomName",
      h.action_type AS "actionType",
      h.note,
      TO_CHAR(h.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
      h.created_by_staff_id::text AS "createdByStaffId",
      h.created_by_name AS "createdByName",
      h.created_by_role AS "createdByRole"
    FROM public.schedule_room_action_history h
    ORDER BY h.created_at DESC
    LIMIT 100
  `;

  return rows;
};

const getRoomCatalog = async (): Promise<RoomCatalogItem[]> => {
  const roomNames = await safe(getRooms(), [] as string[]);
  const rows = await prisma.$queryRaw<Array<RoomCatalogItem>>`
    SELECT
      id::text AS id,
      nombre_bloque AS name,
      piso,
      capacidad
    FROM public.salones
  `;

  const byKey = new Map(rows.map((room) => [roomKey(room.name), room] as const));
  return roomNames
    .map((name) => byKey.get(roomKey(name)))
    .filter((room): room is RoomCatalogItem => Boolean(room));
};

const getNextClassForRoom = (roomName: string, events: ScheduleEventRow[], now: Date) => {
  const normalizedRoom = roomKey(roomName);
  let nextClass: { start: Date; end: Date; subject: string; teacher: string; faculty: string } | null = null;

  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const candidateDate = addDays(now, dayOffset);
    const candidateDayName = getTodayDayName(candidateDate);

    for (const event of events) {
      const startDateText = event.startDate;
      const endDateText = event.endDate;

      if (!event.room || !event.day || !event.start || !event.end || !startDateText || !endDateText) {
        continue;
      }

      if (roomKey(event.room) !== normalizedRoom) {
        continue;
      }

      if (normalizeText(event.day) !== normalizeText(candidateDayName)) {
        continue;
      }

      const eventStartDate = parseIsoDate(startDateText);
      const eventEndDate = parseIsoDate(endDateText);
      const candidateDayKey = new Date(candidateDate);
      candidateDayKey.setHours(0, 0, 0, 0);

      if (!eventStartDate || !eventEndDate) {
        continue;
      }

      if (candidateDayKey < eventStartDate || candidateDayKey > eventEndDate) {
        continue;
      }

      const start = parseDateTime(candidateDate, event.start);
      const end = parseDateTime(candidateDate, event.end);

      if (end <= now) {
        continue;
      }

      if (!nextClass || start < nextClass.start) {
        nextClass = {
          start,
          end,
          subject: event.subject,
          teacher: event.teacher,
          faculty: event.faculty,
        };
      }
    }
  }

  return nextClass;
};

const computeRoomPriority = (
  room: RoomCatalogItem,
  events: ScheduleEventRow[],
  latestCleanByRoom: Map<string, RoomActionRow>,
  latestDamageByRoom: Map<string, RoomActionRow>,
  now: Date,
) => {
  const normalizedRoom = roomKey(room.name);
  const lastClean = latestCleanByRoom.get(normalizedRoom) ?? null;
  const lastDamage = latestDamageByRoom.get(normalizedRoom) ?? null;
  const nextClass = getNextClassForRoom(room.name, events, now);
  const occupiedNow = isRoomOccupiedNow(room.name, events, now);

  const lastCleanAtDate = lastClean ? new Date(lastClean.createdAt) : null;
  const minutesSinceLastClean = getWorkingMinutesElapsed(lastCleanAtDate, now);

  let minutesUntilNextClass: number | null = null;

  if (nextClass) {
    minutesUntilNextClass = Math.max(0, Math.round((nextClass.start.getTime() - now.getTime()) / 60000));
  }

  const hasClassSoon = minutesUntilNextClass !== null && minutesUntilNextClass <= 60;
  const staleMinutesForRanking = minutesSinceLastClean ?? Number.MAX_SAFE_INTEGER;
  const score = staleMinutesForRanking + (hasClassSoon ? 500 : 0);

  const baseState: OperationsDashboardRoomItem["displayState"] =
    minutesSinceLastClean === null || minutesSinceLastClean >= REQUIRED_CLEANING_THRESHOLD_MINUTES
      ? "requerido"
      : "recomendado";

  const displayState: OperationsDashboardRoomItem["displayState"] = occupiedNow ? "ocupado" : baseState;

  const urgency: OperationsDashboardRoomItem["urgency"] =
    displayState === "requerido"
      ? "alta"
      : displayState === "recomendado"
        ? "media"
        : "baja";

  let reason = "Sin acción prioritaria";
  if (minutesSinceLastClean === null) {
    reason = "Sin registro de aseo reciente";
  } else if (hasClassSoon) {
    reason = `Próxima clase en ${minutesUntilNextClass} min · último aseo hace ${Math.round(minutesSinceLastClean / 60)} h laborales`;
  } else {
    reason = `Último aseo hace ${Math.round(minutesSinceLastClean / 60)} h laborales`;
  }

  return {
    id: room.id,
    name: room.name,
    piso: room.piso,
    capacidad: room.capacidad,
    lastCleanAt: lastClean?.createdAt ?? null,
    lastDamageAt: lastDamage?.createdAt ?? null,
    nextClassAt: nextClass ? formatDateTimeLabel(nextClass.start) : null,
    nextClassLabel: nextClass ? `${getTodayDayName(nextClass.start)} ${formatTimeAmPm(`${String(nextClass.start.getHours()).padStart(2, "0")}:${String(nextClass.start.getMinutes()).padStart(2, "0")}`)}` : null,
    minutesSinceLastClean,
    minutesUntilNextClass,
    priorityScore: Math.round(score),
    urgency,
    displayState,
    reason,
    cleanedByName: lastClean?.createdByName ?? null,
    occupiedNow,
  } satisfies OperationsDashboardRoomItem;
};

const roomDisplayPriorityRank: Record<OperationsDashboardRoomItem["displayState"], number> = {
  requerido: 3,
  recomendado: 2,
  ocupado: 1,
  limpio: 0,
};

const getLoanBadge = (minutesUntilStart: number, minutesUntilEnd: number, status: string): OperationsDashboardLoanItem["badge"] => {
  if (status === "reportado" || minutesUntilEnd < 0) {
    return "vencido";
  }

  if (minutesUntilStart > 0 && minutesUntilStart <= 20) {
    return "alerta";
  }

  if (minutesUntilStart > 0) {
    return "proximo";
  }

  return minutesUntilEnd <= 20 ? "alerta" : "vigente";
};

const buildLoanActionLabel = (reservation: ReservationRequestRow, minutesUntilStart: number, minutesUntilEnd: number, badge: OperationsDashboardLoanItem["badge"]) => {
  const destination = reservation.destinationRoomLabel?.trim() || "destino";

  if (badge === "vencido") {
    return {
      nextAction: "devolver" as const,
      actionLabel: `DEVOLVER URGENTE · ATRASADO ${Math.abs(minutesUntilEnd)} MIN`,
    };
  }

  if (minutesUntilStart > 0) {
    return {
      nextAction: "desplazar" as const,
      actionLabel: `DESPLAZAR A ${destination.toUpperCase()} EN ${minutesUntilStart} MIN`,
    };
  }

  if (minutesUntilEnd >= 0) {
    return {
      nextAction: "devolver" as const,
      actionLabel: `DEVOLVER EN ${minutesUntilEnd} MIN`,
    };
  }

  return {
    nextAction: "revisar" as const,
    actionLabel: "REVISAR ESTADO DEL PRÉSTAMO",
  };
};

export const getOperationsDashboard = async (): Promise<OperationsDashboardResponse> => {
  const now = new Date();
  const bogotaClock = getBogotaClock(now);
  const currentDayName = bogotaClock.weekday;
  const currentMinute = bogotaClock.minutes;

  const [catalog, events, staff, reservations, actions, jornadasByStaffId, pausasByStaffId, attendanceDashboard] = await Promise.all([
    safe(getRoomCatalog(), [] as RoomCatalogItem[]),
    safe(getScheduleEvents(), [] as ScheduleEventRow[]),
    safe(listStaff(), [] as Array<{ id: string; nombres: string; apellidos: string; cedula: string; rol: string; estado: string; fechaCreacion?: string }>),
    safe(listReservationRequests(), [] as ReservationRequestRow[]),
    safe(listRoomActions(), [] as RoomActionRow[]),
    safe(listAllStaffJornadasSemanales(), {} as Record<string, Array<{ id: string; staffId: string; diaSemana: string; horaEntrada: string; horaSalida: string; totalHorasDia: number }>>),
    safe(listAllStaffPausasProgramadas(), {} as Record<string, Array<{ id: string; staffId: string; diaSemana: string; tipoPausa: string; horaInicio: string; horaFin: string }>>),
    safe(getAttendanceDashboard(), null as Awaited<ReturnType<typeof getAttendanceDashboard>> | null),
  ]);

  const latestCleanByRoom = new Map<string, RoomActionRow>();
  const latestDamageByRoom = new Map<string, RoomActionRow>();

  for (const action of actions) {
    const key = roomKey(action.roomName);
    if (action.actionType === "salon_limpio" && !latestCleanByRoom.has(key)) {
      latestCleanByRoom.set(key, action);
    }
    if (action.actionType === "danio_reportado" && !latestDamageByRoom.has(key)) {
      latestDamageByRoom.set(key, action);
    }
  }

  const roomPriorities = catalog.map((room) => computeRoomPriority(room, events, latestCleanByRoom, latestDamageByRoom, now));
  roomPriorities.sort((left, right) => {
    const statePriorityDiff = roomDisplayPriorityRank[right.displayState] - roomDisplayPriorityRank[left.displayState];
    if (statePriorityDiff !== 0) {
      return statePriorityDiff;
    }

    const leftStaleMinutes = left.minutesSinceLastClean ?? Number.MAX_SAFE_INTEGER;
    const rightStaleMinutes = right.minutesSinceLastClean ?? Number.MAX_SAFE_INTEGER;
    const staleDiff = rightStaleMinutes - leftStaleMinutes;
    if (staleDiff !== 0) {
      return staleDiff;
    }

    const leftHasClassSoon = left.minutesUntilNextClass !== null && left.minutesUntilNextClass <= 60 ? 1 : 0;
    const rightHasClassSoon = right.minutesUntilNextClass !== null && right.minutesUntilNextClass <= 60 ? 1 : 0;
    const classSoonDiff = rightHasClassSoon - leftHasClassSoon;
    if (classSoonDiff !== 0) {
      return classSoonDiff;
    }

    const leftMinutesUntilClass = left.minutesUntilNextClass ?? Number.MAX_SAFE_INTEGER;
    const rightMinutesUntilClass = right.minutesUntilNextClass ?? Number.MAX_SAFE_INTEGER;
    const nextClassDiff = leftMinutesUntilClass - rightMinutesUntilClass;
    if (nextClassDiff !== 0) {
      return nextClassDiff;
    }

    return right.priorityScore - left.priorityScore || left.name.localeCompare(right.name);
  });

  const urgentRooms = roomPriorities.slice(0, 8);
  const topCleanTasks = actions
    .filter((action) => action.actionType === "salon_limpio")
    .slice(0, 8)
    .map((action) => {
      const room = roomPriorities.find((item) => roomKey(item.name) === roomKey(action.roomName));
      const fallbackDisplayState: OperationsDashboardRoomItem["displayState"] = "limpio";
      return {
        ...room,
        id: room?.id ?? action.roomId,
        name: room?.name ?? action.roomName,
        piso: room?.piso ?? null,
        capacidad: room?.capacidad ?? null,
        lastCleanAt: action.createdAt,
        lastDamageAt: room?.lastDamageAt ?? null,
        nextClassAt: room?.nextClassAt ?? null,
        nextClassLabel: room?.nextClassLabel ?? null,
        minutesSinceLastClean: room?.minutesSinceLastClean ?? null,
        minutesUntilNextClass: room?.minutesUntilNextClass ?? null,
        priorityScore: room?.priorityScore ?? 0,
        urgency: room?.urgency ?? "baja",
        displayState: room?.displayState ?? fallbackDisplayState,
        reason: room?.reason ?? "Limpieza registrada recientemente",
        cleanedByName: action.createdByName ?? room?.cleanedByName ?? null,
        occupiedNow: room?.occupiedNow ?? false,
      } satisfies OperationsDashboardRoomItem;
    });

  const activeLoans = reservations
    .filter((reservation) => reservation.resourceType === "equipment" || reservation.resourceType === "televisor")
    .filter((reservation) => ["no_aceptado", "confirmada", "reportado"].includes(reservation.status))
    .filter((reservation) => !containsGhostTestValue(reservation.resourceLabel))
    .filter((reservation) => !containsGhostTestValue(reservation.requesterName))
    .filter((reservation) => !containsGhostTestValue(reservation.resourceContext))
    .filter((reservation) => !containsGhostTestValue(reservation.destinationRoomLabel))
    .filter((reservation) => !containsGhostTestValue(reservation.requesterDocument))
    .map<OperationsDashboardLoanItem | null>((reservation) => {
      const start = parseReservationDateTime(reservation.bookingDate, reservation.startTime);
      const end = parseReservationDateTime(reservation.bookingDate, reservation.endTime);
      if (!start || !end) {
        return null;
      }

      const minutesUntilStart = Math.round((start.getTime() - now.getTime()) / 60000);
      const minutesUntilEnd = Math.round((end.getTime() - now.getTime()) / 60000);
      const badge = getLoanBadge(minutesUntilStart, minutesUntilEnd, reservation.status);
      const action = buildLoanActionLabel(reservation, minutesUntilStart, minutesUntilEnd, badge);

      return {
        id: reservation.id,
        resourceType: reservation.resourceType,
        resourceLabel: reservation.resourceLabel,
        resourceContext: reservation.resourceContext,
        destinationRoomLabel: reservation.destinationRoomLabel,
        requesterName: reservation.requesterName,
        requesterDocument: reservation.requesterDocument,
        bookingDate: reservation.bookingDate,
        startTime: reservation.startTime,
        endTime: reservation.endTime,
        status: reservation.status,
        minutesUntilStart,
        minutesUntilEnd,
        badge,
        nextAction: action.nextAction,
        actionLabel: action.actionLabel,
      };
    })
    .filter((item): item is OperationsDashboardLoanItem => item !== null)
    .sort((left, right) => left.minutesUntilStart - right.minutesUntilStart)
    .slice(0, 10);

  const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const cleanedRoomKeysLast5h = new Set(
    actions
      .filter((action) => action.actionType === "salon_limpio")
      .filter((action) => new Date(action.createdAt) >= fiveHoursAgo)
      .map((action) => roomKey(action.roomName))
  );
  const cleanedRoomsLast5h = cleanedRoomKeysLast5h.size;
  const cleanCoverage5hPercent = catalog.length > 0
    ? Math.round((cleanedRoomsLast5h / catalog.length) * 100)
    : 0;

  const registeredNowStaffIds = new Set((attendanceDashboard?.usuariosActivos ?? []).map((item) => item.staffId));

  const staffItems = staff
    .filter((item) => item.estado === "Active")
    .filter((item) => {
      const jornadas = jornadasByStaffId[item.id] ?? [];

      const hasActiveJornada = jornadas.some((jornada) => {
        if (normalizeText(jornada.diaSemana) !== normalizeText(currentDayName)) {
          return false;
        }

        return isMinuteInRange(currentMinute, jornada.horaEntrada, jornada.horaSalida);
      });

      return hasActiveJornada;
    })
    .slice(0, 12)
    .map((item) => ({
      id: item.id,
      nombre: `${item.nombres} ${item.apellidos}`.trim(),
      cedula: item.cedula,
      rol: item.rol,
      estado: item.estado,
      fechaCreacion: item.fechaCreacion ?? now.toISOString(),
      attendanceStatus: registeredNowStaffIds.has(item.id) ? "registrado" : "no_registrado",
    } satisfies OperationsDashboardStaffItem));

  const damageReports = actions.filter((action) => action.actionType === "danio_reportado");
  const cleanReports = actions.filter((action) => action.actionType === "salon_limpio");
  const pendingNoShowStaff = (attendanceDashboard?.usuariosNoRegistradosAhora ?? [])
    .map((person) => {
      const startMinute = toMinutes(person.horaEntrada);
      if (startMinute < 0) {
        return null;
      }

      const delayMinutes = currentMinute - startMinute;
      return {
        ...person,
        delayMinutes,
      };
    })
    .filter((person): person is ExpectedStaffEntry & { delayMinutes: number } => person !== null)
    .filter((person) => person.delayMinutes >= 0)
    .sort((left, right) => right.delayMinutes - left.delayMinutes)
    .slice(0, 6);

  const alerts: OperationsDashboardAlertItem[] = [
    ...damageReports.slice(0, 4).map((action) => ({
      id: `damage:${action.id}`,
      kind: "damage" as const,
      severity: "danger" as const,
      title: `Daño reportado en ${action.roomName}`,
      message: action.note ?? "Reporte de daño sin detalle adicional",
      createdAt: action.createdAt,
      roomName: action.roomName,
    })),
    ...urgentRooms.slice(0, 3).map((room) => ({
      id: `room:${room.id}`,
      kind: "room" as const,
      severity: "warning" as const,
      title: `Limpieza prioritaria: ${room.name}`,
      message: room.reason,
      createdAt: now.toISOString(),
      roomName: room.name,
    })),
    ...pendingNoShowStaff.map((person) => ({
      id: `staff-missing:${person.staffId}`,
      kind: "staff" as const,
      severity: person.delayMinutes >= 20 ? "danger" as const : "warning" as const,
      title: `Falta registro de ingreso: ${person.nombreCompleto}`,
      message: person.delayMinutes >= 20
        ? `Han pasado ${person.delayMinutes} min desde ${person.horaEntrada} y no se ha registrado (turno hasta ${person.horaSalida})`
        : `Debía iniciar a las ${person.horaEntrada} y aún no se registra (${person.delayMinutes} min)` ,
      createdAt: now.toISOString(),
    })),
    ...activeLoans.filter((loan) => loan.badge === "alerta" || loan.badge === "vencido").slice(0, 3).map((loan) => ({
      id: `loan:${loan.id}`,
      kind: "loan" as const,
      severity: loan.badge === "vencido" ? "danger" as const : "warning" as const,
      title: `${loan.resourceLabel} ${loan.badge === "vencido" ? "debería haberse devuelto" : "debe moverse pronto"}`,
      message: loan.badge === "vencido"
        ? `Retraso de ${Math.abs(loan.minutesUntilEnd)} min`
        : `Faltan ${Math.max(0, loan.minutesUntilStart)} min para el movimiento`,
      createdAt: now.toISOString(),
    })),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  const operationsStatus: OperationsDashboardResponse["operationsStatus"] = cleanCoverage5hPercent >= 70
    ? {
        label: "bien",
        message: "Rendimiento de limpieza dentro del objetivo",
        cleanCoverage5hPercent,
      }
    : {
        label: "mal",
        message: "Rendimiento bajo: se debe subir cobertura de limpieza",
        cleanCoverage5hPercent,
      };

  return {
    generatedAt: now.toISOString(),
    operationsStatus,
    summary: {
      rooms: catalog.length,
      immediatePriorities: urgentRooms.length,
      activeLoans: activeLoans.length,
      staff: staffItems.length,
      damageReports: damageReports.length,
      cleanReports: cleanReports.length,
      cleanCoverage5hPercent,
      cleanedRoomsLast5h,
    },
    topCleanTasks,
    urgentRooms,
    staff: staffItems,
    activeLoans,
    roomReports: damageReports,
    alerts,
  };
};