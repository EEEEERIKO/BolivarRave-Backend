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
  getImportsHistory,
  getRooms,
  getScheduleEvents,
  replaceAllSchedulesFromRows,
  updateScheduleEventSlot,
} from "./service";

const ADMIN_API_KEY = (process.env.ADMIN_API_KEY ?? "").trim();

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

const toLocalDate = (isoDate: string) => {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
};

const requireAdminKey: import("express").RequestHandler = (req, res, next) => {
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
    
    // Obtener todas las salas con sus horarios
    const salones = await prisma.salon.findMany({
      select: {
        id: true,
        nombre: true,
        piso: true,
        capacidad: true,
        horarios: {
          select: {
            diaSemana: true,
            horaInicio: true,
            horaFin: true,
            evento: {
              select: {
                nombrePrincipal: true,
                responsable: true,
                codigoMateria: true,
                actividad: true,
              },
            },
          },
          where: {
            evento: {
              fechaFin: {
                gte: today,
              },
            },
          },
        },
      },
      orderBy: [
        { piso: "desc" },
        { nombre: "asc" },
      ],
    });

    // Asignar piso automáticamente si es null (extrayendo del nombre)
    const salonesConPiso = salones
      .map((salon) => {
        if (salon.piso !== null) {
          return salon;
        }
        // Si piso es null, intenta extraer del nombre (ej: "Aula 101" → piso 1)
        const match = salon.nombre.match(/(\d{3})/);
        if (match && match[1]) {
          const pisoFromName = parseInt(match[1].charAt(0));
          return { ...salon, piso: pisoFromName };
        }
        return { ...salon, piso: 0 }; // 0 para filtrar después
      })
      .filter((salon) => salon.piso !== null && salon.piso > 0);

    // Agrupar por piso
    const pisos = new Map<number, typeof salonesConPiso>();
    salonesConPiso.forEach((salon) => {
      const piso = salon.piso!;

      if (!pisos.has(piso)) {
        pisos.set(piso, []);
      }
      pisos.get(piso)?.push(salon);
    });

    // Convertir a array ordenado
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
