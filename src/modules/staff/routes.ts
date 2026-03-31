import { Router } from "express";
import { z } from "zod";
import { broadcastScheduleRefresh } from "../../lib/websocket";
import {
  createStaff,
  deleteStaff,
  getStaffById,
  listStaff,
  updateStaff,
  updateStaffEstado,
  type StaffEstado,
} from "./service";

const ADMIN_API_KEY = (process.env.ADMIN_API_KEY ?? "").trim();
const isProduction = process.env.NODE_ENV === "production";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const timeRegex = /^\d{2}:\d{2}$/;
const weekDays = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"] as const;
const contractPlans = ["Plan 1", "Plan 2", "Plan 3", "Plan Monitoria", "Plan Especial"] as const;

export const staffRouter = Router();

const idParamsSchema = z.object({
  id: z.string().uuid(),
});

const bloqueoClaseSchema = z.object({
  diaSemana: z.enum(weekDays),
  horaInicio: z.string().regex(timeRegex, "Hora inicio invalida (HH:mm)"),
  horaFin: z.string().regex(timeRegex, "Hora fin invalida (HH:mm)"),
});

const createUpdateStaffBodySchema = z.object({
  numeroStaff: z.number().int().min(1).max(999999),
  roleId: z.number().int().min(1).default(3),
  rol: z.string().trim().min(2).max(100),
  nombres: z.string().trim().min(2).max(150),
  apellidos: z.string().trim().min(2).max(150),
  cedula: z.string().trim().min(5).max(20),
  telefono: z.string().trim().min(7).max(20),
  fechaNacimiento: z.string().regex(dateRegex, "Fecha nacimiento invalida (YYYY-MM-DD)"),
  carrera: z.string().trim().min(2).max(150),
  tipoContrato: z.enum(contractPlans),
  conocimientoSonido: z.boolean().default(false),
  estado: z.enum(["Active", "Inactive"]).default("Active"),
  balanceHoras: z.number().min(-10000).max(10000).default(0),
  bloqueosClase: z.array(bloqueoClaseSchema).default([]),
});

const patchEstadoBodySchema = z.object({
  estado: z.enum(["Active", "Inactive"]),
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

const toLocalDate = (isoDate: string) => {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
};

const toMinutes = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
};

const validateBloqueosNoOverlap = (bloqueosClase: Array<{ diaSemana: string; horaInicio: string; horaFin: string }>) => {
  for (const [i, left] of bloqueosClase.entries()) {
    if (toMinutes(left.horaFin) <= toMinutes(left.horaInicio)) {
      throw new Error(`El bloque ${i + 1} tiene hora fin menor o igual a hora inicio`);
    }

    for (const [j, right] of bloqueosClase.entries()) {
      if (j <= i) continue;
      if (left.diaSemana !== right.diaSemana) continue;

      const overlap = toMinutes(left.horaInicio) < toMinutes(right.horaFin) &&
        toMinutes(right.horaInicio) < toMinutes(left.horaFin);

      if (overlap) {
        throw new Error(
          `Hay solape entre bloques de clase en ${left.diaSemana} (${left.horaInicio}-${left.horaFin} y ${right.horaInicio}-${right.horaFin})`,
        );
      }
    }
  }
};

const handleKnownStaffWriteError = (error: unknown, res: import("express").Response) => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  if (message.includes("no se encontro el staff")) {
    res.status(404).json({ error: "El staff solicitado no existe." });
    return true;
  }

  if (message.includes("staff_numero_staff_uq") || message.includes("numero_staff")) {
    res.status(409).json({ error: "El numero de staff ya existe." });
    return true;
  }

  if (message.includes("staff_cedula_uq") || message.includes("cedula")) {
    res.status(409).json({ error: "La cedula ya existe." });
    return true;
  }

  if (message.includes("solape")) {
    res.status(400).json({ error: "Hay solape entre bloques de horario no disponible." });
    return true;
  }

  return false;
};

staffRouter.get("/", async (_req, res, next) => {
  try {
    const staff = await listStaff();
    return res.json({ staff });
  } catch (error) {
    return next(error);
  }
});

staffRouter.get("/:id", async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const staff = await getStaffById(id);

    if (!staff) {
      return res.status(404).json({ error: "El staff solicitado no existe." });
    }

    return res.json({ staff });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    return next(error);
  }
});

staffRouter.post("/", requireAdminKey, async (req, res, next) => {
  try {
    const parsed = createUpdateStaffBodySchema.parse(req.body);
    validateBloqueosNoOverlap(parsed.bloqueosClase);

    const created = await createStaff({
      numeroStaff: parsed.numeroStaff,
      roleId: parsed.roleId,
      rol: parsed.rol,
      nombres: parsed.nombres,
      apellidos: parsed.apellidos,
      cedula: parsed.cedula,
      telefono: parsed.telefono,
      fechaNacimiento: toLocalDate(parsed.fechaNacimiento),
      carrera: parsed.carrera,
      tipoContrato: parsed.tipoContrato,
      conocimientoSonido: parsed.conocimientoSonido,
      estado: parsed.estado as StaffEstado,
      balanceHoras: parsed.balanceHoras,
      bloqueosClase: parsed.bloqueosClase,
    });

    broadcastScheduleRefresh();

    return res.status(201).json({
      message: "Staff creado correctamente",
      staffId: created.staffId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownStaffWriteError(error, res)) {
      return;
    }

    return next(error);
  }
});

staffRouter.put("/:id", requireAdminKey, async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const parsed = createUpdateStaffBodySchema.parse(req.body);
    validateBloqueosNoOverlap(parsed.bloqueosClase);

    const updated = await updateStaff({
      id,
      numeroStaff: parsed.numeroStaff,
      roleId: parsed.roleId,
      rol: parsed.rol,
      nombres: parsed.nombres,
      apellidos: parsed.apellidos,
      cedula: parsed.cedula,
      telefono: parsed.telefono,
      fechaNacimiento: toLocalDate(parsed.fechaNacimiento),
      carrera: parsed.carrera,
      tipoContrato: parsed.tipoContrato,
      conocimientoSonido: parsed.conocimientoSonido,
      estado: parsed.estado as StaffEstado,
      balanceHoras: parsed.balanceHoras,
      bloqueosClase: parsed.bloqueosClase,
    });

    broadcastScheduleRefresh();

    return res.json({
      message: "Staff actualizado correctamente",
      staffId: updated.staffId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownStaffWriteError(error, res)) {
      return;
    }

    return next(error);
  }
});

staffRouter.patch("/:id/estado", requireAdminKey, async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const { estado } = patchEstadoBodySchema.parse(req.body);

    const updated = await updateStaffEstado(id, estado as StaffEstado);

    broadcastScheduleRefresh();

    return res.json({
      message: "Estado de staff actualizado correctamente",
      staffId: updated.staffId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownStaffWriteError(error, res)) {
      return;
    }

    return next(error);
  }
});

staffRouter.delete("/:id", requireAdminKey, async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);

    const deleted = await deleteStaff(id);

    broadcastScheduleRefresh();

    return res.json({
      message: "Staff eliminado correctamente",
      staffId: deleted.staffId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownStaffWriteError(error, res)) {
      return;
    }

    return next(error);
  }
});
