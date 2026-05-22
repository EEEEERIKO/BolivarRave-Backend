import { prisma } from "../../lib/prisma";
import { sendReservationConfirmationEmail, ReservationEmailData } from "./email";
import { randomBytes } from "crypto";

export type ReservationResourceType = "rooms" | "equipment" | "televisor";
export type ReservationStatus = "no_aceptado" | "confirmada" | "devuelto" | "rechazada" | "cancelada" | "reportado";

export type CreateReservationInput = {
  resourceType: ReservationResourceType;
  resourceId: string;
  bookingDate: Date;
  startTime: string;
  endTime: string;
  purpose: string;
  requesterName: string;
  requesterDocument: string;
  requesterEmail: string | null;
  requesterPhone: string | null;
  termsAccepted?: boolean;
  destinationRoomId: string | null;
  createdByStaffId: string;
};

type InventoryRoomSnapshot = {
  id: string;
  nombre: string;
  piso: number | null;
  capacidad: number | null;
};

type InventoryItemSnapshot = {
  id: string;
  nombre: string;
  codigo: string;
  salon: string;
  estado: string;
  grupo: string;
};

type TelevisionCandidate = {
  id: string;
  nombre: string;
  codigo: string;
  salon: string;
  roomTvCount: number;
};

type TelevisionSelection = {
  television: TelevisionCandidate;
  note: string | null;
  needsReturnReminder: boolean;
};

type RoomReservationConflict = {
  resourceId: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  status: string;
  resourceType: ReservationResourceType;
  resourceLabel: string;
};

export type ReservationRequestRow = {
  id: string;
  resourceType: ReservationResourceType;
  resourceId: string;
  resourceLabel: string;
  resourceContext: string | null;
  resourceCode: string | null;
  resourceDescription: string | null;
  resourceOriginalRoomId: string | null;
  resourceOriginalRoomLabel: string | null;
  destinationRoomId: string | null;
  destinationRoomLabel: string | null;
  bookingDate: string;
  startTime: string;
  endTime: string;
  purpose: string;
  requesterName: string;
  requesterDocument: string;
  requesterEmail: string | null;
  requesterPhone: string | null;
  status: ReservationStatus;
  confirmationToken: string | null;
  confirmationTokenExpiresAt: string | null;
  createdByStaffId: string;
  returnedAt: string | null;
  reportReason?: string | null;
  createdAt: string;
  updatedAt: string;
};

let ensureReservationsSchemaPromise: Promise<void> | null = null;

const generateConfirmationToken = (): string => {
  return randomBytes(32).toString("hex");
};

