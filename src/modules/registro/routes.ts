import { Router } from "express";
import { z } from "zod";
import { type AuthenticatedRequest, requireAdminOrRegistroRole } from "../../lib/auth";
import {
  AttendanceError,
  getAttendanceDashboard,
  getAttendanceReport,
  getAttendancePreviewByCedula,
  registerAttendanceEntryByCedula,
  registerAttendanceExitByCedula,
} from "./service";

const cedulaSchema = z.object({
  cedula: z.string().trim().min(5).max(20),
});

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener formato YYYY-MM-DD");

export const registroRouter = Router();

registroRouter.get("/dashboard", requireAdminOrRegistroRole, async (_req, res, next) => {
  try {
    const dashboard = await getAttendanceDashboard();
    return res.json({ dashboard });
  } catch (error) {
    if (error instanceof AttendanceError) {
      return res.status(error.status).json({ error: error.message });
    }

    return next(error);
  }
});

registroRouter.get("/report", requireAdminOrRegistroRole, async (req, res, next) => {
  try {
    const fromDate = dateSchema.parse(req.query.desde);
    const toDate = dateSchema.parse(req.query.hasta);
    if (fromDate > toDate) {
      return res.status(400).json({ error: "La fecha inicial no puede ser posterior a la fecha final." });
    }

    const from = new Date(`${fromDate}T00:00:00Z`);
    const to = new Date(`${toDate}T00:00:00Z`);
    const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (days > 366) {
      return res.status(400).json({ error: "El periodo máximo de descarga es de 366 días." });
    }

    const registros = await getAttendanceReport(fromDate, toDate);
    return res.json({ registros });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message ?? "Fechas invalidas." });
    }
    if (error instanceof AttendanceError) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
});

registroRouter.post("/auto", requireAdminOrRegistroRole, async (req, res, next) => {
  try {
    const { cedula } = cedulaSchema.parse(req.body);
    const authUser = (req as AuthenticatedRequest).authUser;
    const preview = await getAttendancePreviewByCedula(cedula);

    if (preview.registroAbierto && preview.puedeRegistrarSalida) {
      const result = await registerAttendanceExitByCedula(cedula, authUser?.staffId ?? "");
      return res.json(result);
    }

    if (!preview.registroAbierto && preview.puedeRegistrarEntrada) {
      const result = await registerAttendanceEntryByCedula(cedula, authUser?.staffId ?? "");
      return res.json(result);
    }

    return res.json({ preview, mensaje: preview.mensaje, alerta: null });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }
    if (error instanceof AttendanceError) {
      return res.status(error.status).json({ error: error.message });
    }
    return next(error);
  }
});

registroRouter.get("/preview", requireAdminOrRegistroRole, async (req, res, next) => {
  try {
    const { cedula } = cedulaSchema.parse(req.query);
    const preview = await getAttendancePreviewByCedula(cedula);
    return res.json({ preview });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (error instanceof AttendanceError) {
      return res.status(error.status).json({ error: error.message });
    }

    return next(error);
  }
});

registroRouter.post("/entrada", requireAdminOrRegistroRole, async (req, res, next) => {
  try {
    const { cedula } = cedulaSchema.parse(req.body);
    const authUser = (req as AuthenticatedRequest).authUser;
    const result = await registerAttendanceEntryByCedula(cedula, authUser?.staffId ?? "");
    return res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (error instanceof AttendanceError) {
      return res.status(error.status).json({ error: error.message });
    }

    return next(error);
  }
});

registroRouter.post("/salida", requireAdminOrRegistroRole, async (req, res, next) => {
  try {
    const { cedula } = cedulaSchema.parse(req.body);
    const authUser = (req as AuthenticatedRequest).authUser;
    const result = await registerAttendanceExitByCedula(cedula, authUser?.staffId ?? "");
    return res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (error instanceof AttendanceError) {
      return res.status(error.status).json({ error: error.message });
    }

    return next(error);
  }
});
