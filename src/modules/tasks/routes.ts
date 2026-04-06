import { Router } from "express";
import { z } from "zod";
import {
  assignTaskToStaff,
  createHabilidad,
  createTaskCatalog,
  createTaskInstance,
  ensureTasksSchema,
  linkStaffHabilidad,
  listTaskCatalog,
  listTaskInstances,
  listHabilidades,
  listStaffHabilidades,
  markTaskInProgress,
  unlinkStaffHabilidad,
  reviewTaskAssignment,
  sendTaskToReview,
  type TareaEstado,
  type TareaPrioridad,
  type TareaTipo,
} from "./service";

const ADMIN_API_KEY = (process.env.ADMIN_API_KEY ?? "").trim();
const isProduction = process.env.NODE_ENV === "production";

export const tasksRouter = Router();

tasksRouter.use(async (_req, _res, next) => {
  try {
    await ensureTasksSchema();
    return next();
  } catch (error) {
    return next(error);
  }
});

const estadoEnum = ["Pendiente", "En Progreso", "En Revision", "Completada", "Rechazada", "Corregir", "Cancelada"] as const;
const prioridadEnum = ["Baja", "Media", "Alta", "Urgente"] as const;
const tipoEnum = ["Recurrente", "Esporadica"] as const;

const idParamsSchema = z.object({
  id: z.string().uuid(),
});

const createCatalogSchema = z.object({
  nombre: z.string().trim().min(2).max(150),
  tipo: z.enum(tipoEnum),
  habilidadRequeridaId: z.string().uuid().nullable().optional(),
  tiempoEstimadoMin: z.number().int().min(1).max(24 * 60),
  puntosOtorgados: z.number().int().min(0).max(10000),
});

const createHabilidadSchema = z.object({
  nombre: z.string().trim().min(2).max(120),
});

const createInstanceSchema = z.object({
  tareaCatalogoId: z.string().uuid(),
  salonId: z.string().uuid().nullable().optional(),
  detalleAdicional: z.string().trim().max(2000).nullable().optional(),
  prioridad: z.enum(prioridadEnum).default("Media"),
  fechaProgramada: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  horaProgramada: z.string().regex(/^\d{2}:\d{2}$/),
  asignacionAutomatica: z.boolean().default(false),
});

const assignTaskSchema = z.object({
  tareaInstanciaId: z.string().uuid(),
  staffId: z.string().uuid(),
});

const linkStaffHabilidadSchema = z.object({
  staffId: z.string().uuid(),
  habilidadId: z.string().uuid(),
});

const reviewSchema = z.object({
  monitorId: z.string().uuid(),
  decision: z.enum(["aprobar", "rechazar"]),
  observacionesRevision: z.string().trim().max(2000).nullable().optional(),
  rechazoEstado: z.enum(["Rechazada", "Corregir"]).optional(),
});

