import { Router } from "express";
import { z } from "zod";
import { requireAdminOrMonitorRole, requireAdminRole, requireAuthToken, type AuthenticatedRequest } from "../../lib/auth";
import { broadcastScheduleRefresh } from "../../lib/websocket";
import {
  buildReservasAuditorioHistoryExcel,
  createReservaAuditorio,
  createPendingAuditorioSolicitud,
  deleteReservaAuditorio,
  listUpcomingAuditorioNotifications,
  listReservasAuditorio,
  updateEstadoReservaAuditorio,
  updateReservaAuditorio,
  type AuditorioEstado,
} from "./service";

export const auditorioRouter = Router();

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const timeRegex = /^\d{2}:\d{2}$/;

const horarioSchema = z.object({
  fechaEspecifica: z.string().regex(dateRegex, "Fecha especifica invalida (YYYY-MM-DD)"),
  horaInicio: z.string().regex(timeRegex, "Hora inicio invalida (HH:mm)"),
  horaFin: z.string().regex(timeRegex, "Hora fin invalida (HH:mm)"),
});

const reservaBodySchema = z.object({
  nombreEvento: z.string().trim().min(3).max(255),
  organizador: z.string().trim().min(3).max(200),
  fechaInicioPeriodo: z.string().regex(dateRegex, "Fecha inicio invalida (YYYY-MM-DD)"),
  fechaFinPeriodo: z.string().regex(dateRegex, "Fecha fin invalida (YYYY-MM-DD)"),
  numeroAsistentes: z.number().int().min(1).max(5000),
  requierePantalla: z.boolean().default(false),
  requiereSonido: z.boolean().default(false),
  requiereMonitor: z.boolean().default(false),
  requiereProyector: z.boolean().default(false),
  requiereFiltroAgua: z.boolean().default(false),
  encargadoStaffIds: z.array(z.string().uuid()).default([]),
  observaciones: z.string().trim().max(4000).optional().nullable(),
  estado: z.enum(["Pendiente", "Aprobada", "Cancelada"]).default("Pendiente"),
  horarios: z.array(horarioSchema).min(1),
});

const publicReservaBodySchema = z.object({
  nombreEvento: z.string().trim().min(3).max(255),
  correo: z.string().trim().email(),
  confirmarCorreo: z.string().trim().email(),
  fechaInicioPeriodo: z.string().regex(dateRegex, "Fecha inicio invalida (YYYY-MM-DD)"),
  fechaFinPeriodo: z.string().regex(dateRegex, "Fecha fin invalida (YYYY-MM-DD)"),
  numeroAsistentes: z.number().int().min(1).max(5000),
  requierePantalla: z.boolean().default(false),
  requiereSonido: z.boolean().default(false),
  requiereMonitor: z.boolean().default(false),
  requiereProyector: z.boolean().default(false),
  requiereFiltroAgua: z.boolean().default(false),
  observaciones: z.string().trim().max(4000).optional().nullable(),
  horarios: z.array(horarioSchema).min(1),
});

const idParamsSchema = z.object({
  id: z.string().uuid(),
});

const patchEstadoBodySchema = z.object({
  estado: z.enum(["Pendiente", "Aprobada", "Cancelada"]),
});

const toLocalDate = (isoDate: string) => {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
};

const toDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const getColombiaToday = () => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "1");
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "1");

  return new Date(year, month - 1, day);
};

const validatePublicAdvanceNotice = (
  fechaInicioPeriodo: string,
  horarios: Array<{ fechaEspecifica: string; horaInicio: string; horaFin: string }>
) => {
  const minimumDateKey = toDateKey(new Date(getColombiaToday().getFullYear(), getColombiaToday().getMonth(), getColombiaToday().getDate() + 8));

  if (fechaInicioPeriodo < minimumDateKey) {
    throw new Error("La solicitud debe hacerse con al menos 8 días de anticipación.");
  }

  for (const horario of horarios) {
    if (horario.fechaEspecifica < minimumDateKey) {
      throw new Error("La solicitud debe hacerse con al menos 8 días de anticipación.");
    }
  }
};

const toMinutes = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
};

const validateHorariosNoOverlap = (
  horarios: Array<{ fechaEspecifica: string; horaInicio: string; horaFin: string }>
) => {
  for (const [i, left] of horarios.entries()) {

    if (toMinutes(left.horaFin) <= toMinutes(left.horaInicio)) {
      throw new Error(`El bloque ${i + 1} tiene hora fin menor o igual a hora inicio`);
    }

    for (const [j, right] of horarios.entries()) {
      if (j <= i) continue;
      if (left.fechaEspecifica !== right.fechaEspecifica) continue;

      const overlap = toMinutes(left.horaInicio) < toMinutes(right.horaFin) &&
        toMinutes(right.horaInicio) < toMinutes(left.horaFin);

      if (overlap) {
        throw new Error(
          `Hay solape entre bloques intercalados en ${left.fechaEspecifica} (${left.horaInicio}-${left.horaFin} y ${right.horaInicio}-${right.horaFin})`
        );
      }
    }
  }
};

