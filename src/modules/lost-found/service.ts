import { prisma } from "../../lib/prisma";

export type LostFoundStatus = "dueno_no_encontrado" | "dado_de_baja" | "objeto_devuelto";

export type LostFoundItem = {
  id: string;
  objeto: string;
  lugar: string;
  quienLoTrajo: string;
  fechaHallazgo: string;
  estado: LostFoundStatus;
  icono: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateLostFoundItemInput = {
  objeto: string;
  lugar: string;
  quienLoTrajo: string;
};

let ensureLostFoundSchemaPromise: Promise<void> | null = null;

const inferLostFoundIcon = (text: string): string => {
  const normalized = text.toLowerCase();

  if (normalized.includes("portatil") || normalized.includes("laptop") || normalized.includes("computador")) return "laptop_mac";
  if (normalized.includes("celular") || normalized.includes("telefono") || normalized.includes("smartphone") || normalized.includes("iphone")) return "smartphone";
  if (normalized.includes("carnet") || normalized.includes("id") || normalized.includes("documento")) return "badge";
  if (normalized.includes("llave") || normalized.includes("llavero")) return "key";
  if (normalized.includes("billetera") || normalized.includes("cartera")) return "account_balance_wallet";
  if (normalized.includes("gafa") || normalized.includes("lente")) return "visibility";
  if (normalized.includes("audifono") || normalized.includes("auricular")) return "headphones";
  if (normalized.includes("mochila") || normalized.includes("bolso") || normalized.includes("maleta")) return "backpack";
  if (normalized.includes("libro") || normalized.includes("cuaderno")) return "menu_book";
  if (normalized.includes("usb") || normalized.includes("memoria")) return "usb";

  return "inventory_2";
};

const mapLostFoundRow = (row: {
  id: string;
  objeto: string;
  lugar: string;
  quien_lo_trajo: string;
  fecha_hallazgo: string;
  estado: LostFoundStatus;
  icono: string;
  created_at: string;
  updated_at: string;
}): LostFoundItem => ({
  id: row.id,
  objeto: row.objeto,
  lugar: row.lugar,
  quienLoTrajo: row.quien_lo_trajo,
  fechaHallazgo: row.fecha_hallazgo,
  estado: row.estado,
  icono: row.icono,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const ensureLostFoundSchemaReady = async () => {
  if (!ensureLostFoundSchemaPromise) {
    ensureLostFoundSchemaPromise = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS public.objetos_perdidos (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          objeto varchar(180) NOT NULL,
          lugar varchar(180) NOT NULL,
          quien_lo_trajo varchar(180) NOT NULL,
          fecha_hallazgo timestamptz NOT NULL DEFAULT now(),
          estado text NOT NULL DEFAULT 'dueno_no_encontrado',
          icono varchar(80) NOT NULL DEFAULT 'inventory_2',
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT objetos_perdidos_estado_chk CHECK (
            estado IN ('dueno_no_encontrado', 'dado_de_baja', 'objeto_devuelto')
          )
        );

        CREATE INDEX IF NOT EXISTS idx_objetos_perdidos_estado
          ON public.objetos_perdidos(estado);

        CREATE INDEX IF NOT EXISTS idx_objetos_perdidos_fecha_hallazgo
          ON public.objetos_perdidos(fecha_hallazgo DESC);
      `);
    })().catch((error) => {
      ensureLostFoundSchemaPromise = null;
      throw error;
    });
  }

  await ensureLostFoundSchemaPromise;
};

export const listLostFoundItems = async (filters?: {
  search?: string;
  status?: LostFoundStatus;
}) => {
  await ensureLostFoundSchemaReady();

  const searchValue = (filters?.search ?? "").trim();
  const statusValue = filters?.status ?? null;

  const rows = await prisma.$queryRaw<Array<{
    id: string;
    objeto: string;
    lugar: string;
    quien_lo_trajo: string;
    fecha_hallazgo: string;
    estado: LostFoundStatus;
    icono: string;
    created_at: string;
    updated_at: string;
  }>>`
    SELECT
      id::text,
      objeto,
      lugar,
      quien_lo_trajo,
      TO_CHAR(fecha_hallazgo AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fecha_hallazgo,
      estado,
      icono,
      TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
      TO_CHAR(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
    FROM public.objetos_perdidos
    WHERE
      (
        ${searchValue} = '' OR
        objeto ILIKE ${`%${searchValue}%`} OR
        lugar ILIKE ${`%${searchValue}%`} OR
        quien_lo_trajo ILIKE ${`%${searchValue}%`}
      )
      AND (
        ${statusValue}::text IS NULL OR estado = ${statusValue}::text
      )
    ORDER BY fecha_hallazgo DESC, created_at DESC
  `;

  return rows.map(mapLostFoundRow);
};

export const createLostFoundItem = async (input: CreateLostFoundItemInput) => {
  await ensureLostFoundSchemaReady();

  const objeto = input.objeto.trim();
  const lugar = input.lugar.trim();
  const quienLoTrajo = input.quienLoTrajo.trim();
  const icono = inferLostFoundIcon(`${objeto} ${lugar} ${quienLoTrajo}`);

  const rows = await prisma.$queryRaw<Array<{
    id: string;
    objeto: string;
    lugar: string;
    quien_lo_trajo: string;
    fecha_hallazgo: string;
    estado: LostFoundStatus;
    icono: string;
    created_at: string;
    updated_at: string;
  }>>`
    INSERT INTO public.objetos_perdidos (
      objeto,
      lugar,
      quien_lo_trajo,
      estado,
      icono,
      fecha_hallazgo,
      updated_at
    )
    VALUES (
      ${objeto},
      ${lugar},
      ${quienLoTrajo},
      'dueno_no_encontrado',
      ${icono},
      now(),
      now()
    )
    RETURNING
      id::text,
      objeto,
      lugar,
      quien_lo_trajo,
      TO_CHAR(fecha_hallazgo AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fecha_hallazgo,
      estado,
      icono,
      TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
      TO_CHAR(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
  `;

  const firstRow = rows[0];
  if (!firstRow) {
    throw new Error("No se pudo crear el objeto perdido");
  }

  return mapLostFoundRow(firstRow);
};

export const updateLostFoundItemStatus = async (id: string, status: LostFoundStatus) => {
  await ensureLostFoundSchemaReady();

  const rows = await prisma.$queryRaw<Array<{
    id: string;
    objeto: string;
    lugar: string;
    quien_lo_trajo: string;
    fecha_hallazgo: string;
    estado: LostFoundStatus;
    icono: string;
    created_at: string;
    updated_at: string;
  }>>`
    UPDATE public.objetos_perdidos
    SET estado = ${status}, updated_at = now()
    WHERE id = ${id}::uuid
    RETURNING
      id::text,
      objeto,
      lugar,
      quien_lo_trajo,
      TO_CHAR(fecha_hallazgo AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fecha_hallazgo,
      estado,
      icono,
      TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
      TO_CHAR(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at
  `;

  if (!rows[0]) {
    throw new Error("No se encontro el objeto perdido");
  }

  return mapLostFoundRow(rows[0]);
};

export const getLostFoundStats = async () => {
  await ensureLostFoundSchemaReady();

  const rows = await prisma.$queryRaw<Array<{
    total: number;
    duenio_no_encontrado: number;
    dado_de_baja: number;
    objeto_devuelto: number;
    nuevos_hoy: number;
  }>>`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE estado = 'dueno_no_encontrado')::int AS duenio_no_encontrado,
      COUNT(*) FILTER (WHERE estado = 'dado_de_baja')::int AS dado_de_baja,
      COUNT(*) FILTER (WHERE estado = 'objeto_devuelto')::int AS objeto_devuelto,
      COUNT(*) FILTER (WHERE fecha_hallazgo::date = (now() AT TIME ZONE 'America/Bogota')::date)::int AS nuevos_hoy
    FROM public.objetos_perdidos
  `;

  return rows[0] ?? {
    total: 0,
    duenio_no_encontrado: 0,
    dado_de_baja: 0,
    objeto_devuelto: 0,
    nuevos_hoy: 0,
  };
};
