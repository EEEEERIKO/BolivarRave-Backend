import { Router } from "express";
import { z } from "zod";
import { type AuthenticatedRequest, requireAdminOrRegistroRole } from "../../lib/auth";
import {
  AttendanceError,
  getAttendanceDashboard,
  getAttendancePreviewByCedula,
  registerAttendanceAutomaticallyByCedula,
  registerAttendanceEntryByCedula,
  registerAttendanceExitByCedula,
} from "./service";

const cedulaSchema = z.object({
  cedula: z.string().trim().min(5).max(20),
});

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

registroRouter.post("/auto", requireAdminOrRegistroRole, async (req, res, next) => {
  try {
    const { cedula } = cedulaSchema.parse(req.body);
    const authUser = (req as AuthenticatedRequest).authUser;
    const result = await registerAttendanceAutomaticallyByCedula(cedula, authUser?.staffId ?? "");
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