const validatePeriodConsistency = (
  fechaInicioPeriodo: string,
  fechaFinPeriodo: string,
  horarios: Array<{ fechaEspecifica: string; horaInicio: string; horaFin: string }>
) => {
  const periodStart = toLocalDate(fechaInicioPeriodo).getTime();
  const periodEnd = toLocalDate(fechaFinPeriodo).getTime();

  if (periodEnd < periodStart) {
    throw new Error("La fecha de fin del periodo debe ser mayor o igual a la fecha de inicio");
  }

  for (const [i, horario] of horarios.entries()) {
    const blockDate = toLocalDate(horario.fechaEspecifica).getTime();
    if (blockDate < periodStart || blockDate > periodEnd) {
      throw new Error(
        `La fecha del bloque ${i + 1} (${horario.fechaEspecifica}) no esta dentro del periodo general`
      );
    }
  }
};

const handleKnownAuditorioWriteError = (error: unknown, res: import("express").Response) => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  if (message.includes("conflicto auditorio") || message.includes("solape")) {
    res.status(409).json({
      error: "El auditorio ya esta reservado para uno de los horarios seleccionados.",
    });
    return true;
  }

  if (message.includes("no se encontro la reserva de auditorio")) {
    res.status(404).json({
      error: "La reserva de auditorio no existe.",
    });
    return true;
  }

  if (message.includes("la fecha") && message.includes("debe estar dentro del periodo")) {
    res.status(400).json({
      error: "Las fechas intercaladas deben estar dentro del periodo de la reserva.",
    });
    return true;
  }

  if (message.includes("staff_encargado_invalido")) {
    res.status(400).json({
      error: "Uno o más encargados seleccionados no existen en personal.",
    });
    return true;
  }

  return false;
};

const toPublicReserva = (reserva: Awaited<ReturnType<typeof listReservasAuditorio>>[number]) => ({
  id: reserva.id,
  fechaInicioPeriodo: reserva.fechaInicioPeriodo,
  fechaFinPeriodo: reserva.fechaFinPeriodo,
  horarios: reserva.horarios.map((horario) => ({
    id: horario.id,
    fechaEspecifica: horario.fechaEspecifica,
    horaInicio: horario.horaInicio,
    horaFin: horario.horaFin,
  })),
});

auditorioRouter.get("/reservas", async (_req, res, next) => {
  try {
    const reservas = await listReservasAuditorio();
    return res.json({ reservas });
  } catch (error) {
    return next(error);
  }
});

auditorioRouter.get("/public/reservas", async (_req, res, next) => {
  try {
    const reservas = await listReservasAuditorio();
    return res.json({ reservas: reservas.map(toPublicReserva) });
  } catch (error) {
    return next(error);
  }
});

auditorioRouter.get("/notifications/upcoming", requireAuthToken, async (req, res, next) => {
  try {
    const authUser = (req as AuthenticatedRequest).authUser;
    const notifications = await listUpcomingAuditorioNotifications({
      assignedStaffId: authUser?.role === "colaborador" ? authUser.staffId : undefined,
    });
    return res.json({ notifications });
  } catch (error) {
    return next(error);
  }
});

auditorioRouter.get("/reservas/export", requireAdminOrMonitorRole, async (_req, res, next) => {
  try {
    const { buffer, fileName } = await buildReservasAuditorioHistoryExcel();

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
    res.setHeader("Content-Length", String(buffer.length));

    return res.status(200).send(buffer);
  } catch (error) {
    return next(error);
  }
});

