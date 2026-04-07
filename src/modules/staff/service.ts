import { prisma } from "../../lib/prisma";

export type StaffEstado = "Active" | "Inactive";

export type StaffBloqueoClaseInput = {
  diaSemana: string;
  horaInicio: string;
  horaFin: string;
};

export type StaffJornadaInput = {
  diaSemana: string;
  horaEntrada: string;
  horaSalida: string;
  totalHorasDia: number;
};

export type StaffPausaInput = {
  diaSemana: string;
  tipoPausa: "Comida" | "Descanso";
  horaInicio: string;
  horaFin: string;
};

export type StaffResumenContratoInput = {
  horasSemanalesContrato: number;
  balanceHoras: number;
};

export type CreateStaffInput = {
  numeroStaff: number;
  roleId: number;
  rol: string;
  nombres: string;
  apellidos: string;
  cedula: string;
  telefono: string;
  fechaNacimiento: Date;
  carrera: string;
  tipoContrato: string;
  conocimientoSonido: boolean;
  estado: StaffEstado;
  balanceHoras: number;
  bloqueosClase: StaffBloqueoClaseInput[];
};

export type UpdateStaffInput = CreateStaffInput & {
  id: string;
};

type StaffRawRow = {
  id: string;
  numero_staff: number;
  role_id: number;
  rol: string;
  nombres: string;
  apellidos: string;
  cedula: string;
  telefono: string;
  fecha_nacimiento: string;
  carrera: string;
  tipo_contrato: string;
  conocimiento_sonido: boolean;
  estado: StaffEstado;
  balance_horas: number;
  fecha_creacion: string;
  bloqueo_id: string | null;
  bloqueo_dia_semana: string | null;
  bloqueo_hora_inicio: string | null;
  bloqueo_hora_fin: string | null;
};

type StaffJornadaRawRow = {
  id: string;
  staff_id: string;
  dia_semana: string;
  hora_entrada: string;
  hora_salida: string;
  total_horas_dia: number;
};

type StaffPausaRawRow = {
  id: string;
  staff_id: string;
  dia_semana: string;
  tipo_pausa: "Comida" | "Descanso";
  hora_inicio: string;
  hora_fin: string;
};

type StaffResumenContratoRawRow = {
  staff_id: string;
  horas_semanales_contrato: number;
  balance_horas: number;
};

type SqlExecutor = Pick<typeof prisma, "$executeRaw">;

const ensureStaffHorarioLaboralSchema = async (executor: SqlExecutor) => {
  await executor.$executeRaw`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'staff_tipo_pausa_enum'
          AND n.nspname = 'public'
      ) THEN
        CREATE TYPE public.staff_tipo_pausa_enum AS ENUM ('Comida', 'Descanso');
      END IF;
    END $$;
  `;

  await executor.$executeRaw`
    CREATE TABLE IF NOT EXISTS public.staff_jornada_semanal (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
      dia_semana public.dia_semana_enum NOT NULL,
      hora_entrada time NOT NULL,
      hora_salida time NOT NULL,
      total_horas_dia numeric(5,2) NOT NULL,
      CONSTRAINT staff_jornada_rango_hora_chk CHECK (hora_salida > hora_entrada),
      CONSTRAINT staff_jornada_horas_positivas_chk CHECK (total_horas_dia >= 0)
    )
  `;

  await executor.$executeRaw`
    ALTER TABLE public.staff_pausas_programadas
    DROP CONSTRAINT IF EXISTS staff_pausas_jornada_fk
  `;

  await executor.$executeRaw`
    ALTER TABLE public.staff_jornada_semanal
    DROP CONSTRAINT IF EXISTS staff_jornada_staff_dia_uq
  `;

  await executor.$executeRaw`
    CREATE TABLE IF NOT EXISTS public.staff_pausas_programadas (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      staff_id uuid NOT NULL,
      tipo_pausa public.staff_tipo_pausa_enum NOT NULL,
      dia_semana public.dia_semana_enum NOT NULL,
      hora_inicio time NOT NULL,
      hora_fin time NOT NULL,
      CONSTRAINT staff_pausas_rango_hora_chk CHECK (hora_fin > hora_inicio),
      CONSTRAINT staff_pausas_jornada_fk
        FOREIGN KEY (staff_id, dia_semana)
        REFERENCES public.staff_jornada_semanal(staff_id, dia_semana)
        ON DELETE CASCADE
    )
  `;

  await executor.$executeRaw`
    CREATE TABLE IF NOT EXISTS public.staff_resumen_contrato (
      staff_id uuid PRIMARY KEY REFERENCES public.staff(id) ON DELETE CASCADE,
      horas_semanales_contrato integer NOT NULL,
      balance_horas numeric(8,2) NOT NULL DEFAULT 0,
      CONSTRAINT staff_resumen_horas_semanales_chk CHECK (horas_semanales_contrato > 0)
    )
  `;

  await executor.$executeRaw`
    CREATE INDEX IF NOT EXISTS idx_staff_jornada_staff_id
    ON public.staff_jornada_semanal(staff_id)
  `;

  await executor.$executeRaw`
    CREATE INDEX IF NOT EXISTS idx_staff_jornada_dia
    ON public.staff_jornada_semanal(dia_semana)
  `;

  await executor.$executeRaw`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_jornada_staff_day_time_uq
    ON public.staff_jornada_semanal(staff_id, dia_semana, hora_entrada, hora_salida)
  `;

  await executor.$executeRaw`
    CREATE INDEX IF NOT EXISTS idx_staff_pausas_staff_id
    ON public.staff_pausas_programadas(staff_id)
  `;

  await executor.$executeRaw`
    CREATE INDEX IF NOT EXISTS idx_staff_pausas_dia
    ON public.staff_pausas_programadas(dia_semana)
  `;

  await executor.$executeRaw`
    CREATE INDEX IF NOT EXISTS idx_staff_pausas_tipo
    ON public.staff_pausas_programadas(tipo_pausa)
  `;
};

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);

