import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAdminOrMonitorRole, requireAdminRole, requireAuthToken, type AuthenticatedRequest } from "../../lib/auth";
import { parseScheduleWorkbook } from "./parser";
import { ParsedScheduleRow } from "./types";
import { broadcastScheduleRefresh } from "../../lib/websocket";
import {
  clearAllSchedules,
  createScheduleEvent,
  deleteScheduleEventSlot,
  deletePendingScheduleRequest,
  deletePendingScheduleRequestByEventId,
  findAvailableRooms,
  getRoomActionHistory,
  getImportsHistory,
  getRooms,
  getSharedScheduleState,
  getScheduleEvents,
  getPendingScheduleRequests,
  deleteSharedVisualRoomAssignment,
  setSharedRoomDisabledState,
  markRoomClean,
  reportRoomDamage,
  replaceAllSchedulesFromRows,
  upsertSharedVisualRoomAssignment,
  updatePendingScheduleRequest,
  updatePendingScheduleRequestByEventId,
  updateScheduleRequestStatus,
  updateScheduleEventSlot,
} from "./service";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = new Set([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
      "application/csv",
    ]);

    const safeName = file.originalname.toLowerCase();
    const hasAllowedExtension = safeName.endsWith(".xlsx") || safeName.endsWith(".xls") || safeName.endsWith(".csv");
    const hasAllowedMimeType = allowedMimeTypes.has((file.mimetype ?? "").toLowerCase());

    if (!hasAllowedExtension && !hasAllowedMimeType) {
      cb(new Error("Tipo de archivo no permitido"));
      return;
    }

    cb(null, true);
  },
});

export const schedulesRouter = Router();

const parsedRowSchema = z.object({
  faculty: z.string().min(1),
  code: z.string().min(1),
  subject: z.string().min(1),
  teacher: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  day: z.string().min(1),
  room: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
});

const parsedImportSchema = z.object({
  sourceFile: z.string().min(1),
  rows: z.array(parsedRowSchema),
  meta: z
    .object({
      conflictsDetected: z.number().int().min(0).optional(),
      conflictsAccepted: z.number().int().min(0).optional(),
      conflictsRejected: z.number().int().min(0).optional(),
      importedBy: z.string().min(1).max(120).optional(),
    })
    .optional(),
});

const createEventSchema = z.object({
  reservationType: z.enum(["normal", "momentanea", "iglesia"]).default("normal"),
  faculty: z.string().min(1),
  code: z.string().min(1),
  subject: z.string().min(1),
  teacher: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slots: z
    .array(
      z.object({
        day: z.string().min(1),
        room: z.string().min(1),
        start: z.string().regex(/^\d{2}:\d{2}$/),
        end: z.string().regex(/^\d{2}:\d{2}$/),
      })
    )
    .min(1),
});

const eventSlotParamsSchema = z.object({
  eventId: z.string().uuid(),
  slotId: z.string().uuid(),
});

const updateEventSchema = z.object({
  faculty: z.string().min(1),
  code: z.string().min(1),
  subject: z.string().min(1),
  teacher: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  day: z.string().min(1),
  room: z.string().min(1),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  updateScope: z.enum(["always", "week"]).optional(),
});

const availableRoomsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  capacity: z.coerce.number().int().min(1).max(1000),
});

const requestStatusSchema = z.object({
  status: z.enum(["aprobada", "rechazada"]),
});

const requestEditBodySchema = createEventSchema;

const sharedRoomDisableSchema = z.object({
  roomName: z.string().min(1),
  disabled: z.boolean(),
});

