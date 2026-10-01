import { prisma } from "../../lib/prisma";
import { getStaffByCedula, getStaffHorarioLaboral, listStaff, listStaffJornadaSemanal } from "../staff/service";

const COLOMBIA_TIMEZONE = "America/Bogota";

type StaffRecord = NonNullable<Awaited<ReturnType<typeof getStaffByCedula>>>;
type StaffJornada = Awaited<ReturnType<typeof listStaffJornadaSemanal>>[number];

type AttendanceRawRow = {
  id: string;
  staff_id: string;
  jornada_id: string;
  fecha: string;
  hora_entrada: string | null;
  hora_salida: string | null;
  minutos_tarde: number;
  minutos_salida_anticipada: number;
  minutos_balance: number;
  created_at: string;
  updated_at: string;
};

type AttendanceMovementRawRow = {
  id: string;
  staff_id: string;
  nombres: string;
  apellidos: string;
  actividad: "Entrada" | "Salida";
  estado: string;
  fecha: string;
  hora: string;
};

type ActiveStaffRawRow = {
  id: string;
  staff_id: string;
  nombres: string;
  apellidos: string;
  rol: string;
  hora_entrada: string;
};

type StaffLiveScheduleItem = {
  diaSemana: string;
  horaEntrada: string;
  horaSalida: string;
};

type StaffLivePauseItem = {
  diaSemana: string;
  horaInicio: string;
  horaFin: string;
};

export type AttendanceRecord = {
  id: string;
  staffId: string;
  jornadaId: string;
  fecha: string;
  horaEntrada: string | null;
  horaSalida: string | null;
  minutosTarde: number;
  minutosSalidaAnticipada: number;
  minutosBalance: number;
  createdAt: string;
  updatedAt: string;
};

type AttendanceJornadaSummary = {
  id: string;
  diaSemana: string;
  horaEntrada: string;
  horaSalida: string;
  totalHorasDia: number;
};

type BogotaNow = {
  dateKey: string;
  weekday: string;
  timeKey: string;
  minutes: number;
};

export type AttendancePreview = {
  staff: StaffRecord;
  fecha: string;
  diaSemana: string;
  horaActual: string;
  jornadasDelDia: AttendanceJornadaSummary[];
  jornadaActiva: AttendanceJornadaSummary | null;
  registrosHoy: AttendanceRecord[];
  registroAbierto: AttendanceRecord | null;
  minutosTardeHoy: number;
  minutosSalidaAnticipadaHoy: number;
  minutosBalanceHoy: number;
  puedeRegistrarEntrada: boolean;
  puedeRegistrarSalida: boolean;
  mensaje: string;
};

export type AttendanceMovement = {
  id: string;
  staffId: string;
  nombreCompleto: string;
  actividad: "Entrada" | "Salida";
  estado: string;
  fecha: string;
  hora: string;
};

export type ActiveStaffEntry = {
  id: string;
  staffId: string;
  nombreCompleto: string;
  rol: string;
  horaEntrada: string;
};

export type ExpectedStaffEntry = {
  id: string;
  staffId: string;
  nombreCompleto: string;
  rol: string;
  horaEntrada: string;
  horaSalida: string;
  estadoRegistro: "registrado" | "no registrado";
};

export type AttendanceDashboard = {
  fecha: string;
  horaActual: string;
  movimientosRecientes: AttendanceMovement[];
  usuariosActivosAhora: ExpectedStaffEntry[];
  usuariosRegistradosAhora: ExpectedStaffEntry[];
  usuariosNoRegistradosAhora: ExpectedStaffEntry[];
  totalActivosAhora: number;
  totalRegistradosAhora: number;
  totalNoRegistradosAhora: number;
  usuariosActivos: ActiveStaffEntry[];
  totalPresentes: number;
};

export class AttendanceError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AttendanceError";
    this.status = status;
  }
}

let ensureAttendanceSchemaPromise: Promise<void> | null = null;

type TableExistsRow = {
  exists: boolean;
};