auditorioRouter.post("/reservas", async (req, res, next) => {
  try {
    const parsed = reservaBodySchema.parse(req.body);

    validatePeriodConsistency(parsed.fechaInicioPeriodo, parsed.fechaFinPeriodo, parsed.horarios);
    validateHorariosNoOverlap(parsed.horarios);

    const created = await createReservaAuditorio({
      nombreEvento: parsed.nombreEvento,
      organizador: parsed.organizador,
      fechaInicioPeriodo: toLocalDate(parsed.fechaInicioPeriodo),
      fechaFinPeriodo: toLocalDate(parsed.fechaFinPeriodo),
      numeroAsistentes: parsed.numeroAsistentes,
      requierePantalla: parsed.requierePantalla,
      requiereSonido: parsed.requiereSonido,
      requiereMonitor: parsed.requiereMonitor,
      requiereProyector: parsed.requiereProyector,
      requiereFiltroAgua: parsed.requiereFiltroAgua,
      encargadoStaffIds: Array.from(new Set(parsed.encargadoStaffIds)),
      observaciones: parsed.observaciones ?? null,
      estado: parsed.estado as AuditorioEstado,
      horarios: parsed.horarios.map((h) => ({
        fechaEspecifica: toLocalDate(h.fechaEspecifica),
        horaInicio: h.horaInicio,
        horaFin: h.horaFin,
      })),
    });

    // Create an admin notification record so admins see the pending request immediately
    try {
      await createPendingAuditorioSolicitud(created.reservaId, parsed.correo ?? null, "public", null);
    } catch (e) {
      // Non-fatal: if notification creation fails, proceed but log error
      console.error("Failed to create pending auditorio solicitud:", e);
    }

    broadcastScheduleRefresh();

    return res.status(201).json({
      message: "Reserva de auditorio creada correctamente",
      reservaId: created.reservaId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownAuditorioWriteError(error, res)) {
      return;
    }

    return next(error);
  }
});

auditorioRouter.post("/public/reservas", async (req, res, next) => {
  try {
    const parsed = publicReservaBodySchema.parse(req.body);

    if (parsed.correo.trim().toLowerCase() !== parsed.confirmarCorreo.trim().toLowerCase()) {
      return res.status(400).json({ error: "Los correos no coinciden." });
    }

    validatePeriodConsistency(parsed.fechaInicioPeriodo, parsed.fechaFinPeriodo, parsed.horarios);
    validatePublicAdvanceNotice(parsed.fechaInicioPeriodo, parsed.horarios);
    validateHorariosNoOverlap(parsed.horarios);

    const created = await createReservaAuditorio({
      nombreEvento: parsed.nombreEvento,
      organizador: parsed.correo,
      fechaInicioPeriodo: toLocalDate(parsed.fechaInicioPeriodo),
      fechaFinPeriodo: toLocalDate(parsed.fechaFinPeriodo),
      numeroAsistentes: parsed.numeroAsistentes,
      requierePantalla: parsed.requierePantalla,
      requiereSonido: parsed.requiereSonido,
      requiereMonitor: parsed.requiereMonitor,
      requiereProyector: parsed.requiereProyector,
      requiereFiltroAgua: parsed.requiereFiltroAgua,
      encargadoStaffIds: [],
      observaciones: parsed.observaciones ?? null,
      estado: "Pendiente",
      horarios: parsed.horarios.map((h) => ({
        fechaEspecifica: toLocalDate(h.fechaEspecifica),
        horaInicio: h.horaInicio,
        horaFin: h.horaFin,
      })),
    });

    broadcastScheduleRefresh();

    return res.status(201).json({
      message: "Solicitud de reserva creada correctamente",
      reservaId: created.reservaId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownAuditorioWriteError(error, res)) {
      return;
    }

    return next(error);
  }
});

auditorioRouter.put("/reservas/:id", requireAdminRole, async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const parsed = reservaBodySchema.parse(req.body);

    validatePeriodConsistency(parsed.fechaInicioPeriodo, parsed.fechaFinPeriodo, parsed.horarios);
    validateHorariosNoOverlap(parsed.horarios);

    const updated = await updateReservaAuditorio({
      id,
      nombreEvento: parsed.nombreEvento,
      organizador: parsed.organizador,
      fechaInicioPeriodo: toLocalDate(parsed.fechaInicioPeriodo),
      fechaFinPeriodo: toLocalDate(parsed.fechaFinPeriodo),
      numeroAsistentes: parsed.numeroAsistentes,
      requierePantalla: parsed.requierePantalla,
      requiereSonido: parsed.requiereSonido,
      requiereMonitor: parsed.requiereMonitor,
      requiereProyector: parsed.requiereProyector,
      requiereFiltroAgua: parsed.requiereFiltroAgua,
      encargadoStaffIds: Array.from(new Set(parsed.encargadoStaffIds)),
      observaciones: parsed.observaciones ?? null,
      estado: parsed.estado as AuditorioEstado,
      horarios: parsed.horarios.map((h) => ({
        fechaEspecifica: toLocalDate(h.fechaEspecifica),
        horaInicio: h.horaInicio,
        horaFin: h.horaFin,
      })),
    });

    broadcastScheduleRefresh();

    return res.json({
      message: "Reserva de auditorio actualizada correctamente",
      reservaId: updated.reservaId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownAuditorioWriteError(error, res)) {
      return;
    }

    return next(error);
  }
});

auditorioRouter.patch("/reservas/:id/estado", requireAdminRole, async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const { estado } = patchEstadoBodySchema.parse(req.body);

    const updated = await updateEstadoReservaAuditorio(id, estado);

    broadcastScheduleRefresh();

    return res.json({
      message: "Estado de reserva de auditorio actualizado correctamente",
      reservaId: updated.reservaId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownAuditorioWriteError(error, res)) {
      return;
    }

    return next(error);
  }
});

auditorioRouter.delete("/reservas/:id", requireAdminRole, async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);

    const deleted = await deleteReservaAuditorio(id);

    broadcastScheduleRefresh();

    return res.json({
      message: "Reserva de auditorio eliminada correctamente",
      reservaId: deleted.reservaId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownAuditorioWriteError(error, res)) {
      return;
    }

    return next(error);
  }
});
