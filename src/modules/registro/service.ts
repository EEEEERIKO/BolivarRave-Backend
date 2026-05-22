import { prisma } from "../../lib/prisma";
import { getStaffByCedula, getStaffHorarioLaboral, listStaffJornadaSemanal } from "../staff/service";

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

export class AttendanceError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AttendanceError";
    this.status = status;
  }
}

let ensureAttendanceSchemaPromise: Promise<void> | null = null;

const ensureAttendanceSchema = async () => {
  console.log("[registro-schema] Skipping dynamic schema creation (should use migrations)");
};

const ensureAttendanceSchemaReady = async () => {
  if (!ensureAttendanceSchemaPromise) {
    ensureAttendanceSchemaPromise = ensureAttendanceSchema().catch((error) => {
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

const getAttendanceRowsForDate = async (staffId: string, fecha: string) => {
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

const getAttendanceRowByJornada = async (staffId: string, fecha: string, jornadaId: string) => {
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
      AND jornada_id = ${jornadaId}::uuid
    LIMIT 1
  `;

  return mapAttendanceRows(rows)[0] ?? null;
};

const syncStaffBalanceMovementTx = async (
  tx: Pick<typeof prisma, "$executeRaw" | "$queryRaw">,
  staffId: string,
  horasDelta: number,
  motivo: string,
  creadoPorStaffId: string,
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
      ${creadoPorStaffId}::uuid
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

  if (existing?.horaEntrada && !existing.horaSalida) {
    throw new AttendanceError("Ya existe una entrada activa para esta jornada.", 409);
  }

  if (existing?.horaEntrada && existing.horaSalida) {
    throw new AttendanceError("Esta jornada ya fue registrada y cerrada.", 409);
  }

  const createdAt = toIsoTimestamp(new Date());

  const inserted = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
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
    `;

    if (minutesLate > 0) {
      await syncStaffBalanceMovementTx(
        tx,
        staff.id,
        -(minutesLate / 60),
        `Tardanza de ${minutesLate} minuto(s) en registro de entrada (${today.dateKey}).`,
        creadoPorStaffId,
      );
    }

    const records = await getAttendanceRowsForDate(staff.id, today.dateKey);
    return records.find((record) => record.jornadaId === jornadaActiva.id) ?? null;
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

  const updated = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE public.staff_registros_asistencia
      SET
        hora_salida = ${updatedAt}::timestamptz,
        minutos_salida_anticipada = ${minutesEarly},
        minutos_balance = ${registroAbierto.minutosTarde + minutesEarly},
        updated_at = now()
      WHERE id = ${registroAbierto.id}::uuid
    `;

    if (minutesEarly > 0) {
      await syncStaffBalanceMovementTx(
        tx,
        staff.id,
        -(minutesEarly / 60),
        `Salida anticipada de ${minutesEarly} minuto(s) en registro de salida (${today.dateKey}).`,
        creadoPorStaffId,
      );
    }

    const records = await getAttendanceRowsForDate(staff.id, today.dateKey);
    return records.find((record) => record.id === registroAbierto.id) ?? null;
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