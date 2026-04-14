import { Router } from "express";
import { z } from "zod";
import {
  assignTaskToStaff,
  createTaskSpace,
  createHabilidad,
  createTaskCatalog,
  createTaskInstance,
  deleteTaskCatalog,
  deleteHabilidad,
  ensureTasksSchema,
  linkStaffHabilidad,
  listTaskCatalog,
  listTaskSpaces,
  listTaskInstances,
  listHabilidades,
  listStaffHabilidades,
  markTaskInProgress,
  unlinkStaffHabilidad,
  reviewTaskAssignment,
  sendTaskToReview,
  updateTaskCatalog,
  updateHabilidad,
  type TareaEstado,
  type TareaModoAsignacion,
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
const modoAsignacionEnum = ["manual", "automatica"] as const;
const programacionRecurrenteEnum = ["programada", "diaria_libre"] as const;

const idParamsSchema = z.object({
  id: z.string().uuid(),
});

const createCatalogSchema = z.object({
  nombre: z.string().trim().min(2).max(150),
  tipo: z.enum(tipoEnum),
  sector: z.string().trim().min(2).max(120),
  modoAsignacion: z.enum(modoAsignacionEnum),
  cantidadPersonal: z.number().int().min(1).max(50),
  habilidadesRequeridasIds: z.array(z.string().uuid()).max(30).default([]),
  requerimientos: z.array(z.string().trim().min(2).max(120)).max(20).default([]),
  programacionRecurrente: z.enum(programacionRecurrenteEnum).default("diaria_libre"),
  diasSemana: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  horaProgramada: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  fechaEsporadica: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  horaEsporadica: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  requiereFinalizacion: z.boolean().default(false),
  tareaFinalizacion: z.string().trim().max(200).nullable().optional(),
  fechaFinalizacion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  horaFinalizacion: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  staffAsignadosIds: z.array(z.string().uuid()).max(100).default([]),
  tiempoEstimadoMin: z.number().int().min(1).max(24 * 60),
}).superRefine((value, ctx) => {
  if (value.tipo === "Recurrente" && value.programacionRecurrente === "programada") {
    if (value.diasSemana.length === 0) {
      ctx.addIssue({ code: "custom", path: ["diasSemana"], message: "Selecciona al menos un dia para tareas recurrentes" });
    }
    if (!value.horaProgramada) {
      ctx.addIssue({ code: "custom", path: ["horaProgramada"], message: "Define una hora para tareas recurrentes" });
    }
  }

  if (value.tipo === "Esporadica" && !value.fechaEsporadica) {
    ctx.addIssue({ code: "custom", path: ["fechaEsporadica"], message: "Define una fecha para tareas esporadicas" });
  }

  if (value.tipo === "Esporadica" && !value.horaEsporadica) {
    ctx.addIssue({ code: "custom", path: ["horaEsporadica"], message: "Define una hora para tareas esporadicas" });
  }

  if (value.requiereFinalizacion) {
    if (!value.tareaFinalizacion || value.tareaFinalizacion.trim().length < 2) {
      ctx.addIssue({ code: "custom", path: ["tareaFinalizacion"], message: "Describe la tarea de finalizacion" });
    }
    if (!value.fechaFinalizacion) {
      ctx.addIssue({ code: "custom", path: ["fechaFinalizacion"], message: "Define fecha de finalizacion" });
    }
    if (!value.horaFinalizacion) {
      ctx.addIssue({ code: "custom", path: ["horaFinalizacion"], message: "Define hora de finalizacion" });
    }
  }
});

const createHabilidadSchema = z.object({
  nombre: z.string().trim().min(2).max(120),
});

const updateHabilidadSchema = z.object({
  nombre: z.string().trim().min(2).max(120),
});

const createTaskSpaceSchema = z.object({
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

tasksRouter.get("/spaces", async (_req, res, next) => {
  try {
    const spaces = await listTaskSpaces();
    return res.json({ spaces });
  } catch (error) {
    return next(error);
  }
});

tasksRouter.post("/spaces", requireAdminKey, async (req, res, next) => {
  try {
    const parsed = createTaskSpaceSchema.parse(req.body);
    const created = await createTaskSpace({ nombre: parsed.nombre });

    return res.status(201).json({
      message: "Espacio creado correctamente",
      id: created.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

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

tasksRouter.put("/skills/:id", requireAdminKey, async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const parsed = updateHabilidadSchema.parse(req.body);
    const updated = await updateHabilidad({ id, nombre: parsed.nombre });

    return res.json({
      message: "Habilidad actualizada correctamente",
      id: updated.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    return next(error);
  }
});

tasksRouter.delete("/skills/:id", requireAdminKey, async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const deleted = await deleteHabilidad(id);

    return res.json({
      message: "Habilidad eliminada correctamente",
      id: deleted.id,
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
      sector: parsed.sector,
      modoAsignacion: parsed.modoAsignacion as TareaModoAsignacion,
      cantidadPersonal: parsed.cantidadPersonal,
      habilidadesRequeridasIds: Array.from(new Set(parsed.habilidadesRequeridasIds)),
      requerimientos: Array.from(new Set(parsed.requerimientos.map((item) => item.trim()))),
      diasSemana: parsed.tipo === "Recurrente" && parsed.programacionRecurrente === "programada"
        ? Array.from(new Set(parsed.diasSemana)).sort((a, b) => a - b)
        : [],
      horaProgramada: parsed.tipo === "Recurrente" && parsed.programacionRecurrente === "programada"
        ? (parsed.horaProgramada ?? null)
        : null,
      fechaEsporadica: parsed.fechaEsporadica ?? null,
      horaEsporadica: parsed.tipo === "Esporadica" ? (parsed.horaEsporadica ?? null) : null,
      requiereFinalizacion: parsed.requiereFinalizacion,
      tareaFinalizacion: parsed.requiereFinalizacion ? (parsed.tareaFinalizacion ?? null) : null,
      fechaFinalizacion: parsed.requiereFinalizacion ? (parsed.fechaFinalizacion ?? null) : null,
      horaFinalizacion: parsed.requiereFinalizacion ? (parsed.horaFinalizacion ?? null) : null,
      staffAsignadosIds: Array.from(new Set(parsed.staffAsignadosIds)),
      tiempoEstimadoMin: parsed.tiempoEstimadoMin,
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

tasksRouter.put("/catalog/:id", requireAdminKey, async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const parsed = createCatalogSchema.parse(req.body);

    const updated = await updateTaskCatalog({
      id,
      nombre: parsed.nombre,
      tipo: parsed.tipo as TareaTipo,
      sector: parsed.sector,
      modoAsignacion: parsed.modoAsignacion as TareaModoAsignacion,
      cantidadPersonal: parsed.cantidadPersonal,
      habilidadesRequeridasIds: Array.from(new Set(parsed.habilidadesRequeridasIds)),
      requerimientos: Array.from(new Set(parsed.requerimientos.map((item) => item.trim()))),
      diasSemana: parsed.tipo === "Recurrente" && parsed.programacionRecurrente === "programada"
        ? Array.from(new Set(parsed.diasSemana)).sort((a, b) => a - b)
        : [],
      horaProgramada: parsed.tipo === "Recurrente" && parsed.programacionRecurrente === "programada"
        ? (parsed.horaProgramada ?? null)
        : null,
      fechaEsporadica: parsed.fechaEsporadica ?? null,
      horaEsporadica: parsed.tipo === "Esporadica" ? (parsed.horaEsporadica ?? null) : null,
      requiereFinalizacion: parsed.requiereFinalizacion,
      tareaFinalizacion: parsed.requiereFinalizacion ? (parsed.tareaFinalizacion ?? null) : null,
      fechaFinalizacion: parsed.requiereFinalizacion ? (parsed.fechaFinalizacion ?? null) : null,
      horaFinalizacion: parsed.requiereFinalizacion ? (parsed.horaFinalizacion ?? null) : null,
      staffAsignadosIds: Array.from(new Set(parsed.staffAsignadosIds)),
      tiempoEstimadoMin: parsed.tiempoEstimadoMin,
    });

    return res.json({
      message: "Tarea de catalogo actualizada correctamente",
      id: updated.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    return next(error);
  }
});

tasksRouter.delete("/catalog/:id", requireAdminKey, async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const deleted = await deleteTaskCatalog(id);

    return res.json({
      message: "Tarea de catalogo eliminada correctamente",
      id: deleted.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}` });
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
      message: parsed.decision === "aprobar" ? "Tarea aprobada" : "Tarea rechazada para correccion",
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