const ensureAttendanceSchema = async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.staff_registros_asistencia (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
      jornada_id uuid NOT NULL REFERENCES public.staff_jornada_semanal(id) ON DELETE RESTRICT,
      fecha date NOT NULL,
      hora_entrada timestamptz NOT NULL,
      hora_salida timestamptz,
      minutos_tarde integer NOT NULL DEFAULT 0,
      minutos_salida_anticipada integer NOT NULL DEFAULT 0,
      minutos_balance integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT staff_registros_asistencia_unico_por_jornada UNIQUE (staff_id, jornada_id, fecha)
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS staff_registros_asistencia_staff_fecha_idx
    ON public.staff_registros_asistencia (staff_id, fecha DESC, created_at DESC)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS staff_registros_asistencia_fecha_idx
    ON public.staff_registros_asistencia (fecha DESC)
  `);
};

const ensureAttendanceSchemaReady = async () => {
  const existsRows = await prisma.$queryRaw<TableExistsRow[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'staff_registros_asistencia'
    ) AS exists
  `;

  if (existsRows[0]?.exists) {
    return;
  }

  if (!ensureAttendanceSchemaPromise) {
    ensureAttendanceSchemaPromise = ensureAttendanceSchema()
      .then(async () => {
        const verificationRows = await prisma.$queryRaw<TableExistsRow[]>`
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = 'staff_registros_asistencia'
          ) AS exists
        `;

        if (!verificationRows[0]?.exists) {
          throw new AttendanceError(
            "No se pudo inicializar la tabla de asistencia. Verifica las migraciones o permisos del esquema public.",
            500,
          );
        }
      })
      .catch((error) => {
        ensureAttendanceSchemaPromise = null;
        throw error;
      });
  }

  await ensureAttendanceSchemaPromise;
};

const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const asUuidOrNull = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return UUID_PATTERN.test(trimmed) ? trimmed : null;
};

const timeToMinutes = (value: string) => {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return Number.NaN;
  }

  return hour * 60 + minute;
};

const isWithinRange = (startTime: string, endTime: string, currentMinutes: number) => {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);

  return Number.isFinite(start) && Number.isFinite(end) && start <= currentMinutes && currentMinutes < end;
};

const findActiveLiveJornada = (jornadas: StaffLiveScheduleItem[], currentMinutes: number) =>
  jornadas.find((jornada) => isWithinRange(jornada.horaEntrada, jornada.horaSalida, currentMinutes)) ?? null;

const isInActivePause = (pausas: StaffLivePauseItem[], currentMinutes: number, currentDayKey: string) =>
  pausas.some((pausa) => normalizeText(pausa.diaSemana) === normalizeText(currentDayKey) && isWithinRange(pausa.horaInicio, pausa.horaFin, currentMinutes));

const DAY_MAP: Record<string, string> = {
  lunes: "Lunes",
  martes: "Martes",
  miercoles: "Miercoles",
  jueves: "Jueves",
  viernes: "Viernes",
  sabado: "Sabado",
  domingo: "Domingo",
};

const toMinutes = (value: string) => {
  const [hoursText, minutesText] = value.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return 0;
  }

  return hours * 60 + minutes;
};