const mapStaffRows = (rows: StaffRawRow[]) => {
  const byId = new Map<
    string,
    {
      id: string;
      numeroStaff: number;
      roleId: number;
      rol: string;
      nombres: string;
      apellidos: string;
      cedula: string;
      telefono: string;
      fechaNacimiento: string;
      carrera: string;
      tipoContrato: string;
      conocimientoSonido: boolean;
      estado: StaffEstado;
      balanceHoras: number;
      fechaCreacion: string;
      bloqueosClase: Array<{
        id: string;
        diaSemana: string;
        horaInicio: string;
        horaFin: string;
      }>;
    }
  >();

  for (const row of rows) {
    const current = byId.get(row.id);

    if (!current) {
      byId.set(row.id, {
        id: row.id,
        numeroStaff: row.numero_staff,
        roleId: row.role_id,
        rol: row.rol,
        nombres: row.nombres,
        apellidos: row.apellidos,
        cedula: row.cedula,
        telefono: row.telefono,
        fechaNacimiento: row.fecha_nacimiento,
        carrera: row.carrera,
        tipoContrato: row.tipo_contrato,
        conocimientoSonido: row.conocimiento_sonido,
        estado: row.estado,
        balanceHoras: row.balance_horas,
        fechaCreacion: row.fecha_creacion,
        bloqueosClase:
          row.bloqueo_id && row.bloqueo_dia_semana && row.bloqueo_hora_inicio && row.bloqueo_hora_fin
            ? [
                {
                  id: row.bloqueo_id,
                  diaSemana: row.bloqueo_dia_semana,
                  horaInicio: row.bloqueo_hora_inicio,
                  horaFin: row.bloqueo_hora_fin,
                },
              ]
            : [],
      });
      continue;
    }

    if (row.bloqueo_id && row.bloqueo_dia_semana && row.bloqueo_hora_inicio && row.bloqueo_hora_fin) {
      current.bloqueosClase.push({
        id: row.bloqueo_id,
        diaSemana: row.bloqueo_dia_semana,
        horaInicio: row.bloqueo_hora_inicio,
        horaFin: row.bloqueo_hora_fin,
      });
    }
  }

  return Array.from(byId.values());
};

