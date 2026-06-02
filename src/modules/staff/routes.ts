import { Router } from "express";
import { z } from "zod";
import { broadcastScheduleRefresh } from "../../lib/websocket";
import { type AuthenticatedRequest, requireAdminRole, signAuthToken } from "../../lib/auth";
import {
  authenticateStaffLogin,
  changeStaffPassword,
  createStaffBalanceMovimiento,
  createStaffPausaProgramada,
  createStaff,
  deleteStaffPausaProgramada,
  deleteStaff,
  getNextStaffNumber,
  getStaffHorarioLaboral,
  getStaffResumenContrato,
  getStaffById,
  getStaffByCedula,
  listStaffBalanceMovimientos,
  listStaffSkills,
  listAllStaffJornadasSemanales,
  listAllStaffPausasProgramadas,
  listStaffJornadaSemanal,
  listStaffPausasProgramadas,
  listStaff,
  replaceStaffJornadaSemanal,
  StaffAuthError,
  updateStaffPausaProgramada,
  updateStaff,
  updateStaffEstado,
  upsertStaffResumenContrato,
  type StaffEstado,
} from "./service";

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

const staffWriteBaseBodySchema = z.object({
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
  estado: z.enum(["Active", "Inactive"]).default("Inactive"),
  balanceHoras: z.number().min(-10000).max(10000).default(0),
  password: z.string().min(8).max(128).optional(),
  habilidadIds: z.array(z.string().uuid()).default([]),
  bloqueosClase: z.array(bloqueoClaseSchema).default([]),
});

const createStaffBodySchema = staffWriteBaseBodySchema.extend({
  numeroStaff: z.number().int().min(1).max(999999).optional(),
});

const updateStaffBodySchema = staffWriteBaseBodySchema.extend({
  numeroStaff: z.number().int().min(1).max(999999),
});

const patchEstadoBodySchema = z.object({
  estado: z.enum(["Active", "Inactive"]),
});

const tipoPausaEnum = ["Comida", "Descanso"] as const;

const jornadaSchema = z.object({
  diaSemana: z.enum(weekDays),
  horaEntrada: z.string().regex(timeRegex, "Hora entrada invalida (HH:mm)"),
  horaSalida: z.string().regex(timeRegex, "Hora salida invalida (HH:mm)"),
  totalHorasDia: z.number().min(0).max(24),
});

const replaceJornadaBodySchema = z.object({
  jornadas: z.array(jornadaSchema).max(21),
});

const pausaBodySchema = z.object({
  diaSemana: z.enum(weekDays),
  tipoPausa: z.enum(tipoPausaEnum),
  horaInicio: z.string().regex(timeRegex, "Hora inicio invalida (HH:mm)"),
  horaFin: z.string().regex(timeRegex, "Hora fin invalida (HH:mm)"),
});

const resumenContratoBodySchema = z.object({
  horasSemanalesContrato: z.number().int().min(1).max(168),
  balanceHoras: z.number().min(-10000).max(10000),
});

const balanceMovimientoBodySchema = z.object({
  horasDelta: z.number().min(-200).max(200).refine((value) => Math.abs(value) >= 0.01, {
    message: "El ajuste de horas no puede ser 0.",
  }),
  motivo: z.string().trim().max(255).optional(),
});

const balanceMovimientosQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const loginBodySchema = z.object({
  cedula: z.string().trim().min(5).max(20),
  portal: z.enum(["admin-monitor", "colaborador"]),
  password: z.string().min(1).max(128).optional(),
});

