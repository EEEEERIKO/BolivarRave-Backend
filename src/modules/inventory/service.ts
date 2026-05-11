import { prisma } from "../../lib/prisma";

export type InventoryItemStatus = "Disponible" | "Fijo";

const DEFAULT_GROUPS: Array<{ name: string; icon: string; order: number }> = [
  { name: "Televisores", icon: "tv", order: 0 },
  { name: "Cables HDMI", icon: "cable", order: 1 },
  { name: "Cables SVG", icon: "settings_ethernet", order: 2 },
  { name: "Cables de Poder", icon: "power", order: 3 },
  { name: "Altavoces", icon: "speaker", order: 4 },
  { name: "Microfonos", icon: "mic", order: 5 },
  { name: "Mesas de Sonido", icon: "graphic_eq", order: 6 },
  { name: "Adaptadores", icon: "settings_input_component", order: 7 },
  { name: "RTC", icon: "router", order: 8 },
];

const DEFAULT_ITEMS: Array<{
  groupName: string;
  name: string;
  code: string;
  room: string;
  status: InventoryItemStatus;
  defective: boolean;
  order: number;
}> = [
  { groupName: "Televisores", name: "Samsung 65 4K", code: "TV-001", room: "Piso 3 - Salon 302", status: "Disponible", defective: false, order: 0 },
  { groupName: "Televisores", name: "Sony Bravia 55", code: "TV-002", room: "Piso 2 - Salon 201", status: "Fijo", defective: true, order: 1 },
  { groupName: "Cables HDMI", name: "HDMI 2.1 15ft", code: "HDMI-001", room: "Bodega A", status: "Disponible", defective: false, order: 0 },
  { groupName: "Cables HDMI", name: "HDMI 2.0 10ft", code: "HDMI-002", room: "Bodega A", status: "Disponible", defective: false, order: 1 },
  { groupName: "Cables SVG", name: "Cable SVG 3m", code: "SVG-001", room: "Soporte TI", status: "Fijo", defective: true, order: 0 },
  { groupName: "Cables de Poder", name: "Cable Poder 1.5m", code: "PWR-001", room: "Piso 1 - Cuarto Eléctrico", status: "Disponible", defective: false, order: 0 },
  { groupName: "Altavoces", name: "JBL Ceiling A1", code: "SPK-001", room: "Auditorio", status: "Fijo", defective: true, order: 0 },
  { groupName: "Microfonos", name: "Shure SM58", code: "MIC-001", room: "Cabina Audio", status: "Disponible", defective: false, order: 0 },
  { groupName: "Mesas de Sonido", name: "Yamaha MG16", code: "MIX-001", room: "Cabina Audio", status: "Disponible", defective: false, order: 0 },
  { groupName: "Adaptadores", name: "HDMI a VGA", code: "ADP-001", room: "Soporte TI", status: "Fijo", defective: true, order: 0 },
  { groupName: "RTC", name: "RTC Router Core", code: "RTC-001", room: "NOC", status: "Disponible", defective: false, order: 0 },
];

let ensureInventorySchemaPromise: Promise<void> | null = null;