export const listStaff = async () => {
  const rows = await prisma.$queryRaw<StaffRawRow[]>`
    SELECT
      s.id::text AS id,
      s.numero_staff,
      s.role_id,
      s.rol,
      s.nombres,
      s.apellidos,
      s.cedula,
      s.telefono,
      TO_CHAR(s.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
      s.carrera,
      s.tipo_contrato,
      s.conocimiento_sonido,
      s.estado,
      s.balance_horas,
      TO_CHAR(s.fecha_creacion, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fecha_creacion,
      b.id::text AS bloqueo_id,
      b.dia_semana AS bloqueo_dia_semana,
      CASE
        WHEN b.hora_inicio IS NULL THEN NULL
        ELSE TO_CHAR(b.hora_inicio, 'HH24:MI')
      END AS bloqueo_hora_inicio,
      CASE
        WHEN b.hora_fin IS NULL THEN NULL
        ELSE TO_CHAR(b.hora_fin, 'HH24:MI')
      END AS bloqueo_hora_fin
    FROM public.staff s
    LEFT JOIN public.staff_bloqueos_clase b ON b.staff_id = s.id
    ORDER BY s.fecha_creacion DESC, b.dia_semana ASC NULLS LAST, b.hora_inicio ASC NULLS LAST
  `;

  return mapStaffRows(rows);
};

export const getStaffById = async (id: string) => {
  const rows = await prisma.$queryRaw<StaffRawRow[]>`
    SELECT
      s.id::text AS id,
      s.numero_staff,
      s.role_id,
      s.rol,
      s.nombres,
      s.apellidos,
      s.cedula,
      s.telefono,
      TO_CHAR(s.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
      s.carrera,
      s.tipo_contrato,
      s.conocimiento_sonido,
      s.estado,
      s.balance_horas,
      TO_CHAR(s.fecha_creacion, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fecha_creacion,
      b.id::text AS bloqueo_id,
      b.dia_semana AS bloqueo_dia_semana,
      CASE
        WHEN b.hora_inicio IS NULL THEN NULL
        ELSE TO_CHAR(b.hora_inicio, 'HH24:MI')
      END AS bloqueo_hora_inicio,
      CASE
        WHEN b.hora_fin IS NULL THEN NULL
        ELSE TO_CHAR(b.hora_fin, 'HH24:MI')
      END AS bloqueo_hora_fin
    FROM public.staff s
    LEFT JOIN public.staff_bloqueos_clase b ON b.staff_id = s.id
    WHERE s.id = ${id}::uuid
    ORDER BY b.dia_semana ASC NULLS LAST, b.hora_inicio ASC NULLS LAST
  `;

  const mapped = mapStaffRows(rows);
  return mapped[0] ?? null;
};

export const createStaff = async (payload: CreateStaffInput) => {
  return prisma.$transaction(async (tx) => {
    const created = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.staff (
        numero_staff,
        role_id,
        rol,
        nombres,
        apellidos,
        cedula,
        telefono,
        fecha_nacimiento,
        carrera,
        tipo_contrato,
        conocimiento_sonido,
        estado,
        balance_horas
      )
      VALUES (
        ${payload.numeroStaff},
        ${payload.roleId},
        ${payload.rol},
        ${payload.nombres},
        ${payload.apellidos},
        ${payload.cedula},
        ${payload.telefono},
        ${toIsoDate(payload.fechaNacimiento)}::date,
        ${payload.carrera},
        ${payload.tipoContrato},
        ${payload.conocimientoSonido},
        ${payload.estado}::public.staff_estado_enum,
        ${payload.balanceHoras}
      )
      RETURNING id::text AS id
    `;

    const staffId = created[0]?.id;
    if (!staffId) {
      throw new Error("No se pudo crear el staff");
    }

    for (const bloqueo of payload.bloqueosClase) {
      await tx.$executeRaw`
        INSERT INTO public.staff_bloqueos_clase (
          staff_id,
          dia_semana,
          hora_inicio,
          hora_fin
        )
        VALUES (
          ${staffId}::uuid,
          ${bloqueo.diaSemana},
          ${bloqueo.horaInicio}::time,
          ${bloqueo.horaFin}::time
        )
      `;
    }

    return { staffId };
  });
};

export const updateStaff = async (payload: UpdateStaffInput) => {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE public.staff
      SET
        numero_staff = ${payload.numeroStaff},
        role_id = ${payload.roleId},
        rol = ${payload.rol},
        nombres = ${payload.nombres},
        apellidos = ${payload.apellidos},
        cedula = ${payload.cedula},
        telefono = ${payload.telefono},
        fecha_nacimiento = ${toIsoDate(payload.fechaNacimiento)}::date,
        carrera = ${payload.carrera},
        tipo_contrato = ${payload.tipoContrato},
        conocimiento_sonido = ${payload.conocimientoSonido},
        estado = ${payload.estado}::public.staff_estado_enum,
        balance_horas = ${payload.balanceHoras}
      WHERE id = ${payload.id}::uuid
      RETURNING id::text AS id
    `;

    if (!updated[0]?.id) {
      throw new Error("No se encontro el staff a modificar");
    }

    await tx.$executeRaw`
      DELETE FROM public.staff_bloqueos_clase
      WHERE staff_id = ${payload.id}::uuid
    `;

    for (const bloqueo of payload.bloqueosClase) {
      await tx.$executeRaw`
        INSERT INTO public.staff_bloqueos_clase (
          staff_id,
          dia_semana,
          hora_inicio,
          hora_fin
        )
        VALUES (
          ${payload.id}::uuid,
          ${bloqueo.diaSemana},
          ${bloqueo.horaInicio}::time,
          ${bloqueo.horaFin}::time
        )
      `;
    }

    return { staffId: payload.id };
  });
};

