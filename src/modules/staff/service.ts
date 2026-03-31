import { prisma } from "../../lib/prisma";

export type StaffEstado = "Active" | "Inactive";

export type StaffBloqueoClaseInput = {
  diaSemana: string;
  horaInicio: string;
  horaFin: string;
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