const changePasswordBodySchema = z.object({
  cedula: z.string().trim().min(5).max(20),
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

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

const validateJornadas = (jornadas: Array<{ diaSemana: string; horaEntrada: string; horaSalida: string; totalHorasDia: number }>) => {
  for (const [i, jornada] of jornadas.entries()) {
    if (toMinutes(jornada.horaSalida) <= toMinutes(jornada.horaEntrada)) {
      throw new Error(`La jornada de ${jornada.diaSemana} tiene hora fin menor o igual a hora inicio`);
    }

    const bruto = (toMinutes(jornada.horaSalida) - toMinutes(jornada.horaEntrada)) / 60;
    if (jornada.totalHorasDia > bruto + 0.01) {
      throw new Error(`totalHorasDia excede el rango horario bruto en ${jornada.diaSemana}`);
    }

    for (let j = i + 1; j < jornadas.length; j += 1) {
      const other = jornadas[j];
      if (!other) continue;
      if (jornada.diaSemana !== other.diaSemana) continue;

      const startA = toMinutes(jornada.horaEntrada);
      const endA = toMinutes(jornada.horaSalida);
      const startB = toMinutes(other.horaEntrada);
      const endB = toMinutes(other.horaSalida);

      const isExactDuplicate = startA === startB && endA === endB;
      if (isExactDuplicate) {
        throw new Error(`Bloques duplicados en ${jornada.diaSemana}: ${jornada.horaEntrada}-${jornada.horaSalida}`);
      }

      const overlap = startA < endB && startB < endA;
      if (overlap) {
        throw new Error(
          `Hay solape entre jornadas en ${jornada.diaSemana} (${jornada.horaEntrada}-${jornada.horaSalida} y ${other.horaEntrada}-${other.horaSalida})`,
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

  if (message.includes("contrase") || message.includes("password") || message.includes("credencial")) {
    res.status(400).json({ error: error.message });
    return true;
  }

  if (message.includes("staff_habilidades") || message.includes("habilidad")) {
    res.status(400).json({ error: "Alguna habilidad seleccionada no existe." });
    return true;
  }

  return false;
};

const handleKnownStaffScheduleError = (error: unknown, res: import("express").Response) => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  if (message.includes("no se encontro el staff")) {
    res.status(404).json({ error: "El staff solicitado no existe." });
    return true;
  }

  if (message.includes("no se encontro la pausa")) {
    res.status(404).json({ error: "La pausa solicitada no existe." });
    return true;
  }

  if (message.includes("debe estar dentro de la jornada") || message.includes("no existe jornada")) {
    res.status(400).json({ error: "La pausa debe pertenecer a un dia laboral y estar dentro del rango de jornada." });
    return true;
  }

  if (message.includes("delta") || message.includes("movimiento")) {
    res.status(400).json({ error: error.message });
    return true;
  }

  if (message.includes("solape") || message.includes("duplicados") || message.includes("totalhorasdia") || message.includes("hora fin")) {
    res.status(400).json({ error: error.message });
    return true;
  }

  return false;
};

const ensureCollaboradorSelfAccess = (
  req: import("express").Request,
  res: import("express").Response,
  targetStaffId: string,
) => {
  const authUser = (req as AuthenticatedRequest).authUser;

  if (!authUser) {
    res.status(401).json({ error: "No autorizado" });
    return false;
  }

  if (authUser.role === "colaborador" && authUser.staffId !== targetStaffId) {
    res.status(403).json({ error: "Solo puedes consultar tu propio perfil." });
    return false;
  }

  return true;
};

staffRouter.get("/", async (req, res, next) => {
  try {
    const authUser = (req as AuthenticatedRequest).authUser;

    if (authUser?.role === "colaborador") {
      const ownStaff = await getStaffById(authUser.staffId);
      return res.json({ staff: ownStaff ? [ownStaff] : [] });
    }

    const staff = await listStaff();
    return res.json({ staff });
  } catch (error) {
    return next(error);
  }
});

staffRouter.get("/jornadas-semanales", async (req, res, next) => {
  try {
    const authUser = (req as AuthenticatedRequest).authUser;

    if (authUser?.role === "colaborador") {
      const ownJornadas = await listStaffJornadaSemanal(authUser.staffId);
      return res.json({ jornadasByStaffId: { [authUser.staffId]: ownJornadas } });
    }

    const jornadasByStaffId = await listAllStaffJornadasSemanales();
    return res.json({ jornadasByStaffId });
  } catch (error) {
    return next(error);
  }
});

staffRouter.get("/next-number", async (_req, res, next) => {
  try {
    const numeroStaff = await getNextStaffNumber();
    return res.json({ numeroStaff });
  } catch (error) {
    return next(error);
  }
});

staffRouter.get("/skills", async (_req, res, next) => {
  try {
    const habilidades = await listStaffSkills();
    return res.json({ habilidades });
  } catch (error) {
    return next(error);
  }
});

staffRouter.get("/jornadas-bulk", async (req, res, next) => {
  try {
    const authUser = (req as AuthenticatedRequest).authUser;

    if (authUser?.role === "colaborador") {
      const ownJornadas = await listStaffJornadaSemanal(authUser.staffId);
      return res.json({ jornadas: { [authUser.staffId]: ownJornadas } });
    }

    const jornadasByStaffId = await listAllStaffJornadasSemanales();
    return res.json({ jornadas: jornadasByStaffId });
  } catch (error) {
    return next(error);
  }
});

staffRouter.get("/pausas-bulk", async (req, res, next) => {
  try {
    const authUser = (req as AuthenticatedRequest).authUser;

    if (authUser?.role === "colaborador") {
      const ownPausas = await listStaffPausasProgramadas(authUser.staffId);
      return res.json({ pausas: { [authUser.staffId]: ownPausas } });
    }

    const pausasByStaffId = await listAllStaffPausasProgramadas();
    return res.json({ pausas: pausasByStaffId });
  } catch (error) {
    return next(error);
  }
});

staffRouter.post("/login", async (req, res, next) => {
  try {
    const parsed = loginBodySchema.parse(req.body);

    const session = await authenticateStaffLogin({
      cedula: parsed.cedula,
      portal: parsed.portal,
      ...(parsed.password ? { password: parsed.password } : {}),
    });

    const accessToken = signAuthToken({
      staffId: session.staffId,
      cedula: session.cedula,
      role: session.role,
      roleLabel: session.roleLabel,
      name: session.name,
    });

    return res.json({
      session: {
        ...session,
        accessToken,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (error instanceof StaffAuthError) {
      return res.status(error.status).json({ error: error.message });
    }

    return next(error);
  }
});

staffRouter.post("/change-password", async (req, res, next) => {
  try {
    const authUser = (req as AuthenticatedRequest).authUser;
    if (!authUser) {
      return res.status(401).json({ error: "No autorizado" });
    }

    if (authUser.role === "colaborador") {
      return res.status(403).json({ error: "La opción de cambiar contraseña no está disponible para colaboradores." });
    }

    const parsed = changePasswordBodySchema.parse(req.body);

    if (authUser.cedula !== parsed.cedula) {
      return res.status(403).json({ error: "No puedes actualizar la contraseña de otro usuario." });
    }

    await changeStaffPassword({
      cedula: parsed.cedula,
      currentPassword: parsed.currentPassword,
      newPassword: parsed.newPassword,
    });

    return res.json({ message: "Contraseña actualizada correctamente." });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (error instanceof StaffAuthError) {
      return res.status(error.status).json({ error: error.message });
    }

    return next(error);
  }
});

// Dev helper: create a quick Monitor account for testing. Disabled in production.
staffRouter.post("/dev/create-monitor", async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "Not found" });
    }

    const exists = await getStaffByCedula("Monitor").catch(() => null);
    if (exists) {
      if (exists.roleId === 2 && exists.rol?.toLowerCase() === "monitor") {
        return res.json({ message: "Monitor user already exists", staffId: exists.id });
      }

      const updated = await updateStaff({
        id: exists.id,
        numeroStaff: exists.numeroStaff,
        roleId: 2,
        rol: "Monitor",
        nombres: exists.nombres,
        apellidos: exists.apellidos,
        cedula: exists.cedula,
        telefono: exists.telefono,
        fechaNacimiento: new Date(exists.fechaNacimiento),
        carrera: exists.carrera,
        tipoContrato: exists.tipoContrato,
        conocimientoSonido: exists.conocimientoSonido,
        estado: exists.estado,
        balanceHoras: exists.balanceHoras,
        habilidadIds: exists.habilidades.map((item) => item.id),
        bloqueosClase: exists.bloqueosClase.map((item) => ({
          diaSemana: item.diaSemana,
          horaInicio: item.horaInicio,
          horaFin: item.horaFin,
        })),
        password: "Monitor123",
      });

      broadcastScheduleRefresh();

      return res.json({ message: "Monitor user updated", staffId: updated.staffId });
    }

    const created = await createStaff({
      roleId: 2,
      rol: "Monitor",
      nombres: "Monitor",
      apellidos: "",
      cedula: "Monitor",
      telefono: "",
      fechaNacimiento: new Date("1990-01-01"),
      carrera: "",
      tipoContrato: "Plan Monitoria",
      conocimientoSonido: false,
      estado: "Active",
      balanceHoras: 0,
      password: "Monitor123",
      habilidadIds: [],
      bloqueosClase: [],
    });

    broadcastScheduleRefresh();

    return res.status(201).json({ message: "Monitor created", staffId: created.staffId });
  } catch (error) {
    return next(error);
  }
});

staffRouter.get("/:id", async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);

    if (!ensureCollaboradorSelfAccess(req, res, id)) {
      return;
    }

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

staffRouter.post("/", requireAdminRole, async (req, res, next) => {
  try {
    const parsed = createStaffBodySchema.parse(req.body);
    validateBloqueosNoOverlap(parsed.bloqueosClase);

    const created = await createStaff({
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
      habilidadIds: parsed.habilidadIds,
      bloqueosClase: parsed.bloqueosClase,
      ...(parsed.numeroStaff !== undefined ? { numeroStaff: parsed.numeroStaff } : {}),
      ...(parsed.password ? { password: parsed.password } : {}),
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

staffRouter.put("/:id", requireAdminRole, async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const parsed = updateStaffBodySchema.parse(req.body);
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
      habilidadIds: parsed.habilidadIds,
      bloqueosClase: parsed.bloqueosClase,
      ...(parsed.password ? { password: parsed.password } : {}),
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

staffRouter.patch("/:id/estado", requireAdminRole, async (req, res, next) => {
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

staffRouter.delete("/:id", requireAdminRole, async (req, res, next) => {
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

staffRouter.get("/:id/jornada-semanal", async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);

    if (!ensureCollaboradorSelfAccess(req, res, id)) {
      return;
    }

    const jornadas = await listStaffJornadaSemanal(id);
    return res.json({ jornadas });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownStaffScheduleError(error, res)) {
      return;
    }

    return next(error);
  }
});

staffRouter.put("/:id/jornada-semanal", requireAdminRole, async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const parsed = replaceJornadaBodySchema.parse(req.body);
    validateJornadas(parsed.jornadas);

    const updated = await replaceStaffJornadaSemanal(id, parsed.jornadas);
    broadcastScheduleRefresh();

    return res.json({
      message: "Jornada semanal actualizada correctamente",
      staffId: updated.staffId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownStaffScheduleError(error, res)) {
      return;
    }

    return next(error);
  }
});

staffRouter.get("/:id/pausas-programadas", async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);

    if (!ensureCollaboradorSelfAccess(req, res, id)) {
      return;
    }

    const pausas = await listStaffPausasProgramadas(id);
    return res.json({ pausas });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownStaffScheduleError(error, res)) {
      return;
    }

    return next(error);
  }
});

staffRouter.post("/:id/pausas-programadas", requireAdminRole, async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const parsed = pausaBodySchema.parse(req.body);

    const created = await createStaffPausaProgramada(id, parsed);
    broadcastScheduleRefresh();

    return res.status(201).json({
      message: "Pausa programada creada correctamente",
      id: created.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownStaffScheduleError(error, res)) {
      return;
    }

    return next(error);
  }
});

staffRouter.put("/:id/pausas-programadas/:pausaId", requireAdminRole, async (req, res, next) => {
  try {
    const { id, pausaId } = z.object({
      id: z.string().uuid(),
      pausaId: z.string().uuid(),
    }).parse(req.params);
    const parsed = pausaBodySchema.parse(req.body);

    const updated = await updateStaffPausaProgramada(id, pausaId, parsed);
    broadcastScheduleRefresh();

    return res.json({
      message: "Pausa programada actualizada correctamente",
      id: updated.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload/parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownStaffScheduleError(error, res)) {
      return;
    }

    return next(error);
  }
});

staffRouter.delete("/:id/pausas-programadas/:pausaId", requireAdminRole, async (req, res, next) => {
  try {
    const { id, pausaId } = z.object({
      id: z.string().uuid(),
      pausaId: z.string().uuid(),
    }).parse(req.params);

    const deleted = await deleteStaffPausaProgramada(id, pausaId);
    broadcastScheduleRefresh();

    return res.json({
      message: "Pausa programada eliminada correctamente",
      id: deleted.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownStaffScheduleError(error, res)) {
      return;
    }

    return next(error);
  }
});

staffRouter.get("/:id/resumen-contrato", async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);

    if (!ensureCollaboradorSelfAccess(req, res, id)) {
      return;
    }

    const resumen = await getStaffResumenContrato(id);
    return res.json({ resumen });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownStaffScheduleError(error, res)) {
      return;
    }

    return next(error);
  }
});

staffRouter.put("/:id/resumen-contrato", requireAdminRole, async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const parsed = resumenContratoBodySchema.parse(req.body);

    const updated = await upsertStaffResumenContrato(id, parsed);
    broadcastScheduleRefresh();

    return res.json({
      message: "Resumen de contrato actualizado correctamente",
      staffId: updated.staffId,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownStaffScheduleError(error, res)) {
      return;
    }

    return next(error);
  }
});