export const updateStaffEstado = async (id: string, estado: StaffEstado) => {
  const updated = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE public.staff
    SET estado = ${estado}::public.staff_estado_enum
    WHERE id = ${id}::uuid
    RETURNING id::text AS id
  `;

  if (!updated[0]?.id) {
    throw new Error("No se encontro el staff a modificar");
  }

  return { staffId: id };
};

export const deleteStaff = async (id: string) => {
  const deleted = await prisma.$queryRaw<Array<{ id: string }>>`
    DELETE FROM public.staff
    WHERE id = ${id}::uuid
    RETURNING id::text AS id
  `;

  if (!deleted[0]?.id) {
    throw new Error("No se encontro el staff a eliminar");
  }

  return { staffId: id };
};

const toMinutes = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
};

const validatePausaInsideJornada = (
  pausa: StaffPausaInput,
  jornadas: StaffJornadaRawRow[],
) => {
  const jornadaDelDia = jornadas.filter((item) => item.dia_semana === pausa.diaSemana);
  if (jornadaDelDia.length === 0) {
    throw new Error(`No existe jornada para ${pausa.diaSemana}`);
  }

  const pausaStart = toMinutes(pausa.horaInicio);
  const pausaEnd = toMinutes(pausa.horaFin);

  const fitsInSomeJornada = jornadaDelDia.some((jornada) => {
    const jornadaStart = toMinutes(jornada.hora_entrada);
    const jornadaEnd = toMinutes(jornada.hora_salida);
    return pausaStart >= jornadaStart && pausaEnd <= jornadaEnd;
  });

  if (!fitsInSomeJornada) {
    throw new Error(`La pausa de ${pausa.diaSemana} debe estar dentro de la jornada laboral`);
  }
};

const assertStaffExists = async (staffId: string) => {
  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id
    FROM public.staff
    WHERE id = ${staffId}::uuid
    LIMIT 1
  `;

  if (!existing[0]?.id) {
    throw new Error("No se encontro el staff solicitado");
  }
};

export const listStaffJornadaSemanal = async (staffId: string) => {
  await ensureStaffHorarioLaboralSchema(prisma);
  await assertStaffExists(staffId);

  const rows = await prisma.$queryRaw<StaffJornadaRawRow[]>`
    SELECT
      j.id::text AS id,
      j.staff_id::text AS staff_id,
      j.dia_semana::text AS dia_semana,
      TO_CHAR(j.hora_entrada, 'HH24:MI') AS hora_entrada,
      TO_CHAR(j.hora_salida, 'HH24:MI') AS hora_salida,
      j.total_horas_dia::float8 AS total_horas_dia
    FROM public.staff_jornada_semanal j
    WHERE j.staff_id = ${staffId}::uuid
    ORDER BY
      CASE j.dia_semana::text
        WHEN 'Lunes' THEN 1
        WHEN 'Martes' THEN 2
        WHEN 'Miercoles' THEN 3
        WHEN 'Jueves' THEN 4
        WHEN 'Viernes' THEN 5
        WHEN 'Sabado' THEN 6
        WHEN 'Domingo' THEN 7
        ELSE 99
      END ASC,
      j.hora_entrada ASC,
      j.id ASC
  `;

  return rows.map((row) => ({
    id: row.id,
    staffId: row.staff_id,
    diaSemana: row.dia_semana,
    horaEntrada: row.hora_entrada,
    horaSalida: row.hora_salida,
    totalHorasDia: row.total_horas_dia,
  }));
};