const ensureReservationsSchema = async () => {
  // Add confirmation_token column if it doesn't exist
  await prisma.$executeRawUnsafe(`
    ALTER TABLE IF EXISTS public.reservas_solicitudes
    ADD COLUMN IF NOT EXISTS confirmation_token text
  `);

  // Update status enum constraint to include new values
  await prisma.$executeRawUnsafe(`
    ALTER TABLE IF EXISTS public.reservas_solicitudes
    DROP CONSTRAINT IF EXISTS reservas_solicitudes_status_chk
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE IF EXISTS public.reservas_solicitudes
    DROP CONSTRAINT IF EXISTS reservas_solicitudes_resource_type_chk
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE IF EXISTS public.reservas_solicitudes
    DROP CONSTRAINT IF EXISTS reservas_solicitudes_destination_chk
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE IF EXISTS public.reservas_solicitudes
    ADD CONSTRAINT reservas_solicitudes_status_chk CHECK (status IN ('no_aceptado', 'confirmada', 'devuelto', 'rechazada', 'cancelada', 'reportado'))
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE IF EXISTS public.reservas_solicitudes
    ADD CONSTRAINT reservas_solicitudes_resource_type_chk CHECK (resource_type IN ('rooms', 'equipment', 'televisor'))
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE IF EXISTS public.reservas_solicitudes
    ADD CONSTRAINT reservas_solicitudes_destination_chk CHECK (
      (resource_type = 'rooms' AND destination_room_id IS NULL AND destination_room_label IS NULL)
      OR
      (resource_type IN ('equipment', 'televisor') AND destination_room_id IS NOT NULL AND destination_room_label IS NOT NULL)
    )
  `);

  // Create the table if it doesn't exist
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.reservas_solicitudes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      resource_type text NOT NULL,
      resource_id text NOT NULL,
      resource_label text NOT NULL,
      resource_context text,
      resource_code text,
      resource_description text,
      resource_original_room_id text,
      resource_original_room_label text,
      destination_room_id text,
      destination_room_label text,
      booking_date date NOT NULL,
      start_time time NOT NULL,
      end_time time NOT NULL,
      purpose text NOT NULL,
      requester_name text NOT NULL,
      requester_document text NOT NULL,
      requester_email text,
      requester_phone text,
      status text NOT NULL DEFAULT 'no_aceptado',
      confirmation_token text,
      created_by_staff_id uuid NOT NULL REFERENCES public.staff(id),
      returned_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT reservas_solicitudes_resource_type_chk CHECK (resource_type IN ('rooms', 'equipment', 'televisor')),
      CONSTRAINT reservas_solicitudes_status_chk CHECK (status IN ('no_aceptado', 'confirmada', 'devuelto', 'rechazada', 'cancelada', 'reportado')),
      CONSTRAINT reservas_solicitudes_time_chk CHECK (end_time > start_time),
      CONSTRAINT reservas_solicitudes_destination_chk CHECK (
        (resource_type = 'rooms' AND destination_room_id IS NULL AND destination_room_label IS NULL)
        OR
        (resource_type IN ('equipment', 'televisor') AND destination_room_id IS NOT NULL AND destination_room_label IS NOT NULL)
      )
    )
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE IF EXISTS public.reservas_solicitudes
    ADD COLUMN IF NOT EXISTS resource_original_room_id text
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE IF EXISTS public.reservas_solicitudes
    ADD COLUMN IF NOT EXISTS resource_original_room_label text
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE IF EXISTS public.reservas_solicitudes
    ADD COLUMN IF NOT EXISTS returned_at timestamptz
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE IF EXISTS public.reservas_solicitudes
    ADD COLUMN IF NOT EXISTS report_reason text
  `);

  // Create indexes
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_reservas_solicitudes_resource_type ON public.reservas_solicitudes(resource_type)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_reservas_solicitudes_booking_date ON public.reservas_solicitudes(booking_date)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_reservas_solicitudes_status ON public.reservas_solicitudes(status)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_reservas_solicitudes_created_by ON public.reservas_solicitudes(created_by_staff_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_reservas_solicitudes_confirmation_token ON public.reservas_solicitudes(confirmation_token)
  `);
};

export const ensureReservationsSchemaReady = async () => {
  if (!ensureReservationsSchemaPromise) {
    ensureReservationsSchemaPromise = ensureReservationsSchema().catch((error) => {
      ensureReservationsSchemaPromise = null;
      throw error;
    });
  }

  await ensureReservationsSchemaPromise;
};

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);

const getRoomByIdentifier = async (identifier: string) => {
  const rows = await prisma.$queryRaw<InventoryRoomSnapshot[]>`
    SELECT
      id::text AS id,
      nombre_bloque AS nombre,
      piso,
      capacidad
    FROM public.salones
    WHERE id::text = ${identifier} OR nombre_bloque = ${identifier}
    LIMIT 1
  `;

  return rows[0] ?? null;
};

const getInventoryItemById = async (identifier: string) => {
  const rows = await prisma.$queryRaw<InventoryItemSnapshot[]>`
    SELECT
      i.id::text AS id,
      i.nombre,
      i.codigo,
      i.salon,
      i.estado,
      g.nombre AS grupo
    FROM public.inventory_items i
    INNER JOIN public.inventory_groups g ON g.id = i.group_id
    WHERE i.id::text = ${identifier}
    LIMIT 1
  `;

  return rows[0] ?? null;
};

const isTelevisionGroup = (groupName: string) => groupName.trim().toLowerCase() === "televisores";

const timeToMinutes = (timeStr: string) => {
  const [hours = "0", minutes = "0"] = timeStr.split(":");
  return Number(hours) * 60 + Number(minutes);
};

const timeRangesOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string) => {
  const aStartMin = timeToMinutes(aStart);
  const aEndMin = timeToMinutes(aEnd);
  const bStartMin = timeToMinutes(bStart);
  const bEndMin = timeToMinutes(bEnd);
  return aStartMin < bEndMin && bStartMin < aEndMin;
};

const normalizeRoomLabel = (value: string) => value.trim().toLowerCase();

const extractFloorNumber = (value: string) => {
  const match = value.match(/piso\s*(\d+)/i);
  return match ? Number(match[1]) : null;
};

const getRoomDistanceScore = (sourceRoom: string, destinationRoom: string) => {
  const sourceFloor = extractFloorNumber(sourceRoom);
  const destinationFloor = extractFloorNumber(destinationRoom);

  if (sourceFloor !== null && destinationFloor !== null) {
    return Math.abs(sourceFloor - destinationFloor);
  }

  if (normalizeRoomLabel(sourceRoom) === normalizeRoomLabel(destinationRoom)) {
    return 0;
  }

  return sourceRoom === destinationRoom ? 0 : 99;
};