const formatTime = (value: string) => {
  const [hoursText, minutesText] = value.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return value;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const getBogotaNow = (date = new Date()): BogotaNow => {
  const parts = new Intl.DateTimeFormat("es-CO", {
    timeZone: COLOMBIA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = DAY_MAP[normalizeText(getPart("weekday"))] ?? getPart("weekday");
  const hours = Number(getPart("hour"));
  const minutes = Number(getPart("minute"));
  const seconds = Number(getPart("second"));

  return {
    dateKey: `${getPart("year")}-${getPart("month")}-${getPart("day")}`,
    weekday,
    timeKey: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
    minutes: Number.isFinite(hours) && Number.isFinite(minutes) ? hours * 60 + minutes : 0,
  };
};

const toIsoTimestamp = (date: Date) => date.toISOString();

const mapAttendanceRows = (rows: AttendanceRawRow[]): AttendanceRecord[] =>
  rows.map((row) => ({
    id: row.id,
    staffId: row.staff_id,
    jornadaId: row.jornada_id,
    fecha: row.fecha,
    horaEntrada: row.hora_entrada,
    horaSalida: row.hora_salida,
    minutosTarde: row.minutos_tarde,
    minutosSalidaAnticipada: row.minutos_salida_anticipada,
    minutosBalance: row.minutos_balance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

const mapJornada = (jornada: StaffJornada): AttendanceJornadaSummary => ({
  id: jornada.id,
  diaSemana: jornada.diaSemana,
  horaEntrada: formatTime(jornada.horaEntrada),
  horaSalida: formatTime(jornada.horaSalida),
  totalHorasDia: jornada.totalHorasDia,
});

const findActiveJornada = (jornadas: StaffJornada[], currentMinutes: number) => {
  const ordered = [...jornadas].sort((left, right) => toMinutes(left.horaEntrada) - toMinutes(right.horaEntrada));

  return (
    ordered.find((jornada) => {
      const start = toMinutes(jornada.horaEntrada);
      const end = toMinutes(jornada.horaSalida);
      return currentMinutes >= start - 5 && currentMinutes <= end;
    }) ?? null
  );
};

const getCurrentAttendanceEntry = async (staffId: string, fecha: string) => {
  const rows = await prisma.$queryRaw<AttendanceRawRow[]>`
    SELECT
      id::text AS id,
      staff_id::text AS staff_id,
      jornada_id::text AS jornada_id,
      TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha,
      TO_CHAR(hora_entrada, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS hora_entrada,
      TO_CHAR(hora_salida, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS hora_salida,
      minutos_tarde,
      minutos_salida_anticipada,
      minutos_balance,
      TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
      TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
    FROM public.staff_registros_asistencia
    WHERE staff_id = ${staffId}::uuid
      AND fecha = ${fecha}::date
    ORDER BY created_at DESC, id DESC
  `;

  return mapAttendanceRows(rows);
};

const isMissingAttendanceTableError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes("42p01") && normalized.includes("staff_registros_asistencia");
};

const runAttendanceQueryWithRecovery = async <T>(query: () => Promise<T>): Promise<T> => {
  try {
    return await query();
  } catch (error) {
    if (!isMissingAttendanceTableError(error)) {
      throw error;
    }

    ensureAttendanceSchemaPromise = null;
    await ensureAttendanceSchemaReady();
    return query();
  }
};

const getAttendanceRowsForDate = async (staffId: string, fecha: string) => {
  const rows = await runAttendanceQueryWithRecovery(() =>
    prisma.$queryRaw<AttendanceRawRow[]>`
      SELECT
        id::text AS id,
        staff_id::text AS staff_id,
        jornada_id::text AS jornada_id,
        TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha,
        TO_CHAR(hora_entrada, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS hora_entrada,
        TO_CHAR(hora_salida, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS hora_salida,
        minutos_tarde,
        minutos_salida_anticipada,
        minutos_balance,
        TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
        TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
      FROM public.staff_registros_asistencia
      WHERE staff_id = ${staffId}::uuid
        AND fecha = ${fecha}::date
      ORDER BY created_at DESC, id DESC
    `,
  );

  return mapAttendanceRows(rows);
};

const getAttendanceRowByJornada = async (staffId: string, fecha: string, jornadaId: string) => {
  const rows = await runAttendanceQueryWithRecovery(() =>
    prisma.$queryRaw<AttendanceRawRow[]>`
      SELECT
        id::text AS id,
        staff_id::text AS staff_id,
        jornada_id::text AS jornada_id,
        TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha,
        TO_CHAR(hora_entrada, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS hora_entrada,
        TO_CHAR(hora_salida, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS hora_salida,
        minutos_tarde,
        minutos_salida_anticipada,
        minutos_balance,
        TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
        TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
      FROM public.staff_registros_asistencia
      WHERE staff_id = ${staffId}::uuid
        AND fecha = ${fecha}::date
        AND jornada_id = ${jornadaId}::uuid
      LIMIT 1
    `,
  );

  return mapAttendanceRows(rows)[0] ?? null;
};

const syncStaffBalanceMovementTx = async (
  tx: Pick<typeof prisma, "$executeRaw" | "$queryRaw">,
  staffId: string,
  horasDelta: number,
  motivo: string,
  creadoPorStaffId: string | null,
) => {
  await tx.$executeRaw`
    INSERT INTO public.staff_balance_movimientos (
      staff_id,
      horas_delta,
      motivo,
      creado_por_staff_id
    )
    VALUES (
      ${staffId}::uuid,
      ${horasDelta},
      ${motivo},
      ${creadoPorStaffId ?? null}::uuid
    )
  `;

  const rows = await tx.$queryRaw<Array<{ balance_horas: number | null }>>`
    SELECT COALESCE(SUM(m.horas_delta), 0)::float8 AS balance_horas
    FROM public.staff_balance_movimientos m
    WHERE m.staff_id = ${staffId}::uuid
  `;

  const resolvedBalance = rows[0]?.balance_horas ?? 0;

  await tx.$executeRaw`
    UPDATE public.staff
    SET balance_horas = ${resolvedBalance}
    WHERE id = ${staffId}::uuid
  `;

  return resolvedBalance;
};

const buildPreview = async (staff: StaffRecord, today: BogotaNow): Promise<AttendancePreview> => {
  const horario = await getStaffHorarioLaboral(staff.id);
  const jornadasDelDia = horario.jornadaSemanal.filter((jornada) => normalizeText(jornada.diaSemana) === normalizeText(today.weekday));
  const registrosHoy = await getAttendanceRowsForDate(staff.id, today.dateKey);
  const registroAbierto = registrosHoy.find((registro) => registro.horaEntrada && !registro.horaSalida) ?? null;
  const jornadaActiva = registroAbierto
    ? jornadasDelDia.find((jornada) => jornada.id === registroAbierto.jornadaId) ?? null
    : findActiveJornada(jornadasDelDia, today.minutes);

  const minutosTardeHoy = registrosHoy.reduce((total, registro) => total + registro.minutosTarde, 0);
  const minutosSalidaAnticipadaHoy = registrosHoy.reduce((total, registro) => total + registro.minutosSalidaAnticipada, 0);
  const minutosBalanceHoy = registrosHoy.reduce((total, registro) => total + registro.minutosBalance, 0);

  let mensaje = "No hay una jornada activa para registrar.";
  let puedeRegistrarEntrada = false;
  let puedeRegistrarSalida = Boolean(registroAbierto);

  if (jornadasDelDia.length === 0) {
    mensaje = "No existe jornada laboral configurada para este día.";
  } else if (registroAbierto && jornadaActiva) {
    mensaje = "La entrada ya está registrada. Puedes completar la salida cuando corresponda.";
    puedeRegistrarEntrada = false;
    puedeRegistrarSalida = true;
  } else if (jornadaActiva) {
    const jornadaInicio = toMinutes(jornadaActiva.horaEntrada);
    const jornadaFin = toMinutes(jornadaActiva.horaSalida);
    puedeRegistrarEntrada = today.minutes >= jornadaInicio - 5 && today.minutes <= jornadaFin;
    puedeRegistrarSalida = false;

    if (today.minutes < jornadaInicio - 5) {
      mensaje = `La entrada solo se habilita desde 5 minutos antes de las ${jornadaActiva.horaEntrada}.`;
    } else if (today.minutes > jornadaFin) {
      mensaje = `La jornada de ${jornadaActiva.horaEntrada} a ${jornadaActiva.horaSalida} ya terminó.`;
    } else if (today.minutes >= jornadaInicio) {
      mensaje = `La entrada está disponible. Si registras ahora, se calculará la tardanza con la hora actual.`;
    } else {
      mensaje = `Ya puedes registrar la entrada para la jornada de ${jornadaActiva.horaEntrada} a ${jornadaActiva.horaSalida}.`;
    }
  }

  return {
    staff,
    fecha: today.dateKey,
    diaSemana: today.weekday,
    horaActual: today.timeKey,
    jornadasDelDia: jornadasDelDia.map(mapJornada),
    jornadaActiva: jornadaActiva ? mapJornada(jornadaActiva) : null,
    registrosHoy,
    registroAbierto,
    minutosTardeHoy,
    minutosSalidaAnticipadaHoy,
    minutosBalanceHoy,
    puedeRegistrarEntrada,
    puedeRegistrarSalida,
    mensaje,
  };
};

export const getAttendancePreviewByCedula = async (cedula: string) => {
  await ensureAttendanceSchemaReady();

  const staff = await getStaffByCedula(cedula);
  if (!staff) {
    throw new AttendanceError("No se encontró un colaborador con esa cédula.", 404);
  }

  const today = getBogotaNow();
  return buildPreview(staff, today);
};

export const registerAttendanceEntryByCedula = async (cedula: string, creadoPorStaffId: string) => {
  await ensureAttendanceSchemaReady();

  const staff = await getStaffByCedula(cedula);
  if (!staff) {
    throw new AttendanceError("No se encontró un colaborador con esa cédula.", 404);
  }

  const today = getBogotaNow();
  const horario = await getStaffHorarioLaboral(staff.id);
  const jornadasDelDia = horario.jornadaSemanal.filter((jornada) => normalizeText(jornada.diaSemana) === normalizeText(today.weekday));
  const jornadaActiva = findActiveJornada(jornadasDelDia, today.minutes);

  if (!jornadaActiva) {
    throw new AttendanceError("No hay una jornada laboral vigente para registrar entrada hoy.", 400);
  }

  const jornadaInicio = toMinutes(jornadaActiva.horaEntrada);
  if (today.minutes < jornadaInicio - 5) {
    throw new AttendanceError(`La entrada solo está habilitada desde 5 minutos antes de las ${jornadaActiva.horaEntrada}.`, 400);
  }

  const minutesLate = Math.max(0, today.minutes - jornadaInicio);
  const existing = await getAttendanceRowByJornada(staff.id, today.dateKey, jornadaActiva.id);
  const creatorStaffId = asUuidOrNull(creadoPorStaffId) ?? asUuidOrNull(staff.id);

  if (existing?.horaEntrada && !existing.horaSalida) {
    throw new AttendanceError("Ya existe una entrada activa para esta jornada.", 409);
  }

  if (existing?.horaEntrada && existing.horaSalida) {
    throw new AttendanceError("Esta jornada ya fue registrada y cerrada.", 409);
  }

  const createdAt = toIsoTimestamp(new Date());

  const inserted = await prisma.$transaction(async (tx) => {
    const insertedRows = await tx.$queryRaw<AttendanceRawRow[]>`
      INSERT INTO public.staff_registros_asistencia (
        staff_id,
        jornada_id,
        fecha,
        hora_entrada,
        minutos_tarde,
        minutos_salida_anticipada,
        minutos_balance,
        created_at,
        updated_at
      )
      VALUES (
        ${staff.id}::uuid,
        ${jornadaActiva.id}::uuid,
        ${today.dateKey}::date,
        ${createdAt}::timestamptz,
        ${minutesLate},
        0,
        ${minutesLate},
        now(),
        now()
      )
      RETURNING
        id::text AS id,
        staff_id::text AS staff_id,
        jornada_id::text AS jornada_id,
        TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha,
        TO_CHAR(hora_entrada, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS hora_entrada,
        TO_CHAR(hora_salida, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS hora_salida,
        minutos_tarde,
        minutos_salida_anticipada,
        minutos_balance,
        TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
        TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
    `;

    if (minutesLate > 0) {
      await syncStaffBalanceMovementTx(
        tx,
        staff.id,
        -(minutesLate / 60),
        `Tardanza de ${minutesLate} minuto(s) en registro de entrada (${today.dateKey}).`,
        creatorStaffId,
      );
    }

    return mapAttendanceRows(insertedRows)[0] ?? null;
  });

  if (!inserted) {
    throw new AttendanceError("No se pudo guardar el registro de entrada.", 500);
  }

  return {
    preview: await buildPreview(staff, today),
    registro: inserted,
    mensaje:
      minutesLate > 0
        ? `Entrada registrada con ${minutesLate} minuto(s) de tardanza.`
        : "Entrada registrada a tiempo.",
    alerta: minutesLate > 0 ? `Llego tarde por ${minutesLate} minuto(s).` : null,
  };
};

export const registerAttendanceExitByCedula = async (cedula: string, creadoPorStaffId: string) => {
  await ensureAttendanceSchemaReady();

  const staff = await getStaffByCedula(cedula);
  if (!staff) {
    throw new AttendanceError("No se encontró un colaborador con esa cédula.", 404);
  }

  const today = getBogotaNow();
  const horario = await getStaffHorarioLaboral(staff.id);
  const jornadasDelDia = horario.jornadaSemanal.filter((jornada) => normalizeText(jornada.diaSemana) === normalizeText(today.weekday));
  const registrosHoy = await getAttendanceRowsForDate(staff.id, today.dateKey);
  const registroAbierto = registrosHoy.find((registro) => registro.horaEntrada && !registro.horaSalida) ?? null;

  if (!registroAbierto) {
    throw new AttendanceError("No existe una entrada activa para registrar salida.", 409);
  }

  const jornadaActiva = jornadasDelDia.find((jornada) => jornada.id === registroAbierto.jornadaId) ?? null;
  if (!jornadaActiva) {
    throw new AttendanceError("No se encontró la jornada asociada al registro abierto.", 404);
  }

  const jornadaFin = toMinutes(jornadaActiva.horaSalida);
  const minutesEarly = Math.max(0, jornadaFin - today.minutes);
  const updatedAt = toIsoTimestamp(new Date());
  const creatorStaffId = asUuidOrNull(creadoPorStaffId) ?? asUuidOrNull(staff.id);

  const updated = await prisma.$transaction(async (tx) => {
    const updatedRows = await tx.$queryRaw<AttendanceRawRow[]>`
      UPDATE public.staff_registros_asistencia
      SET
        hora_salida = ${updatedAt}::timestamptz,
        minutos_salida_anticipada = ${minutesEarly},
        minutos_balance = ${registroAbierto.minutosTarde + minutesEarly},
        updated_at = now()
      WHERE id = ${registroAbierto.id}::uuid
      RETURNING
        id::text AS id,
        staff_id::text AS staff_id,
        jornada_id::text AS jornada_id,
        TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha,
        TO_CHAR(hora_entrada, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS hora_entrada,
        TO_CHAR(hora_salida, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS hora_salida,
        minutos_tarde,
        minutos_salida_anticipada,
        minutos_balance,
        TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
        TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
    `;

    if (minutesEarly > 0) {
      await syncStaffBalanceMovementTx(
        tx,
        staff.id,
        -(minutesEarly / 60),
        `Salida anticipada de ${minutesEarly} minuto(s) en registro de salida (${today.dateKey}).`,
        creatorStaffId,
      );
    }

    return mapAttendanceRows(updatedRows)[0] ?? null;
  });

  if (!updated) {
    throw new AttendanceError("No se pudo completar el registro de salida.", 500);
  }

  return {
    preview: await buildPreview(staff, today),
    registro: updated,
    mensaje:
      minutesEarly > 0
        ? `Salida registrada con ${minutesEarly} minuto(s) antes de terminar la jornada.`
        : "Salida registrada correctamente.",
    alerta: minutesEarly > 0 ? `Salida antes de la hora programada por ${minutesEarly} minuto(s).` : null,
  };
};

export const getAttendanceDashboard = async (): Promise<AttendanceDashboard> => {
  await ensureAttendanceSchemaReady();

  const today = getBogotaNow();
  const staffList = await listStaff();

  const currentWorkingCandidates = await Promise.all(
    staffList
      .filter((staff) => staff.estado === "Active")
      .map(async (staff) => {
        const horario = await getStaffHorarioLaboral(staff.id);
        const jornadasDelDia = horario.jornadaSemanal.filter((jornada) => normalizeText(jornada.diaSemana) === normalizeText(today.weekday));
        const jornadaActiva = findActiveJornada(jornadasDelDia, today.minutes);

        if (!jornadaActiva) {
          return null;
        }

        if (isInActivePause(horario.pausasProgramadas, today.minutes, today.weekday)) {
          return null;
        }

        const recordsToday = await getCurrentAttendanceEntry(staff.id, today.dateKey);
        const registroAbierto = recordsToday.find((registro) => registro.horaEntrada && !registro.horaSalida) ?? null;

        return {
          id: staff.id,
          staffId: staff.id,
          nombreCompleto: `${staff.nombres} ${staff.apellidos}`.trim(),
          rol: staff.rol,
          horaEntrada: jornadaActiva.horaEntrada,
          horaSalida: jornadaActiva.horaSalida,
          estadoRegistro: registroAbierto ? ("registrado" as const) : ("no registrado" as const),
        };
      })
  );

  const usuariosActivosAhora = currentWorkingCandidates.filter((entry): entry is ExpectedStaffEntry => entry !== null);
  const usuariosRegistradosAhora = usuariosActivosAhora.filter((entry) => entry.estadoRegistro === "registrado");
  const usuariosNoRegistradosAhora = usuariosActivosAhora.filter((entry) => entry.estadoRegistro === "no registrado");

  const movementRows = await runAttendanceQueryWithRecovery(() =>
    prisma.$queryRaw<AttendanceMovementRawRow[]>`
      SELECT
        movement.id,
        movement.staff_id,
        movement.nombres,
        movement.apellidos,
        movement.actividad,
        movement.estado,
        movement.fecha,
        movement.hora
      FROM (
        SELECT
          CONCAT(r.id::text, '-entrada') AS id,
          s.id::text AS staff_id,
          s.nombres,
          s.apellidos,
          'Entrada'::text AS actividad,
          CASE
            WHEN r.minutos_tarde > 0 THEN CONCAT('Tarde (', r.minutos_tarde::text, ' min)')
            ELSE 'A tiempo'
          END AS estado,
          TO_CHAR((r.hora_entrada AT TIME ZONE ${COLOMBIA_TIMEZONE}), 'YYYY-MM-DD') AS fecha,
          TO_CHAR((r.hora_entrada AT TIME ZONE ${COLOMBIA_TIMEZONE}), 'HH24:MI:SS') AS hora,
          r.hora_entrada AS momento
        FROM public.staff_registros_asistencia r
        INNER JOIN public.staff s ON s.id = r.staff_id
        WHERE r.hora_entrada IS NOT NULL

        UNION ALL

        SELECT
          CONCAT(r.id::text, '-salida') AS id,
          s.id::text AS staff_id,
          s.nombres,
          s.apellidos,
          'Salida'::text AS actividad,
          CASE
            WHEN r.minutos_salida_anticipada > 0 THEN CONCAT('Salida anticipada (', r.minutos_salida_anticipada::text, ' min)')
            ELSE 'Completado'
          END AS estado,
          TO_CHAR((r.hora_salida AT TIME ZONE ${COLOMBIA_TIMEZONE}), 'YYYY-MM-DD') AS fecha,
          TO_CHAR((r.hora_salida AT TIME ZONE ${COLOMBIA_TIMEZONE}), 'HH24:MI:SS') AS hora,
          r.hora_salida AS momento
        FROM public.staff_registros_asistencia r
        INNER JOIN public.staff s ON s.id = r.staff_id
        WHERE r.hora_salida IS NOT NULL
      ) AS movement
      ORDER BY movement.momento DESC
      LIMIT 30
    `,
  );

  const activeRows = await runAttendanceQueryWithRecovery(() =>
    prisma.$queryRaw<ActiveStaffRawRow[]>`
      SELECT
        r.id::text AS id,
        s.id::text AS staff_id,
        s.nombres,
        s.apellidos,
        sr.nombre AS rol,
        TO_CHAR((r.hora_entrada AT TIME ZONE ${COLOMBIA_TIMEZONE}), 'HH24:MI:SS') AS hora_entrada
      FROM public.staff_registros_asistencia r
      INNER JOIN public.staff s ON s.id = r.staff_id
      LEFT JOIN public.staff_roles sr ON sr.id = s.role_id
      WHERE r.fecha = ${today.dateKey}::date
        AND r.hora_entrada IS NOT NULL
        AND r.hora_salida IS NULL
      ORDER BY r.hora_entrada DESC
    `,
  );

  return {
    fecha: today.dateKey,
    horaActual: today.timeKey,
    movimientosRecientes: movementRows.map((row) => ({
      id: row.id,
      staffId: row.staff_id,
      nombreCompleto: `${row.nombres} ${row.apellidos}`.trim(),
      actividad: row.actividad,
      estado: row.estado,
      fecha: row.fecha,
      hora: row.hora,
    })),
    usuariosActivos: activeRows.map((row) => ({
      id: row.id,
      staffId: row.staff_id,
      nombreCompleto: `${row.nombres} ${row.apellidos}`.trim(),
      rol: row.rol || "Colaborador",
      horaEntrada: row.hora_entrada,
    })),
    totalPresentes: activeRows.length,
    usuariosActivosAhora,
    usuariosRegistradosAhora,
    usuariosNoRegistradosAhora,
    totalActivosAhora: usuariosActivosAhora.length,
    totalRegistradosAhora: usuariosRegistradosAhora.length,
    totalNoRegistradosAhora: usuariosNoRegistradosAhora.length,
  };
};