export const replaceStaffJornadaSemanal = async (staffId: string, jornadas: StaffJornadaInput[]) => {
  return prisma.$transaction(async (tx) => {
    await ensureStaffHorarioLaboralSchema(tx);

    const existing = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id
      FROM public.staff
      WHERE id = ${staffId}::uuid
      LIMIT 1
    `;

    if (!existing[0]?.id) {
      throw new Error("No se encontro el staff solicitado");
    }

    await tx.$executeRaw`
      DELETE FROM public.staff_jornada_semanal
      WHERE staff_id = ${staffId}::uuid
    `;

    for (const jornada of jornadas) {
      await tx.$executeRaw`
        INSERT INTO public.staff_jornada_semanal (
          staff_id,
          dia_semana,
          hora_entrada,
          hora_salida,
          total_horas_dia
        )
        VALUES (
          ${staffId}::uuid,
          ${jornada.diaSemana}::public.dia_semana_enum,
          ${jornada.horaEntrada}::time,
          ${jornada.horaSalida}::time,
          ${jornada.totalHorasDia}
        )
      `;
    }

    return { staffId };
  });
};

export const listStaffPausasProgramadas = async (staffId: string) => {
  await ensureStaffHorarioLaboralSchema(prisma);
  await assertStaffExists(staffId);

  const rows = await prisma.$queryRaw<StaffPausaRawRow[]>`
    SELECT
      p.id::text AS id,
      p.staff_id::text AS staff_id,
      p.dia_semana::text AS dia_semana,
      p.tipo_pausa::text AS tipo_pausa,
      TO_CHAR(p.hora_inicio, 'HH24:MI') AS hora_inicio,
      TO_CHAR(p.hora_fin, 'HH24:MI') AS hora_fin
    FROM public.staff_pausas_programadas p
    WHERE p.staff_id = ${staffId}::uuid
    ORDER BY p.dia_semana::text ASC, p.hora_inicio ASC
  `;

  return rows.map((row) => ({
    id: row.id,
    staffId: row.staff_id,
    diaSemana: row.dia_semana,
    tipoPausa: row.tipo_pausa,
    horaInicio: row.hora_inicio,
    horaFin: row.hora_fin,
  }));
};

export const createStaffPausaProgramada = async (staffId: string, payload: StaffPausaInput) => {
  return prisma.$transaction(async (tx) => {
    await ensureStaffHorarioLaboralSchema(tx);

    const existing = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id
      FROM public.staff
      WHERE id = ${staffId}::uuid
      LIMIT 1
    `;

    if (!existing[0]?.id) {
      throw new Error("No se encontro el staff solicitado");
    }

    const jornadas = await tx.$queryRaw<StaffJornadaRawRow[]>`
      SELECT
        id::text AS id,
        staff_id::text AS staff_id,
        dia_semana::text AS dia_semana,
        TO_CHAR(hora_entrada, 'HH24:MI') AS hora_entrada,
        TO_CHAR(hora_salida, 'HH24:MI') AS hora_salida,
        total_horas_dia::float8 AS total_horas_dia
      FROM public.staff_jornada_semanal
      WHERE staff_id = ${staffId}::uuid
    `;

    validatePausaInsideJornada(payload, jornadas);

    const created = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.staff_pausas_programadas (
        staff_id,
        tipo_pausa,
        dia_semana,
        hora_inicio,
        hora_fin
      )
      VALUES (
        ${staffId}::uuid,
        ${payload.tipoPausa}::public.staff_tipo_pausa_enum,
        ${payload.diaSemana}::public.dia_semana_enum,
        ${payload.horaInicio}::time,
        ${payload.horaFin}::time
      )
      RETURNING id::text AS id
    `;

    const id = created[0]?.id;
    if (!id) {
      throw new Error("No se pudo crear la pausa programada");
    }

    return { id };
  });
};

export const updateStaffPausaProgramada = async (staffId: string, pausaId: string, payload: StaffPausaInput) => {
  return prisma.$transaction(async (tx) => {
    await ensureStaffHorarioLaboralSchema(tx);

    const existing = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id
      FROM public.staff
      WHERE id = ${staffId}::uuid
      LIMIT 1
    `;

    if (!existing[0]?.id) {
      throw new Error("No se encontro el staff solicitado");
    }

    const jornadas = await tx.$queryRaw<StaffJornadaRawRow[]>`
      SELECT
        id::text AS id,
        staff_id::text AS staff_id,
        dia_semana::text AS dia_semana,
        TO_CHAR(hora_entrada, 'HH24:MI') AS hora_entrada,
        TO_CHAR(hora_salida, 'HH24:MI') AS hora_salida,
        total_horas_dia::float8 AS total_horas_dia
      FROM public.staff_jornada_semanal
      WHERE staff_id = ${staffId}::uuid
    `;

    validatePausaInsideJornada(payload, jornadas);

    const updated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE public.staff_pausas_programadas
      SET
        tipo_pausa = ${payload.tipoPausa}::public.staff_tipo_pausa_enum,
        dia_semana = ${payload.diaSemana}::public.dia_semana_enum,
        hora_inicio = ${payload.horaInicio}::time,
        hora_fin = ${payload.horaFin}::time
      WHERE id = ${pausaId}::uuid
        AND staff_id = ${staffId}::uuid
      RETURNING id::text AS id
    `;

    if (!updated[0]?.id) {
      throw new Error("No se encontro la pausa programada");
    }

    return { id: updated[0].id };
  });
};

export const deleteStaffPausaProgramada = async (staffId: string, pausaId: string) => {
  await ensureStaffHorarioLaboralSchema(prisma);

  const deleted = await prisma.$queryRaw<Array<{ id: string }>>`
    DELETE FROM public.staff_pausas_programadas
    WHERE id = ${pausaId}::uuid
      AND staff_id = ${staffId}::uuid
    RETURNING id::text AS id
  `;

  if (!deleted[0]?.id) {
    throw new Error("No se encontro la pausa programada");
  }

  return { id: deleted[0].id };
};

export const getStaffResumenContrato = async (staffId: string) => {
  await ensureStaffHorarioLaboralSchema(prisma);
  await assertStaffExists(staffId);

  const rows = await prisma.$queryRaw<StaffResumenContratoRawRow[]>`
    SELECT
      staff_id::text AS staff_id,
      horas_semanales_contrato,
      balance_horas::float8 AS balance_horas
    FROM public.staff_resumen_contrato
    WHERE staff_id = ${staffId}::uuid
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    staffId: row.staff_id,
    horasSemanalesContrato: row.horas_semanales_contrato,
    balanceHoras: row.balance_horas,
  };
};

export const upsertStaffResumenContrato = async (staffId: string, payload: StaffResumenContratoInput) => {
  await ensureStaffHorarioLaboralSchema(prisma);

  const updated = await prisma.$queryRaw<Array<{ staff_id: string }>>`
    INSERT INTO public.staff_resumen_contrato (
      staff_id,
      horas_semanales_contrato,
      balance_horas
    )
    VALUES (
      ${staffId}::uuid,
      ${payload.horasSemanalesContrato},
      ${payload.balanceHoras}
    )
    ON CONFLICT (staff_id)
    DO UPDATE SET
      horas_semanales_contrato = EXCLUDED.horas_semanales_contrato,
      balance_horas = EXCLUDED.balance_horas
    RETURNING staff_id::text AS staff_id
  `;

  if (!updated[0]?.staff_id) {
    throw new Error("No se pudo guardar el resumen de contrato");
  }

  return { staffId: updated[0].staff_id };
};

export const getStaffHorarioLaboral = async (staffId: string) => {
  const [jornada, pausas, resumen] = await Promise.all([
    listStaffJornadaSemanal(staffId),
    listStaffPausasProgramadas(staffId),
    getStaffResumenContrato(staffId),
  ]);

  return {
    staffId,
    jornadaSemanal: jornada,
    pausasProgramadas: pausas,
    resumenContrato: resumen,
  };
};