const getTelevisionCandidates = async (): Promise<TelevisionCandidate[]> => {
  const rows = await prisma.$queryRaw<TelevisionCandidate[]>`
    SELECT
      i.id::text AS id,
      i.nombre AS nombre,
      i.codigo AS codigo,
      i.salon AS salon,
      COALESCE(room_counts.room_tv_count, 0)::int AS "roomTvCount"
    FROM public.inventory_items i
    INNER JOIN public.inventory_groups g ON g.id = i.group_id
    LEFT JOIN (
      SELECT
        salon,
        COUNT(*)::int AS room_tv_count
      FROM public.inventory_items tv
      INNER JOIN public.inventory_groups tg ON tg.id = tv.group_id
      WHERE LOWER(tg.nombre) = 'televisores'
        AND COALESCE(tv.defectuoso, false) = false
      GROUP BY salon
    ) room_counts ON room_counts.salon = i.salon
    WHERE LOWER(g.nombre) = 'televisores'
      AND i.estado = 'Disponible'
      AND COALESCE(i.defectuoso, false) = false
    ORDER BY COALESCE(room_counts.room_tv_count, 0) DESC, i.salon ASC, i.orden ASC
  `;

  return rows;
};

const getTelevisionRoomConflicts = async (bookingDate: string, startTime: string, endTime: string) => {
  const rows = await prisma.$queryRaw<RoomReservationConflict[]>`
    SELECT
      resource_id::text AS "resourceId",
      TO_CHAR(booking_date, 'YYYY-MM-DD') AS "bookingDate",
      TO_CHAR(start_time, 'HH24:MI') AS "startTime",
      TO_CHAR(end_time, 'HH24:MI') AS "endTime",
      status,
      resource_type AS "resourceType",
      resource_label AS "resourceLabel"
    FROM public.reservas_solicitudes
    WHERE booking_date = ${bookingDate}::date
      AND status IN ('no_aceptado', 'confirmada')
      AND resource_type IN ('rooms', 'equipment', 'televisor')
  `;

  return rows.filter((row) => row.resourceType === "rooms" && timeRangesOverlap(row.startTime, row.endTime, startTime, endTime));
};

const getTelevisionItemConflicts = async (bookingDate: string, startTime: string, endTime: string) => {
  const rows = await prisma.$queryRaw<RoomReservationConflict[]>`
    SELECT
      resource_id::text AS "resourceId",
      TO_CHAR(booking_date, 'YYYY-MM-DD') AS "bookingDate",
      TO_CHAR(start_time, 'HH24:MI') AS "startTime",
      TO_CHAR(end_time, 'HH24:MI') AS "endTime",
      status,
      resource_type AS "resourceType",
      resource_label AS "resourceLabel"
    FROM public.reservas_solicitudes
    WHERE booking_date = ${bookingDate}::date
      AND status IN ('no_aceptado', 'confirmada')
      AND resource_type IN ('equipment', 'televisor')
  `;

  return rows.filter((row) => timeRangesOverlap(row.startTime, row.endTime, startTime, endTime));
};