const ensureInventorySchema = async () => {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS public.inventory_groups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      nombre text NOT NULL UNIQUE,
      icono text NOT NULL DEFAULT 'inventory_2',
      orden integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS inventory_groups_orden_idx ON public.inventory_groups (orden)
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS public.inventory_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id uuid NOT NULL REFERENCES public.inventory_groups(id) ON DELETE CASCADE,
      nombre text NOT NULL,
      codigo text NOT NULL,
      salon text NOT NULL,
      estado text NOT NULL DEFAULT 'Disponible',
      defectuoso boolean NOT NULL DEFAULT false,
      precio numeric(12,2) NOT NULL DEFAULT 0,
      motivo text,
      orden integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT inventory_items_estado_chk CHECK (estado IN ('Disponible', 'Fijo')),
      CONSTRAINT inventory_items_group_code_unique UNIQUE (group_id, codigo)
    )
  `;

  await prisma.$executeRaw`
    ALTER TABLE public.inventory_items
    ADD COLUMN IF NOT EXISTS motivo text
  `;

  await prisma.$executeRaw`
    ALTER TABLE public.inventory_items
    ADD COLUMN IF NOT EXISTS precio numeric(12,2) NOT NULL DEFAULT 0
  `;

  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS inventory_items_group_id_idx ON public.inventory_items (group_id)
  `;

  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS inventory_items_estado_idx ON public.inventory_items (estado)
  `;

  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS inventory_items_defectuoso_idx ON public.inventory_items (defectuoso)
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS public.inventory_state (
      llave text PRIMARY KEY,
      valor text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
};

const seedInventoryDefaults = async () => {
  const seeded = await prisma.$queryRaw<Array<{ valor: string }>>`
    SELECT valor
    FROM public.inventory_state
    WHERE llave = 'defaults_seeded'
    LIMIT 1
  `;

  if (seeded[0]?.valor === "true") {
    return;
  }

  const existingGroups = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM public.inventory_groups
  `;

  if ((existingGroups[0]?.count ?? 0) > 0) {
    await prisma.$executeRaw`
      INSERT INTO public.inventory_state (llave, valor, updated_at)
      VALUES ('defaults_seeded', 'true', now())
      ON CONFLICT (llave) DO UPDATE SET
        valor = EXCLUDED.valor,
        updated_at = now()
    `;
    return;
  }

  await prisma.$transaction(async (tx) => {
    const groupsByName = new Map<string, string>();

    for (const group of DEFAULT_GROUPS) {
      const created = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO public.inventory_groups (nombre, icono, orden)
        VALUES (${group.name}, ${group.icon}, ${group.order})
        RETURNING id::text AS id
      `;

      const groupId = created[0]?.id;
      if (!groupId) {
        throw new Error(`No se pudo crear el grupo de inventario '${group.name}'`);
      }

      groupsByName.set(group.name, groupId);
    }

    for (const item of DEFAULT_ITEMS) {
      const groupId = groupsByName.get(item.groupName);
      if (!groupId) {
        throw new Error(`No se pudo resolver el grupo '${item.groupName}' para inventario`);
      }

      await tx.$executeRaw`
        INSERT INTO public.inventory_items (group_id, nombre, codigo, salon, estado, defectuoso, orden)
        VALUES (${groupId}::uuid, ${item.name}, ${item.code}, ${item.room}, ${item.status}, ${item.defective}, ${item.order})
      `;
    }

    await tx.$executeRaw`
      INSERT INTO public.inventory_state (llave, valor, updated_at)
      VALUES ('defaults_seeded', 'true', now())
      ON CONFLICT (llave) DO UPDATE SET
        valor = EXCLUDED.valor,
        updated_at = now()
    `;
  });
};

export const ensureInventorySchemaReady = async () => {
  if (!ensureInventorySchemaPromise) {
    ensureInventorySchemaPromise = (async () => {
      await ensureInventorySchema();
      await seedInventoryDefaults();
    })().catch((error) => {
      ensureInventorySchemaPromise = null;
      throw error;
    });
  }

  await ensureInventorySchemaPromise;
};

export type InventoryGroupRow = {
  id: string;
  name: string;
  icon: string;
  order: number;
  itemCount: number;
  defectiveCount: number;
  availableCount: number;
  fixedCount: number;
};

export type InventoryItemRow = {
  id: string;
  groupId: string;
  groupName: string;
  groupIcon: string;
  name: string;
  code: string;
  room: string;
  status: InventoryItemStatus;
  defective: boolean;
  motivo: string | null;
  price: number;
  order: number;
  createdAt: string;
  updatedAt: string;
};

export const listInventoryGroups = async () => {
  await ensureInventorySchemaReady();

  const rows = await prisma.$queryRaw<InventoryGroupRow[]>`
    SELECT
      g.id::text AS id,
      g.nombre AS name,
      g.icono AS icon,
      g.orden AS "order",
      COUNT(i.id)::int AS "itemCount",
      COALESCE(SUM(CASE WHEN i.defectuoso THEN 1 ELSE 0 END), 0)::int AS "defectiveCount",
      COALESCE(SUM(CASE WHEN i.estado = 'Disponible' THEN 1 ELSE 0 END), 0)::int AS "availableCount",
      COALESCE(SUM(CASE WHEN i.estado = 'Fijo' THEN 1 ELSE 0 END), 0)::int AS "fixedCount"
    FROM public.inventory_groups g
    LEFT JOIN public.inventory_items i ON i.group_id = g.id
    GROUP BY g.id
    ORDER BY g.orden ASC, g.nombre ASC
  `;

  return rows;
};

export const listInventoryItems = async (groupId?: string) => {
  await ensureInventorySchemaReady();

  if (groupId) {
    const rows = await prisma.$queryRaw<InventoryItemRow[]>`
      SELECT
        i.id::text AS id,
        i.group_id::text AS "groupId",
        g.nombre AS "groupName",
        g.icono AS "groupIcon",
        i.nombre AS name,
        i.codigo AS code,
        i.salon AS room,
        i.estado AS status,
        i.defectuoso AS defective,
        i.motivo AS motivo,
        COALESCE(i.precio, 0)::double precision AS price,
        i.orden AS "order",
        TO_CHAR(i.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
        TO_CHAR(i.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
      FROM public.inventory_items i
      INNER JOIN public.inventory_groups g ON g.id = i.group_id
      WHERE i.group_id = ${groupId}::uuid
      ORDER BY i.orden ASC, i.nombre ASC
    `;

    return rows;
  }

  const rows = await prisma.$queryRaw<InventoryItemRow[]>`
    SELECT
      i.id::text AS id,
      i.group_id::text AS "groupId",
      g.nombre AS "groupName",
      g.icono AS "groupIcon",
      i.nombre AS name,
      i.codigo AS code,
      i.salon AS room,
      i.estado AS status,
      i.defectuoso AS defective,
      i.motivo AS motivo,
         COALESCE(i.precio, 0)::double precision AS price,
      i.orden AS "order",
      TO_CHAR(i.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
      TO_CHAR(i.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
    FROM public.inventory_items i
    INNER JOIN public.inventory_groups g ON g.id = i.group_id
    ORDER BY i.orden ASC, i.nombre ASC
  `;

  return rows;
};

const getNextGroupOrder = async () => {
  const rows = await prisma.$queryRaw<Array<{ next_order: number }>>`
    SELECT COALESCE(MAX(orden), -1) + 1 AS next_order
    FROM public.inventory_groups
  `;
  return rows[0]?.next_order ?? 0;
};

const getNextItemOrder = async (groupId: string) => {
  const rows = await prisma.$queryRaw<Array<{ next_order: number }>>`
    SELECT COALESCE(MAX(orden), -1) + 1 AS next_order
    FROM public.inventory_items
    WHERE group_id = ${groupId}::uuid
  `;
  return rows[0]?.next_order ?? 0;
};

const assertGroupExists = async (groupId: string) => {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id
    FROM public.inventory_groups
    WHERE id = ${groupId}::uuid
    LIMIT 1
  `;

  if (!rows[0]?.id) {
    throw new Error("No se encontro el grupo de inventario");
  }
};

export const createInventoryGroup = async (payload: { name: string; icon?: string; order?: number }) => {
  await ensureInventorySchemaReady();

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO public.inventory_groups (nombre, icono, orden)
    VALUES (${payload.name}, ${payload.icon ?? "inventory_2"}, ${payload.order ?? (await getNextGroupOrder())})
    RETURNING id::text AS id
  `;

  const id = rows[0]?.id;
  if (!id) {
    throw new Error("No se pudo crear el grupo de inventario");
  }

  return { id };
};

export const updateInventoryGroup = async (groupId: string, payload: { name: string; icon?: string; order?: number }) => {
  await ensureInventorySchemaReady();

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE public.inventory_groups
    SET
      nombre = ${payload.name},
      icono = ${payload.icon ?? "inventory_2"},
      orden = COALESCE(${payload.order ?? null}, orden),
      updated_at = now()
    WHERE id = ${groupId}::uuid
    RETURNING id::text AS id
  `;

  if (!rows[0]?.id) {
    throw new Error("No se encontro el grupo de inventario");
  }

  return { id: rows[0].id };
};

const getInventoryItemById = async (itemId: string) => {
  const rows = await prisma.$queryRaw<InventoryItemRow[]>`
    SELECT
      i.id::text AS id,
      i.group_id::text AS "groupId",
      g.nombre AS "groupName",
      g.icono AS "groupIcon",
      i.nombre AS name,
      i.codigo AS code,
      i.salon AS room,
      i.estado AS status,
      i.defectuoso AS defective,
      i.motivo AS motivo,
         COALESCE(i.precio, 0)::double precision AS price,
      i.orden AS "order",
      TO_CHAR(i.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
      TO_CHAR(i.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
    FROM public.inventory_items i
    INNER JOIN public.inventory_groups g ON g.id = i.group_id
    WHERE i.id = ${itemId}::uuid
    LIMIT 1
  `;

  return rows[0] ?? null;
};

export const deleteInventoryGroup = async (groupId: string) => {
  await ensureInventorySchemaReady();

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    DELETE FROM public.inventory_groups
    WHERE id = ${groupId}::uuid
    RETURNING id::text AS id
  `;

  if (!rows[0]?.id) {
    throw new Error("No se encontro el grupo de inventario");
  }

  return { id: rows[0].id };
};

export const createInventoryItem = async (payload: {
  groupId: string;
  name: string;
  code: string;
  room: string;
  status: InventoryItemStatus;
  defective: boolean;
  motivo?: string | null;
  order?: number;
  price?: number;
}) => {
  await ensureInventorySchemaReady();
  await assertGroupExists(payload.groupId);

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO public.inventory_items (group_id, nombre, codigo, salon, estado, defectuoso, precio, motivo, orden)
    VALUES (
      ${payload.groupId}::uuid,
      ${payload.name},
      ${payload.code},
      ${payload.room},
      ${payload.status},
      ${payload.defective},
      ${payload.price ?? 0},
      ${payload.motivo ?? null},
      ${payload.order ?? (await getNextItemOrder(payload.groupId))}
    )
    RETURNING id::text AS id
  `;

  const id = rows[0]?.id;
  if (!id) {
    throw new Error("No se pudo crear el elemento de inventario");
  }

  return { id };
};

export const updateInventoryItem = async (itemId: string, payload: {
  groupId: string;
  name: string;
  code: string;
  room: string;
  status: InventoryItemStatus;
  defective: boolean;
  motivo?: string | null;
  order?: number;
  price?: number;
}) => {
  await ensureInventorySchemaReady();
  await assertGroupExists(payload.groupId);

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE public.inventory_items
    SET
      group_id = ${payload.groupId}::uuid,
      nombre = ${payload.name},
      codigo = ${payload.code},
      salon = ${payload.room},
      estado = ${payload.status},
      defectuoso = ${payload.defective},
      precio = COALESCE(${payload.price ?? null}, precio),
      motivo = ${payload.motivo ?? null},
      orden = COALESCE(${payload.order ?? null}, orden),
      updated_at = now()
    WHERE id = ${itemId}::uuid
    RETURNING id::text AS id
  `;

  if (!rows[0]?.id) {
    throw new Error("No se encontro el elemento de inventario");
  }

  const updated = await getInventoryItemById(rows[0].id);
  if (!updated) {
    throw new Error("No se encontro el elemento de inventario");
  }

  return updated;
};

export const markInventoryItemDefective = async (itemId: string, motivo: string) => {
  await ensureInventorySchemaReady();

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE public.inventory_items
    SET
      defectuoso = true,
      motivo = ${motivo},
      updated_at = now()
    WHERE id = ${itemId}::uuid
    RETURNING id::text AS id
  `;

  if (!rows[0]?.id) {
    throw new Error("No se encontro el elemento de inventario");
  }

  const updated = await getInventoryItemById(rows[0].id);
  if (!updated) {
    throw new Error("No se encontro el elemento de inventario");
  }

  return updated;
};

export const deleteInventoryItem = async (itemId: string) => {
  await ensureInventorySchemaReady();

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    DELETE FROM public.inventory_items
    WHERE id = ${itemId}::uuid
    RETURNING id::text AS id
  `;

  if (!rows[0]?.id) {
    throw new Error("No se encontro el elemento de inventario");
  }

  return { id: rows[0].id };
};