const requireAdminKey: import("express").RequestHandler = (req, res, next) => {
  if (!isProduction) {
    return next();
  }

  if (!ADMIN_API_KEY) {
    return res.status(503).json({ error: "ADMIN_API_KEY no configurada en backend" });
  }

  const fromHeader = (req.header("x-admin-key") ?? "").trim();
  const fromBearer = (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const provided = fromHeader || fromBearer;

  if (!provided || provided !== ADMIN_API_KEY) {
    return res.status(401).json({ error: "No autorizado" });
  }

  return next();
};

tasksRouter.get("/catalog", async (_req, res, next) => {
  try {
    const tasks = await listTaskCatalog();
    return res.json({ tasks });
  } catch (error) {
    return next(error);
  }
});

tasksRouter.get("/skills", async (_req, res, next) => {
  try {
    const skills = await listHabilidades();
    return res.json({ skills });
  } catch (error) {
    return next(error);
  }
});

tasksRouter.post("/skills", requireAdminKey, async (req, res, next) => {
  try {
    const parsed = createHabilidadSchema.parse(req.body);
    const created = await createHabilidad({ nombre: parsed.nombre });

    return res.status(201).json({
      message: "Habilidad creada correctamente",
      id: created.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    return next(error);
  }
});

tasksRouter.post("/catalog", requireAdminKey, async (req, res, next) => {
  try {
    const parsed = createCatalogSchema.parse(req.body);

    const created = await createTaskCatalog({
      nombre: parsed.nombre,
      tipo: parsed.tipo as TareaTipo,
      habilidadRequeridaId: parsed.habilidadRequeridaId ?? null,
      tiempoEstimadoMin: parsed.tiempoEstimadoMin,
      puntosOtorgados: parsed.puntosOtorgados,
    });

    return res.status(201).json({
      message: "Tarea de catalogo creada correctamente",
      id: created.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    return next(error);
  }
});

tasksRouter.get("/instances", async (req, res, next) => {
  try {
    const estado = typeof req.query.estado === "string" ? req.query.estado : undefined;
    const parsedEstado = estado ? (z.enum(estadoEnum).parse(estado) as TareaEstado) : undefined;

    const tasks = await listTaskInstances(parsedEstado);
    return res.json({ tasks });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    return next(error);
  }
});

tasksRouter.post("/instances", requireAdminKey, async (req, res, next) => {
  try {
    const parsed = createInstanceSchema.parse(req.body);

    const created = await createTaskInstance({
      tareaCatalogoId: parsed.tareaCatalogoId,
      salonId: parsed.salonId ?? null,
      detalleAdicional: parsed.detalleAdicional ?? null,
      prioridad: parsed.prioridad as TareaPrioridad,
      fechaProgramada: parsed.fechaProgramada,
      horaProgramada: parsed.horaProgramada,
      asignacionAutomatica: parsed.asignacionAutomatica,
    });

    return res.status(201).json({
      message: "Instancia de tarea creada correctamente",
      id: created.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    return next(error);
  }
});

tasksRouter.post("/assignments", requireAdminKey, async (req, res, next) => {
  try {
    const parsed = assignTaskSchema.parse(req.body);

    const created = await assignTaskToStaff({
      tareaInstanciaId: parsed.tareaInstanciaId,
      staffId: parsed.staffId,
    });

    return res.status(created.alreadyAssigned ? 200 : 201).json({
      message: created.alreadyAssigned ? "La tarea ya estaba asignada a este staff" : "Tarea asignada correctamente",
      asignacionId: created.asignacionId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    return next(error);
  }
});

tasksRouter.get("/staff-habilidades", async (req, res, next) => {
  try {
    const staffId = typeof req.query.staffId === "string" ? req.query.staffId : undefined;
    if (staffId && !z.string().uuid().safeParse(staffId).success) {
      return res.status(400).json({ error: "Parametros invalidos: staffId debe ser UUID" });
    }

    const links = await listStaffHabilidades(staffId);
    return res.json({ links });
  } catch (error) {
    return next(error);
  }
});

tasksRouter.post("/staff-habilidades", requireAdminKey, async (req, res, next) => {
  try {
    const parsed = linkStaffHabilidadSchema.parse(req.body);
    const created = await linkStaffHabilidad(parsed);

    return res.status(created.alreadyLinked ? 200 : 201).json({
      message: created.alreadyLinked ? "La habilidad ya estaba vinculada" : "Habilidad vinculada correctamente",
      id: created.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    return next(error);
  }
});

tasksRouter.delete("/staff-habilidades/:id", requireAdminKey, async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const deleted = await unlinkStaffHabilidad(id);

    return res.json({
      message: "Vinculo eliminado correctamente",
      id: deleted.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    return next(error);
  }
});

tasksRouter.patch("/assignments/:id/start", async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const updated = await markTaskInProgress(id);

    return res.json({
      message: "Tarea iniciada",
      tareaInstanciaId: updated.tareaInstanciaId,
      estado: "En Progreso",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    return next(error);
  }
});

tasksRouter.patch("/assignments/:id/send-review", async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const updated = await sendTaskToReview(id);

    return res.json({
      message: "Tarea enviada a revision",
      tareaInstanciaId: updated.tareaInstanciaId,
      estado: "En Revision",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    return next(error);
  }
});

tasksRouter.patch("/assignments/:id/review", async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const parsed = reviewSchema.parse(req.body);

    const updated = await reviewTaskAssignment({
      asignacionId: id,
      monitorId: parsed.monitorId,
      aprobar: parsed.decision === "aprobar",
      observacionesRevision: parsed.observacionesRevision ?? null,
      rechazoEstado: parsed.rechazoEstado ?? "Corregir",
    });

    return res.json({
      message: parsed.decision === "aprobar" ? "Tarea aprobada y puntaje aplicado" : "Tarea rechazada para correccion",
      tareaInstanciaId: updated.tareaInstanciaId,
      estado: updated.estado,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    return next(error);
  }
});