const selectTelevisionForReservation = async (bookingDate: string, startTime: string, endTime: string, destinationRoomLabel: string) => {
  const televisions = await getTelevisionCandidates();
  const reservedTelevisionIds = new Set((await getTelevisionItemConflicts(bookingDate, startTime, endTime)).map((row) => row.resourceId));
  const roomConflicts = await getTelevisionRoomConflicts(bookingDate, startTime, endTime);
  const availableTelevisions = televisions.filter((television) => !reservedTelevisionIds.has(television.id));
  const normalizedDestinationRoom = normalizeRoomLabel(destinationRoomLabel);

  const scored = availableTelevisions
    .map((television) => {
      const sameRoom = normalizeRoomLabel(television.salon) === normalizedDestinationRoom;
      const roomConflict = roomConflicts.some((conflict) => normalizeRoomLabel(conflict.resourceLabel) === normalizeRoomLabel(television.salon));
      const roomDistanceScore = getRoomDistanceScore(television.salon, destinationRoomLabel);

      return {
        television,
        sameRoom,
        roomConflict,
        roomDistanceScore,
      };
    })
    .sort((left, right) => {
      if (left.sameRoom !== right.sameRoom) {
        return left.sameRoom ? -1 : 1;
      }

      const leftPriority = left.television.roomTvCount >= 2 ? 0 : 1;
      const rightPriority = right.television.roomTvCount >= 2 ? 0 : 1;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      if (left.roomConflict !== right.roomConflict) {
        return left.roomConflict ? 1 : -1;
      }

      if (left.roomDistanceScore !== right.roomDistanceScore) {
        return left.roomDistanceScore - right.roomDistanceScore;
      }

      return left.television.salon.localeCompare(right.television.salon);
    });

  const bestSameRoom = scored.find((candidate) => candidate.sameRoom);
  if (bestSameRoom) {
    return {
      television: bestSameRoom.television,
      note: `El televisor ya está en ${destinationRoomLabel}; no requiere traslado.`,
      needsReturnReminder: false,
    };
  }

  const preferred = scored.filter((candidate) => candidate.television.roomTvCount >= 2);
  if (preferred.length > 0) {
    const preferredTelevision = preferred[0];
    if (!preferredTelevision) {
      return null;
    }

    return {
      television: preferredTelevision.television,
      note: `Se asignó un televisor desde ${preferredTelevision.television.salon}, donde hay ${preferredTelevision.television.roomTvCount} televisores.`,
      needsReturnReminder: false,
    };
  }

  const fallback = scored.find((candidate) => !candidate.roomConflict);
  if (!fallback) {
    return null;
  }

  return {
    television: fallback.television,
    note: `Se asignó un televisor desde ${fallback.television.salon}. Devuélvelo antes de que inicie la próxima clase en ese salón.`,
    needsReturnReminder: true,
  };
};

const updateInventoryItemRoom = async (db: any, itemId: string, room: string) => {
  await db.$queryRaw`
    UPDATE public.inventory_items
    SET salon = ${room}, updated_at = now()
    WHERE id = ${itemId}::uuid
  `;
};