staffRouter.get("/:id/balance-movimientos", async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const { limit } = balanceMovimientosQuerySchema.parse(req.query);

    if (!ensureCollaboradorSelfAccess(req, res, id)) {
      return;
    }

    const movimientos = await listStaffBalanceMovimientos(id, limit ?? 50);
    return res.json({ movimientos });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownStaffScheduleError(error, res)) {
      return;
    }

    return next(error);
  }
});

staffRouter.post("/:id/balance-movimientos", requireAdminRole, async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const parsed = balanceMovimientoBodySchema.parse(req.body);
    const authUser = (req as AuthenticatedRequest).authUser;

    const created = await createStaffBalanceMovimiento(id, {
      horasDelta: parsed.horasDelta,
      ...(parsed.motivo ? { motivo: parsed.motivo } : {}),
      ...(authUser?.staffId ? { creadoPorStaffId: authUser.staffId } : {}),
    });
    broadcastScheduleRefresh();

    return res.status(201).json({
      message: "Movimiento de horas registrado correctamente",
      movimiento: created.movement,
      balanceHoras: created.balanceHoras,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownStaffScheduleError(error, res)) {
      return;
    }

    return next(error);
  }
});

staffRouter.get("/:id/horario-laboral", async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);

    if (!ensureCollaboradorSelfAccess(req, res, id)) {
      return;
    }

    const horarioLaboral = await getStaffHorarioLaboral(id);
    return res.json({ horarioLaboral });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}`,
      });
    }

    if (handleKnownStaffScheduleError(error, res)) {
      return;
    }

    return next(error);
  }
});
