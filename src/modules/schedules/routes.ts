import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { parseScheduleWorkbook } from "./parser";
import { ParsedScheduleRow } from "./types";
import { broadcastScheduleRefresh } from "../../lib/websocket";
import {
  clearAllSchedules,
  createScheduleEvent,
  deleteScheduleEventSlot,
  findAvailableRooms,
  getImportsHistory,
  getRooms,
  getScheduleEvents,
  replaceAllSchedulesFromRows,
  updateScheduleEventSlot,
} from "./service";

const ADMIN_API_KEY = (process.env.ADMIN_API_KEY ?? "").trim();
const isProduction = process.env.NODE_ENV === "production";

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
  rows: z.array(parsedRowSchema).min(1),
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
});

const availableRoomsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  capacity: z.coerce.number().int().min(1).max(1000),
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

  const message = error.message.toLowerCase();

  if (message.includes("classslot_no_overlap") || message.includes("overlap") || message.includes("solap")) {
    res.status(409).json({
      error: "La reserva se solapa con otra clase en el mismo salon y horario.",
    });
    return true;
  }

  if (message.includes("iglesia no debe tener facultad_id")) {
    res.status(400).json({
      error: "Las reservas de Iglesia no deben incluir facultad.",
    });
    return true;
  }

  if (message.includes("iglesia no debe tener codigo_materia")) {
    res.status(400).json({
      error: "Las reservas de Iglesia no deben incluir codigo de materia.",
    });
    return true;
  }

  if (message.includes("iglesia requiere actividad")) {
    res.status(400).json({
      error: "Las reservas de Iglesia requieren una actividad.",
    });
    return true;
  }

  return false;
};

const requireAdminKey: import("express").RequestHandler = (req, res, next) => {
  // Solo requiere API key en producción
  if (!isProduction) {
    return next();
  }

  if (!ADMIN_API_KEY) {
    return res.status(503).json({
      error: "ADMIN_API_KEY no configurada en backend",
    });
  }

  const fromHeader = (req.header("x-admin-key") ?? "").trim();
  const fromBearer = (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const provided = fromHeader || fromBearer;

  if (!provided || provided !== ADMIN_API_KEY) {
    return res.status(401).json({ error: "No autorizado" });
  }

  return next();
};

schedulesRouter.post("/import-parsed", requireAdminKey, async (req, res, next) => {
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
      const message = error.message.toLowerCase();
      if (message.includes("overlap") || message.includes("solap")) {
        return res.status(409).json({
          error: "El archivo contiene clases que se solapan en el mismo salon/dia/rango de fechas.",
        });
      }
    }

    return next(error);
  }
});

schedulesRouter.post("/import", requireAdminKey, upload.single("file"), async (req, res, next) => {
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
      const message = error.message.toLowerCase();
      if (message.includes("classslot_no_overlap") || message.includes("overlap") || message.includes("solap")) {
        return res.status(409).json({
          error: "El archivo contiene clases que se solapan en el mismo salon/dia/rango de fechas.",
        });
      }
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

schedulesRouter.post("/events", requireAdminKey, async (req, res, next) => {
  try {
    const parsed = createEventSchema.parse(req.body);

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

    if (handleKnownScheduleWriteError(error, res)) {
      return;
    }

    return next(error);
  }
});

schedulesRouter.put("/events/:eventId/:slotId", requireAdminKey, async (req, res, next) => {
  try {
    const params = eventSlotParamsSchema.parse(req.params);
    const body = updateEventSchema.parse(req.body);

    await updateScheduleEventSlot({
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
    });

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

schedulesRouter.delete("/events/:eventId/:slotId", requireAdminKey, async (req, res, next) => {
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

schedulesRouter.get("/imports-history", async (_req, res, next) => {
  try {
    const imports = await getImportsHistory();
    return res.json({ imports });
  } catch (error) {
    return next(error);
  }
});

schedulesRouter.delete("/all", requireAdminKey, async (_req, res, next) => {
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
        e.actividad
      FROM public.salones s
      LEFT JOIN public.horarios_evento h ON h.salon_id = s.id
      LEFT JOIN public.eventos e ON e.id = h.evento_id AND e.fecha_fin >= ${today}::date
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
      horarios: Array<{
        diaSemana: string;
        horaInicio: string;
        horaFin: string;
        evento: {
          nombrePrincipal: string | null;
          responsable: string | null;
          codigoMateria: string | null;
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
          horarios: [],
        });
      }

      if (salon.dia_semana && salon.hora_inicio && salon.hora_fin) {
        const room = salonesMap.get(salon.salon_id);
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