export const createReservationRequest = async (payload: CreateReservationInput) => {
  await ensureReservationsSchemaReady();

  const destinationRoom = payload.destinationRoomId ? await getRoomByIdentifier(payload.destinationRoomId) : null;
  const destinationRoomLabel = destinationRoom?.nombre ?? payload.destinationRoomId ?? null;
  const destinationRoomId = destinationRoom?.id ?? payload.destinationRoomId ?? null;
  const confirmationToken = generateConfirmationToken();

  if (payload.resourceType === "rooms") {
    const room = await getRoomByIdentifier(payload.resourceId);
    if (!room) {
      throw new Error("No se encontro el salon seleccionado");
    }

    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.reservas_solicitudes (
        resource_type,
        resource_id,
        resource_label,
        resource_context,
        resource_code,
        resource_description,
        destination_room_id,
        destination_room_label,
        booking_date,
        start_time,
        end_time,
        purpose,
        requester_name,
        requester_document,
        requester_email,
        requester_phone,
        status,
        confirmation_token,
        confirmation_token_expires_at,
        created_by_staff_id
      )
      VALUES (
        'rooms',
        ${room.id},
        ${room.nombre},
        ${room.piso !== null ? `Piso ${room.piso}` : null},
        ${null},
        ${room.capacidad !== null ? `Capacidad ${room.capacidad}` : null},
        ${null},
        ${null},
        ${toIsoDate(payload.bookingDate)},
        ${payload.startTime},
        ${payload.endTime},
        ${payload.purpose},
        ${payload.requesterName},
        ${payload.requesterDocument},
        ${payload.requesterEmail},
        ${payload.requesterPhone},
        'no_aceptado',
        ${confirmationToken},
        now() + interval '24 hours',
        ${payload.createdByStaffId}::uuid
      )
      RETURNING id::text AS id
    `;

    const id = rows[0]?.id;
    if (!id) {
      throw new Error("No se pudo crear la solicitud de reserva");
    }

    // Send confirmation email if email is provided
    if (payload.requesterEmail) {
      const emailData: ReservationEmailData = {
        id,
        requesterName: payload.requesterName,
        requesterEmail: payload.requesterEmail,
        resourceLabel: room.nombre,
        resourceType: "rooms",
        bookingDate: toIsoDate(payload.bookingDate),
        startTime: payload.startTime,
        endTime: payload.endTime,
        purpose: payload.purpose,
        confirmationToken,
      };

      // Send email asynchronously without blocking the response
      sendReservationConfirmationEmail(emailData).catch((error) => {
        console.error(`Failed to send email for reservation ${id}:`, error);
      });
    }

    return { id };
  }

  // Equipment / televisor reservation
  const requiresDestinationRoom = payload.resourceType === "equipment" || payload.resourceType === "televisor";
  if (requiresDestinationRoom && !destinationRoomLabel) {
    throw new Error("Debes seleccionar el salon de destino");
  }

  const item = payload.resourceType === "equipment" ? await getInventoryItemById(payload.resourceId) : null;
  if (payload.resourceType === "equipment") {
    if (!item) {
      throw new Error("No se encontro el elemento de inventario seleccionado");
    }

    if ((item.estado ?? "").toLowerCase() !== "disponible") {
      throw new Error("El elemento seleccionado no esta disponible");
    }
  }

  let assignedTelevision: TelevisionCandidate | null = null;
  let needsReturnReminder = false;
  let televisionAssignmentNote: string | null = null;

  if (payload.resourceType === "televisor") {
    const selected = await selectTelevisionForReservation(toIsoDate(payload.bookingDate), payload.startTime, payload.endTime, destinationRoomLabel ?? "");
    if (!selected) {
      throw new Error("No hay televisores disponibles para el horario seleccionado");
    }

    assignedTelevision = selected.television;
    needsReturnReminder = selected.needsReturnReminder;
    televisionAssignmentNote = selected.note;
  }

  const inventoryItem = payload.resourceType === "equipment" ? item : assignedTelevision ? await getInventoryItemById(assignedTelevision.id) : null;
  if (payload.resourceType === "televisor" && !inventoryItem) {
    throw new Error("No se encontro el televisor seleccionado");
  }

  const originalRoomLabel = inventoryItem?.salon ?? null;
  const reservationResourceId = payload.resourceType === "televisor" ? assignedTelevision?.id ?? payload.resourceId : payload.resourceId;
  const reservationResourceLabel = payload.resourceType === "televisor" ? assignedTelevision?.nombre ?? payload.resourceId : item?.nombre ?? payload.resourceId;
  const reservationResourceCode = payload.resourceType === "televisor" ? assignedTelevision?.codigo ?? null : item?.codigo ?? null;
  const reservationResourceContext = payload.resourceType === "televisor"
    ? (televisionAssignmentNote ?? (assignedTelevision ? `Asignación automática. Origen: ${assignedTelevision.salon}.` : "Asignación automática"))
    : item?.grupo ?? null;

  return prisma.$transaction(async (tx) => {
    if (payload.resourceType === "equipment" && item) {
      // Update inventory item location
      await updateInventoryItemRoom(tx, item.id, destinationRoomLabel ?? item.salon);
    }

    // Create reservation
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.reservas_solicitudes (
        resource_type,
        resource_id,
        resource_label,
        resource_context,
        resource_code,
        resource_description,
        resource_original_room_id,
        resource_original_room_label,
        destination_room_id,
        destination_room_label,
        booking_date,
        start_time,
        end_time,
        purpose,
        requester_name,
        requester_document,
        requester_email,
        requester_phone,
        status,
        confirmation_token,
        confirmation_token_expires_at,
        created_by_staff_id
      )
      VALUES (
        ${payload.resourceType},
        ${reservationResourceId},
        ${reservationResourceLabel},
        ${reservationResourceContext},
        ${reservationResourceCode},
        ${originalRoomLabel},
        ${null},
        ${originalRoomLabel},
        ${destinationRoomId},
        ${destinationRoomLabel},
        ${toIsoDate(payload.bookingDate)},
        ${payload.startTime},
        ${payload.endTime},
        ${payload.purpose},
        ${payload.requesterName},
        ${payload.requesterDocument},
        ${payload.requesterEmail},
        ${payload.requesterPhone},
        'no_aceptado',
        ${confirmationToken},
        now() + interval '24 hours',
        ${payload.createdByStaffId}::uuid
      )
      RETURNING id::text AS id
    `;

    const id = rows[0]?.id;
    if (!id) {
      throw new Error("No se pudo crear la solicitud de reserva");
    }

    // Send confirmation email if email is provided
    if (payload.requesterEmail) {
      const emailData: ReservationEmailData = {
        id,
        requesterName: payload.requesterName,
        requesterEmail: payload.requesterEmail,
        resourceLabel: reservationResourceLabel,
        resourceType: payload.resourceType,
        bookingDate: toIsoDate(payload.bookingDate),
        startTime: payload.startTime,
        endTime: payload.endTime,
        purpose: payload.purpose,
        confirmationToken,
        returnNote: payload.resourceType === "televisor" ? televisionAssignmentNote : null,
        ...(destinationRoomLabel ? { destinationRoom: destinationRoomLabel } : {}),
      };

      // Send email asynchronously without blocking the response
      sendReservationConfirmationEmail(emailData).catch((error) => {
        console.error(`Failed to send email for reservation ${id}:`, error);
      });
    }

    return {
      id,
      assignmentLabel: payload.resourceType === "televisor" ? reservationResourceLabel : null,
      returnNote: payload.resourceType === "televisor" ? televisionAssignmentNote : null,
    };
  });
};