const sharedVisualAssignmentSchema = z.object({
  eventId: z.string().uuid(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  roomName: z.string().min(1),
});

const sharedVisualAssignmentDeleteSchema = z.object({
  eventId: z.string().uuid(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const roomActionParamsSchema = z.object({
  roomId: z.string().uuid(),
});

const roomDamageBodySchema = z.object({
  note: z.string().min(5),
});

type RoomsInfoRawRow = {
  salon_id: string;
  salon_nombre: string;
  salon_piso: number | null;
  salon_capacidad: number | null;
  dia_semana: string | null;
  hora_inicio: string | null;
  hora_fin: string | null;
  nombre_principal: string | null;
  responsable: string | null;
  codigo_materia: string | null;
  facultad_nombre: string | null;
  actividad: string | null;
};

const toLocalDate = (isoDate: string) => {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
};

const toMinutes = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
};

const normalizeComparable = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const dateRangesOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  aStart <= bEnd && bStart <= aEnd;

const timeRangesOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);

const findCreateEventOverlap = async (payload: z.infer<typeof createEventSchema>) => {
  const events = await getScheduleEvents();
  const targetStart = payload.startDate;
  const targetEnd = payload.endDate;

  for (const slot of payload.slots) {
    const slotDay = normalizeComparable(slot.day);
    const slotRoom = normalizeComparable(slot.room);

    const conflict = events.find((event) => {
      const sameDay = normalizeComparable(event.day) === slotDay;
      const sameRoom = normalizeComparable(event.room) === slotRoom;
      const overlapDates = dateRangesOverlap(targetStart, targetEnd, event.startDate, event.endDate);
      const overlapTimes = timeRangesOverlap(slot.start, slot.end, event.start, event.end);
      return sameDay && sameRoom && overlapDates && overlapTimes;
    });

    if (conflict) {
      return {
        room: conflict.room,
        day: conflict.day,
        subject: conflict.subject,
        conflictTime: `${conflict.start}-${conflict.end}`,
        requestedTime: `${slot.start}-${slot.end}`,
        conflictRange: `${conflict.startDate} a ${conflict.endDate}`,
      };
    }
  }

  return null;
};

const weekDayFromIsoDate = (isoDate: string) => {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
  const day = date.getDay();
  const names = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"] as const;
  return names[day] ?? "Lunes";
};

const handleKnownScheduleWriteError = (error: unknown, res: import("express").Response) => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message;
  const messageLower = message.toLowerCase();

  // Parse detailed conflict error: CONFLICTO_SOLAPE|salon|dia|hora_conflicto|hora_intento|clase|inicio_existente|fin_existente|fecha_objetivo
  if (message.includes("CONFLICTO_SOLAPE")) {
    const parts = message.split("|");
    if (parts.length >= 6) {
      const salon = parts[1];
      const dia = parts[2];
      const horaConflicto = parts[3]; // hora de la clase que ya existe
      const horaIntento = parts[4]; // hora que intentaste poner
      const clase = parts[5];
      const inicioExistente = parts[6] ?? null;
      const finExistente = parts[7] ?? null;
      const fechaObjetivo = parts[8] ?? null;
      const rangoExistente = inicioExistente && finExistente ? `${inicioExistente} a ${finExistente}` : null;

      res.status(409).json({
        error: `Solapamiento detectado en ${salon} el ${dia}. La clase "${clase}" ocupa ${horaConflicto}, pero intentaste usar ${horaIntento}${rangoExistente ? ` (rango: ${rangoExistente})` : ""}${fechaObjetivo ? ` [fecha objetivo: ${fechaObjetivo}]` : ""}.`,
        details: {
          salon,
          dia,
          horaConflictiva: horaConflicto,
          horaIntentada: horaIntento,
          claseConflictiva: clase,
          rangoExistente,
          inicioExistente,
          finExistente,
          fechaObjetivo,
        },
      });
      return true;
    }
  }

  if (messageLower.includes("conflicto de solape:")) {
    const match = /conflicto de solape:\s*salon\s*([^,]+),\s*dia\s*([^,]+),\s*horario\s*([^\s]+)\s*con\s*evento\s*(.+)$/i.exec(message);
    if (match) {
      const salon = match[1]?.trim() ?? "salón";
      const dia = match[2]?.trim() ?? "día";
      const horario = match[3]?.trim() ?? "horario";
      const clase = match[4]?.trim() ?? "otra clase";

      res.status(409).json({
        error: `Solapamiento detectado en ${salon} el ${dia}. La clase "${clase}" ocupa ${horario}.`,
      });
      return true;
    }
  }

  if (message.includes("HORARIO_DUPLICADO_EN_FORMULARIO")) {
    const parts = message.split("|");
    if (parts.length >= 5) {
      const salon = parts[1];
      const dia = parts[2];
      const horas = parts[3];
      const clase = parts[4];

      res.status(400).json({
        error: `Tienes horarios duplicados en el formulario para ${salon} el ${dia} (${horas}) en la clase "${clase}".`,
      });
      return true;
    }
  }

  if (message.includes("FECHAS_INVALIDAS")) {
    const parts = message.split("|");
    const startDate = parts[1] ?? "";
    const endDate = parts[2] ?? "";

    res.status(400).json({
      error: `Rango de fechas invalido: la fecha de inicio (${startDate}) no puede ser mayor que la fecha de fin (${endDate}).`,
    });
    return true;
  }

  // Fallback to simple overlap detection
  if (messageLower.includes("eventos_fechas_chk") || messageLower.includes("violates check constraint \"eventos_fechas_chk\"")) {
    res.status(400).json({
      error: "Rango de fechas invalido: la fecha de inicio no puede ser mayor que la fecha de fin.",
    });
    return true;
  }

  if (messageLower.includes("classslot_no_overlap") || messageLower.includes("overlap") || messageLower.includes("solap")) {
    res.status(409).json({
      error: "La reserva se solapa con otra clase en el mismo salon y horario.",
    });
    return true;
  }

  if (messageLower.includes("iglesia no debe tener facultad_id")) {
    res.status(400).json({
      error: "Las reservas de Iglesia no deben incluir facultad.",
    });
    return true;
  }

  if (messageLower.includes("iglesia no debe tener codigo_materia")) {
    res.status(400).json({
      error: "Las reservas de Iglesia no deben incluir codigo de materia.",
    });
    return true;
  }

  if (messageLower.includes("iglesia requiere actividad")) {
    res.status(400).json({
      error: "Las reservas de Iglesia requieren una actividad.",
    });
    return true;
  }

  return false;
};

schedulesRouter.post("/import-parsed", requireAdminRole, async (req, res, next) => {
  try {
    const parsed = parsedImportSchema.parse(req.body);

    const rows: ParsedScheduleRow[] = parsed.rows.map((row) => ({
      ...row,
      startDate: toLocalDate(row.startDate),
      endDate: toLocalDate(row.endDate),
    }));

    const result = await replaceAllSchedulesFromRows(parsed.sourceFile, rows, parsed.meta);

    // Notificar a todos los clientes que se refresquen
    broadcastScheduleRefresh();

    return res.status(201).json({
      message: "Horario importado correctamente",
      import: {
        id: result.importBatch.id,
        sourceFile: result.importBatch.sourceFile,
        importedAt: result.importBatch.importedAt,
        rowsCount: result.rowsCount,
        classesCount: result.classesCount,
        slotsCount: result.slotsCount,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload de importacion invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (error instanceof Error) {
      console.error("[Schedules Import] Failed", {
        route: "/import-parsed",
        message: error.message,
        stack: error.stack,
      });

      const message = error.message.toLowerCase();
      if (message.includes("no se pudo resolver la facultad")) {
        return res.status(400).json({ error: error.message });
      }

      if (message.includes("el salon") && message.includes("catalogo oficial")) {
        return res.status(400).json({ error: error.message });
      }

      if (message.includes("dia invalido en importacion")) {
        return res.status(400).json({ error: error.message });
      }

      if (message.includes("no se pudo crear el evento")) {
        return res.status(400).json({ error: error.message });
      }

      if (message.includes("overlap") || message.includes("solap")) {
        return res.status(409).json({
          error: "El archivo contiene clases que se solapan en el mismo salon/dia/rango de fechas.",
        });
      }

      return res.status(400).json({
        error: error.message || "No se pudo importar el horario por datos invalidos.",
      });
    }

    return next(error);
  }
});

schedulesRouter.post("/import", requireAdminRole, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Debes enviar un archivo en el campo 'file'" });
    }

    const fallbackDay = typeof req.body?.day === "string" ? req.body.day : undefined;
    const rows = parseScheduleWorkbook(req.file.buffer, { fallbackDay });
    const result = await replaceAllSchedulesFromRows(req.file.originalname, rows);

    // Notificar a todos los clientes que se refresquen
    broadcastScheduleRefresh();

    return res.status(201).json({
      message: "Horario importado correctamente",
      import: {
        id: result.importBatch.id,
        sourceFile: result.importBatch.sourceFile,
        importedAt: result.importBatch.importedAt,
        rowsCount: result.rowsCount,
        classesCount: result.classesCount,
        slotsCount: result.slotsCount,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      console.error("[Schedules Import] Failed", {
        route: "/import",
        message: error.message,
        stack: error.stack,
      });

      const message = error.message.toLowerCase();
      if (message.includes("no se pudo resolver la facultad")) {
        return res.status(400).json({ error: error.message });
      }

      if (message.includes("el salon") && message.includes("catalogo oficial")) {
        return res.status(400).json({ error: error.message });
      }

      if (message.includes("dia invalido en importacion")) {
        return res.status(400).json({ error: error.message });
      }

      if (message.includes("no se pudo crear el evento")) {
        return res.status(400).json({ error: error.message });
      }

      if (message.includes("classslot_no_overlap") || message.includes("overlap") || message.includes("solap")) {
        return res.status(409).json({
          error: "El archivo contiene clases que se solapan en el mismo salon/dia/rango de fechas.",
        });
      }

      return res.status(400).json({
        error: error.message || "No se pudo importar el horario por datos invalidos.",
      });
    }

    return next(error);
  }
});

schedulesRouter.get("/events", async (_req, res, next) => {
  try {
    const events = await getScheduleEvents();
    return res.json({ events });
  } catch (error) {
    return next(error);
  }
});

schedulesRouter.post("/events", requireAdminRole, async (req, res, next) => {
  let parsedPayload: z.infer<typeof createEventSchema> | null = null;

  try {
    const authUser = (req as AuthenticatedRequest).authUser;
    if (!authUser) {
      return res.status(401).json({ error: "No autorizado" });
    }
    const parsed = createEventSchema.parse(req.body);
    parsedPayload = parsed;

    const created = await createScheduleEvent({
      reservationType: parsed.reservationType,
      faculty: parsed.faculty,
      code: parsed.code,
      subject: parsed.subject,
      teacher: parsed.teacher,
      startDate: toLocalDate(parsed.startDate),
      endDate: toLocalDate(parsed.endDate),
      slots: parsed.slots.map((slot) => ({
        day: slot.day,
        room: slot.room,
        startTime: slot.start,
        endTime: slot.end,
      })),
      requestStatus: "aprobada",
      requestedByStaffId: authUser.staffId,
      requestedByName: authUser.name,
      requestedByRole: authUser.role,
    });

    // Notificar sobre nuevo evento
    broadcastScheduleRefresh();

    return res.status(201).json({ message: "Clase creada correctamente", eventId: created.eventId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload de creacion invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (parsedPayload && error instanceof Error) {
      const messageLower = error.message.toLowerCase();
      if (messageLower.includes("classslot_no_overlap") || messageLower.includes("overlap") || messageLower.includes("solap")) {
        const detail = await findCreateEventOverlap(parsedPayload);
        if (detail) {
          return res.status(409).json({
            error: `Solapamiento detectado en ${detail.room} el ${detail.day}. La clase "${detail.subject}" ocupa ${detail.conflictTime}, pero intentaste usar ${detail.requestedTime} (rango: ${detail.conflictRange}).`,
            details: {
              salon: detail.room,
              dia: detail.day,
              claseConflictiva: detail.subject,
              horaConflictiva: detail.conflictTime,
              horaIntentada: detail.requestedTime,
              rangoExistente: detail.conflictRange,
            },
          });
        }
      }
    }

    if (handleKnownScheduleWriteError(error, res)) {
      return;
    }

    return next(error);
  }
});

schedulesRouter.post("/requests", requireAdminOrMonitorRole, async (req, res, next) => {
  try {
    const authUser = (req as AuthenticatedRequest).authUser;
    if (!authUser) {
      return res.status(401).json({ error: "No autorizado" });
    }
    const parsed = createEventSchema.parse(req.body);

    if (parsed.slots.length !== 1) {
      return res.status(400).json({
        error: "Las solicitudes de salón deben enviarse con un único horario.",
      });
    }

    const created = await createScheduleEvent({
      reservationType: parsed.reservationType,
      faculty: parsed.faculty,
      code: parsed.code,
      subject: parsed.subject,
      teacher: parsed.teacher,
      startDate: toLocalDate(parsed.startDate),
      endDate: toLocalDate(parsed.endDate),
      slots: parsed.slots.map((slot) => ({
        day: slot.day,
        room: slot.room,
        startTime: slot.start,
        endTime: slot.end,
      })),
      requestStatus: "pendiente",
      requestedByStaffId: authUser.staffId,
      requestedByName: authUser.name,
      requestedByRole: authUser.role,
    });

    broadcastScheduleRefresh();

    return res.status(201).json({ message: "Solicitud enviada correctamente", eventId: created.eventId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload de solicitud invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownScheduleWriteError(error, res)) {
      return;
    }

    return next(error);
  }
});

schedulesRouter.put("/requests/:requestId", requireAdminOrMonitorRole, async (req, res, next) => {
  try {
    const params = z.object({ requestId: z.string().uuid() }).parse(req.params);
    const authUser = (req as AuthenticatedRequest).authUser;
    if (!authUser) {
      return res.status(401).json({ error: "No autorizado" });
    }

    const parsed = requestEditBodySchema.parse(req.body);
    if (parsed.slots.length !== 1) {
      return res.status(400).json({ error: "Las solicitudes de salón deben tener un único horario." });
    }

    const updated = await updatePendingScheduleRequest(params.requestId, {
      reservationType: parsed.reservationType,
      faculty: parsed.faculty,
      code: parsed.code,
      subject: parsed.subject,
      teacher: parsed.teacher,
      startDate: toLocalDate(parsed.startDate),
      endDate: toLocalDate(parsed.endDate),
      slots: parsed.slots.map((slot) => ({
        day: slot.day,
        room: slot.room,
        startTime: slot.start,
        endTime: slot.end,
      })),
      requestStatus: "pendiente",
      requestedByStaffId: authUser.staffId,
      requestedByName: authUser.name,
      requestedByRole: authUser.role,
    }, {
      staffId: authUser.staffId,
      role: authUser.role as "admin" | "monitor",
      name: authUser.name,
    });

    broadcastScheduleRefresh();

    return res.json({ message: "Solicitud actualizada correctamente", requestId: updated.requestId, eventId: updated.eventId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload de solicitud invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownScheduleWriteError(error, res)) {
      return;
    }

    return next(error);
  }
});

schedulesRouter.delete("/requests/:requestId", requireAdminOrMonitorRole, async (req, res, next) => {
  try {
    const params = z.object({ requestId: z.string().uuid() }).parse(req.params);
    const authUser = (req as AuthenticatedRequest).authUser;
    if (!authUser) {
      return res.status(401).json({ error: "No autorizado" });
    }

    const deleted = await deletePendingScheduleRequest(params.requestId, {
      staffId: authUser.staffId,
      role: authUser.role as "admin" | "monitor",
      name: authUser.name,
    });

    broadcastScheduleRefresh();

    return res.json({ message: "Solicitud eliminada correctamente", requestId: deleted.requestId, eventId: deleted.eventId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownScheduleWriteError(error, res)) {
      return;
    }

    return next(error);
  }
});

schedulesRouter.put("/requests/event/:eventId", requireAdminOrMonitorRole, async (req, res, next) => {
  try {
    const params = z.object({ eventId: z.string().uuid() }).parse(req.params);
    const authUser = (req as AuthenticatedRequest).authUser;
    if (!authUser) {
      return res.status(401).json({ error: "No autorizado" });
    }

    const parsed = requestEditBodySchema.parse(req.body);
    if (parsed.slots.length !== 1) {
      return res.status(400).json({ error: "Las solicitudes de salón deben tener un único horario." });
    }

    const updated = await updatePendingScheduleRequestByEventId(params.eventId, {
      reservationType: parsed.reservationType,
      faculty: parsed.faculty,
      code: parsed.code,
      subject: parsed.subject,
      teacher: parsed.teacher,
      startDate: toLocalDate(parsed.startDate),
      endDate: toLocalDate(parsed.endDate),
      slots: parsed.slots.map((slot) => ({
        day: slot.day,
        room: slot.room,
        startTime: slot.start,
        endTime: slot.end,
      })),
      requestStatus: "pendiente",
      requestedByStaffId: authUser.staffId,
      requestedByName: authUser.name,
      requestedByRole: authUser.role,
    }, {
      staffId: authUser.staffId,
      role: authUser.role as "admin" | "monitor",
      name: authUser.name,
    });

    broadcastScheduleRefresh();

    return res.json({ message: "Solicitud actualizada correctamente", requestId: updated.requestId, eventId: updated.eventId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload de solicitud invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownScheduleWriteError(error, res)) {
      return;
    }

    return next(error);
  }
});

schedulesRouter.delete("/requests/event/:eventId", requireAdminOrMonitorRole, async (req, res, next) => {
  try {
    const params = z.object({ eventId: z.string().uuid() }).parse(req.params);
    const authUser = (req as AuthenticatedRequest).authUser;
    if (!authUser) {
      return res.status(401).json({ error: "No autorizado" });
    }

    const deleted = await deletePendingScheduleRequestByEventId(params.eventId, {
      staffId: authUser.staffId,
      role: authUser.role as "admin" | "monitor",
      name: authUser.name,
    });

    broadcastScheduleRefresh();

    return res.json({ message: "Solicitud eliminada correctamente", requestId: deleted.requestId, eventId: deleted.eventId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownScheduleWriteError(error, res)) {
      return;
    }

    return next(error);
  }
});

schedulesRouter.get("/requests", requireAdminRole, async (_req, res, next) => {
  try {
    const requests = await getPendingScheduleRequests();
    return res.json({ requests });
  } catch (error) {
    return next(error);
  }
});

schedulesRouter.patch("/requests/:requestId/status", requireAdminRole, async (req, res, next) => {
  try {
    const params = z.object({ requestId: z.string().uuid() }).parse(req.params);
    const body = requestStatusSchema.parse(req.body);
    const authUser = (req as AuthenticatedRequest).authUser;
    if (!authUser) {
      return res.status(401).json({ error: "No autorizado" });
    }

    await updateScheduleRequestStatus(params.requestId, body.status, {
      staffId: authUser.staffId,
      name: authUser.name,
      role: authUser.role,
    });

    broadcastScheduleRefresh();

    return res.json({ message: body.status === "aprobada" ? "Solicitud aprobada" : "Solicitud rechazada" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Solicitud invalida: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    return next(error);
  }
});

schedulesRouter.put("/events/:eventId/:slotId", requireAdminRole, async (req, res, next) => {
  try {
    const params = eventSlotParamsSchema.parse(req.params);
    const body = updateEventSchema.parse(req.body);

    if (process.env.NODE_ENV !== "production") {
      console.log("[Schedules][route-put] incoming", {
        eventId: params.eventId,
        slotId: params.slotId,
        updateScope: body.updateScope ?? "always",
        targetDate: body.targetDate ?? null,
        day: body.day,
        room: body.room,
        start: body.start,
        end: body.end,
      });
    }

    const updatePayload = {
      eventId: params.eventId,
      slotId: params.slotId,
      faculty: body.faculty,
      code: body.code,
      subject: body.subject,
      teacher: body.teacher,
      startDate: toLocalDate(body.startDate),
      endDate: toLocalDate(body.endDate),
      day: body.day,
      room: body.room,
      startTime: body.start,
      endTime: body.end,
      ...(body.targetDate ? { targetDate: toLocalDate(body.targetDate) } : {}),
      ...(body.updateScope ? { updateScope: body.updateScope } : {}),
    };

    await updateScheduleEventSlot(updatePayload);

    if (process.env.NODE_ENV !== "production") {
      console.log("[Schedules][route-put] updated", {
        eventId: params.eventId,
        slotId: params.slotId,
        updateScope: updatePayload.updateScope ?? "always",
        targetDate: body.targetDate ?? null,
      });
    }

    // Notificar sobre evento actualizado
    broadcastScheduleRefresh();

    return res.json({ message: "Clase modificada correctamente" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload de actualizacion invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownScheduleWriteError(error, res)) {
      return;
    }

    return next(error);
  }
});

schedulesRouter.delete("/events/:eventId/:slotId", requireAdminRole, async (req, res, next) => {
  try {
    const params = eventSlotParamsSchema.parse(req.params);
    await deleteScheduleEventSlot(params.eventId, params.slotId);

    // Notificar sobre evento eliminado
    broadcastScheduleRefresh();

    return res.json({ message: "Clase eliminada correctamente" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    return next(error);
  }
});

schedulesRouter.get("/rooms", async (_req, res, next) => {
  try {
    const rooms = await getRooms();
    return res.json({ rooms });
  } catch (error) {
    return next(error);
  }
});

schedulesRouter.get("/state", async (_req, res, next) => {
  try {
    const state = await getSharedScheduleState();
    return res.json(state);
  } catch (error) {
    return next(error);
  }
});

schedulesRouter.put("/state/disabled-rooms", requireAdminRole, async (req, res, next) => {
  try {
    const parsed = sharedRoomDisableSchema.parse(req.body);
    const authUser = (req as AuthenticatedRequest).authUser;
    const state = await setSharedRoomDisabledState(parsed.roomName, parsed.disabled, {
      staffId: authUser?.staffId,
      name: authUser?.name,
      role: authUser?.roleLabel,
    });
    broadcastScheduleRefresh();
    return res.json(state);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    return next(error);
  }
});

schedulesRouter.get("/rooms/:roomId/history", async (req, res, next) => {
  try {
    const parsed = roomActionParamsSchema.parse(req.params);
    const history = await getRoomActionHistory(parsed.roomId);
    return res.json({ history });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    return next(error);
  }
});

schedulesRouter.post("/rooms/:roomId/actions/damage", async (req, res, next) => {
  try {
    const params = roomActionParamsSchema.parse(req.params);
    const body = roomDamageBodySchema.parse(req.body);
    const authUser = (req as AuthenticatedRequest).authUser;

    await reportRoomDamage({
      roomId: params.roomId,
      note: body.note,
      actor: {
        staffId: authUser?.staffId,
        name: authUser?.name,
        role: authUser?.roleLabel,
      },
    });

    return res.status(201).json({ message: "Daño reportado correctamente" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    return next(error);
  }
});

schedulesRouter.post("/rooms/:roomId/actions/clean", async (req, res, next) => {
  try {
    const params = roomActionParamsSchema.parse(req.params);
    const authUser = (req as AuthenticatedRequest).authUser;

    await markRoomClean({
      roomId: params.roomId,
      actor: {
        staffId: authUser?.staffId,
        name: authUser?.name,
        role: authUser?.roleLabel,
      },
    });

    return res.status(201).json({ message: "Salon marcado como limpio" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    return next(error);
  }
});

schedulesRouter.put("/state/visual-assignments", requireAdminRole, async (req, res, next) => {
  try {
    const parsed = sharedVisualAssignmentSchema.parse(req.body);
    const state = await upsertSharedVisualRoomAssignment(parsed.eventId, parsed.targetDate, parsed.roomName);
    broadcastScheduleRefresh();
    return res.json(state);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    return next(error);
  }
});

schedulesRouter.delete("/state/visual-assignments", requireAdminRole, async (req, res, next) => {
  try {
    const parsed = sharedVisualAssignmentDeleteSchema.parse(req.body);
    const state = await deleteSharedVisualRoomAssignment(parsed.eventId, parsed.targetDate);
    broadcastScheduleRefresh();
    return res.json(state);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    return next(error);
  }
});

schedulesRouter.get("/rooms/available", async (req, res, next) => {
  try {
    const parsed = availableRoomsQuerySchema.parse(req.query);

    if (toMinutes(parsed.end) <= toMinutes(parsed.start)) {
      return res.status(400).json({ error: "La hora fin debe ser mayor a la hora inicio." });
    }

    const rooms = await findAvailableRooms({
      date: parsed.date,
      day: weekDayFromIsoDate(parsed.date),
      startTime: parsed.start,
      endTime: parsed.end,
      minCapacity: parsed.capacity,
    });

    return res.json({ rooms });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    return next(error);
  }
});

schedulesRouter.get("/imports-history", requireAuthToken, async (_req, res, next) => {
  try {
    const imports = await getImportsHistory();
    return res.json({ imports });
  } catch (error) {
    return next(error);
  }
});

schedulesRouter.delete("/all", requireAdminRole, async (_req, res, next) => {
  try {
    await clearAllSchedules("schedules-ui");
    
    // Notificar sobre borrado completo
    broadcastScheduleRefresh();
    
    return res.json({ message: "Horario eliminado correctamente" });
  } catch (error) {
    return next(error);
  }
});

schedulesRouter.get("/rooms-info", async (_req, res, next) => {
  try {
    const { prisma } = await import("../../lib/prisma");

    // Get today's date for proper comparison
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rows = await prisma.$queryRaw<RoomsInfoRawRow[]>`
      SELECT
        s.id::text AS salon_id,
        s.nombre_bloque AS salon_nombre,
        s.piso AS salon_piso,
        s.capacidad AS salon_capacidad,
        h.dia_semana::text AS dia_semana,
        CASE WHEN h.hora_inicio IS NULL THEN NULL ELSE TO_CHAR(h.hora_inicio, 'HH24:MI') END AS hora_inicio,
        CASE WHEN h.hora_fin IS NULL THEN NULL ELSE TO_CHAR(h.hora_fin, 'HH24:MI') END AS hora_fin,
        e.nombre_principal,
        e.responsable,
        e.codigo_materia,
        f.nombre AS facultad_nombre,
        e.actividad
      FROM public.salones s
      LEFT JOIN public.horarios_evento h
        ON h.salon_id = s.id
        AND EXISTS (
          SELECT 1
          FROM public.eventos e2
          WHERE e2.id = h.evento_id
            AND ${today}::date BETWEEN e2.fecha_inicio AND e2.fecha_fin
        )
      LEFT JOIN public.eventos e ON e.id = h.evento_id
      LEFT JOIN public.facultades f ON f.id = e.facultad_id
      ORDER BY
        s.piso DESC NULLS LAST,
        s.nombre_bloque ASC,
        h.dia_semana ASC NULLS LAST,
        h.hora_inicio ASC NULLS LAST
    `;

    const salonesMap = new Map<string, {
      id: string;
      nombre: string;
      piso: number;
      capacidad: number | null;
      facultad: string | null;
      horarios: Array<{
        diaSemana: string;
        horaInicio: string;
        horaFin: string;
        evento: {
          nombrePrincipal: string | null;
          responsable: string | null;
          codigoMateria: string | null;
          facultad: string | null;
          actividad: string | null;
        };
      }>;
    }>();

    for (const salon of rows) {
      const inferredPiso = salon.salon_piso ?? (() => {
        const match = salon.salon_nombre.match(/(\d{3})/);
        if (match?.[1]) {
          return Number.parseInt(match[1].charAt(0), 10);
        }
        return 0;
      })();

      if (inferredPiso <= 0) {
        continue;
      }

      const existing = salonesMap.get(salon.salon_id);
      if (!existing) {
        salonesMap.set(salon.salon_id, {
          id: salon.salon_id,
          nombre: salon.salon_nombre,
          piso: inferredPiso,
          capacidad: salon.salon_capacidad,
          facultad: salon.facultad_nombre?.trim() || null,
          horarios: [],
        });
      }

      const room = salonesMap.get(salon.salon_id);
      if (room && salon.facultad_nombre?.trim() && !room.facultad) {
        room.facultad = salon.facultad_nombre.trim();
      }

      if (salon.dia_semana && salon.hora_inicio && salon.hora_fin) {
        if (room) {
          const isDuplicateSlot = room.horarios.some(
            (slot) =>
              slot.diaSemana === salon.dia_semana &&
              slot.horaInicio === salon.hora_inicio &&
              slot.horaFin === salon.hora_fin
          );

          if (!isDuplicateSlot) {
            room.horarios.push({
              diaSemana: salon.dia_semana,
              horaInicio: salon.hora_inicio,
              horaFin: salon.hora_fin,
              evento: {
                nombrePrincipal: salon.nombre_principal,
                responsable: salon.responsable,
                codigoMateria: salon.codigo_materia,
                facultad: salon.facultad_nombre,
                actividad: salon.actividad,
              },
            });
          }
        }
      }
    }

    const salonesConPiso = Array.from(salonesMap.values());

    const pisos = new Map<number, typeof salonesConPiso>();
    salonesConPiso.forEach((salon) => {
      const piso = salon.piso;

      if (!pisos.has(piso)) {
        pisos.set(piso, []);
      }
      pisos.get(piso)?.push(salon);
    });

    const roomsByFloor = Array.from(pisos.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, salones]) => salones);

    return res.json({
      success: true,
      totalRooms: salonesConPiso.length,
      floors: pisos.size,
      roomsByFloor,
    });
  } catch (error) {
    console.error("Error fetching rooms-info:", error);
    return next(error);
  }
});