export const markTelevisionDisplaced = async (reservationId: string) => {
  await ensureReservationsSchemaReady();

  const reservation = await getReservationRequestById(reservationId);
  if (!reservation) {
    throw new Error("No se encontro la solicitud de reserva");
  }

  if (reservation.resourceType !== "televisor") {
    throw new Error("Solo las reservas de televisor pueden marcarse como desplazadas");
  }

  if (!reservation.destinationRoomLabel) {
    throw new Error("Debes seleccionar el salon de destino");
  }

  if (reservation.status === "devuelto") {
    throw new Error("La solicitud ya fue devuelta");
  }

  const destinationRoom = reservation.destinationRoomId ? await getRoomByIdentifier(reservation.destinationRoomId) : null;
  const destinationRoomLabel = destinationRoom?.nombre ?? reservation.destinationRoomLabel;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      UPDATE public.inventory_items
      SET salon = ${destinationRoomLabel}, updated_at = now()
      WHERE id = ${reservation.resourceId}::uuid
    `;

    const televisorRows = await tx.$queryRaw<Array<{ hdmi_item_id: string | null }>>`
      SELECT hdmi_item_id::text AS hdmi_item_id
      FROM public.inventory_items
      WHERE id = ${reservation.resourceId}::uuid
      LIMIT 1
    `;

    const linkedHdmiId = televisorRows[0]?.hdmi_item_id;
    if (linkedHdmiId) {
      await tx.$queryRaw`
        UPDATE public.inventory_items
        SET salon = ${destinationRoomLabel}, updated_at = now()
        WHERE id = ${linkedHdmiId}::uuid
      `;
    }

    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE public.reservas_solicitudes
      SET status = 'confirmada', updated_at = now()
      WHERE id = ${reservationId}::uuid
      RETURNING id::text AS id
    `;

    return rows[0]?.id ?? null;
  });

  if (!updated) {
    throw new Error("No se pudo marcar el televisor como desplazado");
  }

  return { id: updated };
};

export const getReservationRequestById = async (id: string) => {
  await ensureReservationsSchemaReady();

  const rows = await prisma.$queryRaw<ReservationRequestRow[]>`
    SELECT
      id::text AS id,
      resource_type AS "resourceType",
      resource_id AS "resourceId",
      resource_label AS "resourceLabel",
      resource_context AS "resourceContext",
      resource_code AS "resourceCode",
      resource_description AS "resourceDescription",
      resource_original_room_id AS "resourceOriginalRoomId",
      resource_original_room_label AS "resourceOriginalRoomLabel",
      destination_room_id AS "destinationRoomId",
      destination_room_label AS "destinationRoomLabel",
      TO_CHAR(booking_date, 'YYYY-MM-DD') AS "bookingDate",
      TO_CHAR(start_time, 'HH24:MI') AS "startTime",
      TO_CHAR(end_time, 'HH24:MI') AS "endTime",
      purpose,
      requester_name AS "requesterName",
      requester_document AS "requesterDocument",
      requester_email AS "requesterEmail",
      requester_phone AS "requesterPhone",
      status,
      report_reason AS "reportReason",
      confirmation_token AS "confirmationToken",
      created_by_staff_id::text AS "createdByStaffId",
      TO_CHAR(returned_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "returnedAt",
      TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
      TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
    FROM public.reservas_solicitudes
    WHERE id::text = ${id}
  `;

  return rows[0] ?? null;
};

export const confirmReservationRequest = async (reservationId: string, token: string) => {
  await ensureReservationsSchemaReady();

  const reservation = await getReservationRequestById(reservationId);
  if (!reservation) {
    throw new Error("No se encontro la solicitud de reserva");
  }

  if (reservation.confirmationToken !== token) {
    throw new Error("Token de confirmacion invalido");
  }

  const now = new Date();
  if (reservation.confirmationTokenExpiresAt) {
    const expiryDate = new Date(reservation.confirmationTokenExpiresAt);
    if (!Number.isFinite(expiryDate.getTime()) || now > expiryDate) {
      throw new Error("El enlace de confirmación ha expirado. Por favor, solicita un nuevo enlace.");
    }
  }

  if (!reservation.confirmationTokenExpiresAt && !reservation.createdAt) {
    throw new Error("El enlace de confirmación ha expirado. Por favor, solicita un nuevo enlace.");
  }

  if (reservation.status === "confirmada") {
    return { id: reservation.id, alreadyConfirmed: true };
  }

  const updated = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE public.reservas_solicitudes
    SET status = 'confirmada', updated_at = now()
    WHERE id = ${reservationId}::uuid
    RETURNING id::text AS id
  `;

  const updatedId = updated[0]?.id;
  if (!updatedId) {
    throw new Error("No se pudo confirmar la solicitud de reserva");
  }

  return { id: updatedId, alreadyConfirmed: false };
};

export const returnReservationRequest = async (reservationId: string) => {
  await ensureReservationsSchemaReady();

  const reservation = await getReservationRequestById(reservationId);
  if (!reservation) {
    throw new Error("No se encontro la solicitud de reserva");
  }

  if (reservation.resourceType !== "equipment" && reservation.resourceType !== "televisor") {
    throw new Error("Solo los elementos de inventario pueden devolverse");
  }

  if (reservation.status === "devuelto") {
    throw new Error("La solicitud ya fue devuelta");
  }

  if (!reservation.resourceOriginalRoomLabel) {
    throw new Error("No se pudo recuperar la ubicacion original del elemento");
  }

  return prisma.$transaction(async (tx) => {
    // Restore inventory item location
    await tx.$queryRaw`
      UPDATE public.inventory_items
      SET salon = ${reservation.resourceOriginalRoomLabel}, updated_at = now()
      WHERE id = ${reservation.resourceId}::uuid
    `;

    // Update reservation status
    const updated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE public.reservas_solicitudes
      SET status = 'devuelto', returned_at = now(), updated_at = now()
      WHERE id = ${reservationId}::uuid
      RETURNING id::text AS id
    `;

    const updatedId = updated[0]?.id;
    if (!updatedId) {
      throw new Error("No se pudo marcar la solicitud como devuelta");
    }

    return { id: updatedId };
  });
};

export const listReservationRequests = async () => {
  await ensureReservationsSchemaReady();

  const rows = await prisma.$queryRaw<ReservationRequestRow[]>`
    SELECT
      id::text AS id,
      resource_type AS "resourceType",
      resource_id AS "resourceId",
      resource_label AS "resourceLabel",
      resource_context AS "resourceContext",
      resource_code AS "resourceCode",
      resource_description AS "resourceDescription",
      resource_original_room_id AS "resourceOriginalRoomId",
      resource_original_room_label AS "resourceOriginalRoomLabel",
      destination_room_id AS "destinationRoomId",
      destination_room_label AS "destinationRoomLabel",
      TO_CHAR(booking_date, 'YYYY-MM-DD') AS "bookingDate",
      TO_CHAR(start_time, 'HH24:MI') AS "startTime",
      TO_CHAR(end_time, 'HH24:MI') AS "endTime",
      purpose,
      requester_name AS "requesterName",
      requester_document AS "requesterDocument",
      requester_email AS "requesterEmail",
      requester_phone AS "requesterPhone",
      status,
      report_reason AS "reportReason",
      confirmation_token AS "confirmationToken",
      created_by_staff_id::text AS "createdByStaffId",
      TO_CHAR(returned_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "returnedAt",
      TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
      TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
    FROM public.reservas_solicitudes
    ORDER BY created_at DESC
  `;

  return rows;
};

export const cancelReservationRequest = async (reservationId: string, requesterStaffId: string, allowAdmin = false) => {
  await ensureReservationsSchemaReady();

  const reservation = await getReservationRequestById(reservationId);
  if (!reservation) {
    throw new Error("No se encontro la solicitud de reserva");
  }

  if (reservation.status !== "no_aceptado") {
    throw new Error("Sólo se pueden cancelar solicitudes que aún no fueron aceptadas");
  }

  if (!allowAdmin && reservation.createdByStaffId !== requesterStaffId) {
    throw new Error("No autorizado para cancelar esta solicitud");
  }

  const updated = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE public.reservas_solicitudes
    SET status = 'cancelada', updated_at = now()
    WHERE id = ${reservationId}::uuid
    RETURNING id::text AS id
  `;

  const updatedId = updated[0]?.id;
  if (!updatedId) {
    throw new Error("No se pudo cancelar la solicitud de reserva");
  }

  return { id: updatedId };
};

export const closeReservationRequest = async (reservationId: string, requesterStaffId: string, allowAdmin = false) => {
  await ensureReservationsSchemaReady();

  const reservation = await getReservationRequestById(reservationId);
  if (!reservation) {
    throw new Error("No se encontro la solicitud de reserva");
  }

  if (reservation.status !== "confirmada") {
    throw new Error("Sólo se pueden cerrar solicitudes que estén confirmadas");
  }

  if (!allowAdmin && reservation.createdByStaffId !== requesterStaffId) {
    throw new Error("No autorizado para cerrar esta solicitud");
  }

  // For equipment, perform the return workflow which restores inventory and marks as devuelto
  if (reservation.resourceType === "equipment" || reservation.resourceType === "televisor") {
    return await returnReservationRequest(reservationId);
  }

  // For rooms, mark as devuelto (closed)
  const updated = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE public.reservas_solicitudes
    SET status = 'devuelto', updated_at = now()
    WHERE id = ${reservationId}::uuid
    RETURNING id::text AS id
  `;

  const updatedId = updated[0]?.id;
  if (!updatedId) {
    throw new Error("No se pudo cerrar la solicitud de reserva");
  }

  return { id: updatedId };
};

export const reportReservationRequest = async (reservationId: string, requesterStaffId: string, allowAdmin = false, reportReason: string | null = null) => {
  await ensureReservationsSchemaReady();

  const reservation = await getReservationRequestById(reservationId);
  if (!reservation) {
    throw new Error("No se encontro la solicitud de reserva");
  }

  if (reservation.status !== "confirmada") {
    throw new Error("Sólo se pueden reportar solicitudes que estén confirmadas");
  }

  if (!allowAdmin && reservation.createdByStaffId !== requesterStaffId) {
    throw new Error("No autorizado para reportar esta solicitud");
  }

  // For equipment, still attempt to restore original location, but mark as reported
  if (reservation.resourceType === "equipment" || reservation.resourceType === "televisor") {
    return prisma.$transaction(async (tx) => {
      if (!reservation.resourceOriginalRoomLabel) {
        throw new Error("No se pudo recuperar la ubicacion original del elemento");
      }

      await tx.$queryRaw`
        UPDATE public.inventory_items
        SET salon = ${reservation.resourceOriginalRoomLabel}, updated_at = now()
        WHERE id = ${reservation.resourceId}::uuid
      `;

      const updated = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE public.reservas_solicitudes
        SET status = 'reportado', returned_at = now(), updated_at = now(), report_reason = ${reportReason}
        WHERE id = ${reservationId}::uuid
        RETURNING id::text AS id
      `;

      const updatedId = updated[0]?.id;
      if (!updatedId) {
        throw new Error("No se pudo marcar la solicitud como reportada");
      }

      return { id: updatedId };
    });
  }

  // For rooms, just mark as reportado
  const updated = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE public.reservas_solicitudes
    SET status = 'reportado', updated_at = now(), report_reason = ${reportReason}
    WHERE id = ${reservationId}::uuid
    RETURNING id::text AS id
  `;

  const updatedId = updated[0]?.id;
  if (!updatedId) {
    throw new Error("No se pudo marcar la solicitud como reportada");
  }

  return { id: updatedId };
};

export const listReservationRequestsByCreator = async (staffId: string) => {
  await ensureReservationsSchemaReady();

  const rows = await prisma.$queryRaw<ReservationRequestRow[]>`
    SELECT
      id::text AS id,
      resource_type AS "resourceType",
      resource_id AS "resourceId",
      resource_label AS "resourceLabel",
      resource_context AS "resourceContext",
      resource_code AS "resourceCode",
      resource_description AS "resourceDescription",
      resource_original_room_id AS "resourceOriginalRoomId",
      resource_original_room_label AS "resourceOriginalRoomLabel",
      destination_room_id AS "destinationRoomId",
      destination_room_label AS "destinationRoomLabel",
      TO_CHAR(booking_date, 'YYYY-MM-DD') AS "bookingDate",
      TO_CHAR(start_time, 'HH24:MI') AS "startTime",
      TO_CHAR(end_time, 'HH24:MI') AS "endTime",
      purpose,
      requester_name AS "requesterName",
      requester_document AS "requesterDocument",
      requester_email AS "requesterEmail",
      requester_phone AS "requesterPhone",
      status,
      report_reason AS "reportReason",
      confirmation_token AS "confirmationToken",
      created_by_staff_id::text AS "createdByStaffId",
      TO_CHAR(returned_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "returnedAt",
      TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
      TO_CHAR(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"
    FROM public.reservas_solicitudes
    WHERE created_by_staff_id::text = ${staffId}
    ORDER BY created_at DESC
  `;

  return rows;
};
