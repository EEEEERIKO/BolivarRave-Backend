import { Router } from "express";
import { z } from "zod";
import { requireAdminOrMonitorRole, requireAdminRole } from "../../lib/auth";
import {
  createInventoryGroup,
  createInventoryItem,
  deleteInventoryGroup,
  deleteInventoryItem,
  ensureInventorySchemaReady,
  listInventoryGroups,
  listInventoryItems,
  updateInventoryGroup,
  updateInventoryItem,
} from "./service";

export const inventoryRouter = Router();

inventoryRouter.use(async (_req, _res, next) => {
  try {
    await ensureInventorySchemaReady();
    return next();
  } catch (error) {
    return next(error);
  }
});

inventoryRouter.get("/rooms-equipment", async (_req, res, next) => {
  try {
    const items = await listInventoryItems();
    return res.json({ items });
  } catch (error) {
    return next(error);
  }
});

const groupBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  icon: z.string().trim().min(1).max(80).optional(),
  order: z.number().int().min(0).optional(),
});

const itemBodySchema = z.object({
  groupId: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().min(1).max(80),
  room: z.string().trim().min(2).max(160),
  status: z.enum(["Disponible", "Fijo"]),
  defective: z.boolean().default(false),
  motivo: z.string().trim().max(500).nullable().optional(),
  order: z.number().int().min(0).optional(),
});

const idParamsSchema = z.object({
  id: z.string().uuid(),
});

const handleKnownInventoryError = (error: unknown, res: import("express").Response) => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  if (message.includes("duplicate key value") || message.includes("unique constraint")) {
    res.status(409).json({ error: "Ya existe un registro con ese nombre o código." });
    return true;
  }

  if (message.includes("no se encontro el grupo de inventario")) {
    res.status(404).json({ error: "El grupo de inventario no existe." });
    return true;
  }

  if (message.includes("no se encontro el elemento de inventario")) {
    res.status(404).json({ error: "El elemento de inventario no existe." });
    return true;
  }

  return false;
};

inventoryRouter.get("/groups", requireAdminOrMonitorRole, async (_req, res, next) => {
  try {
    const groups = await listInventoryGroups();
    return res.json({ groups });
  } catch (error) {
    return next(error);
  }
});

inventoryRouter.get("/items", requireAdminOrMonitorRole, async (req, res, next) => {
  try {
    const groupId = typeof req.query.groupId === "string" && req.query.groupId.trim().length > 0 ? req.query.groupId.trim() : undefined;
    if (groupId) {
      z.string().uuid().parse(groupId);
    }

    const items = await listInventoryItems(groupId);
    return res.json({ items });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    return next(error);
  }
});

inventoryRouter.post("/groups", requireAdminRole, async (req, res, next) => {
  try {
    const parsed = groupBodySchema.parse(req.body);
    const created = await createInventoryGroup({
      name: parsed.name,
      ...(parsed.icon ? { icon: parsed.icon } : {}),
      ...(parsed.order !== undefined ? { order: parsed.order } : {}),
    });

    return res.status(201).json({ message: "Grupo creado correctamente", id: created.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    if (handleKnownInventoryError(error, res)) {
      return;
    }

    return next(error);
  }
});

inventoryRouter.put("/groups/:id", requireAdminRole, async (req, res, next) => {
  try {
    const params = idParamsSchema.parse(req.params);
    const parsed = groupBodySchema.parse(req.body);
    const updated = await updateInventoryGroup(params.id, {
      name: parsed.name,
      ...(parsed.icon ? { icon: parsed.icon } : {}),
      ...(parsed.order !== undefined ? { order: parsed.order } : {}),
    });

    return res.json({ message: "Grupo actualizado correctamente", id: updated.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    if (handleKnownInventoryError(error, res)) {
      return;
    }

    return next(error);
  }
});

inventoryRouter.delete("/groups/:id", requireAdminRole, async (req, res, next) => {
  try {
    const params = idParamsSchema.parse(req.params);
    const deleted = await deleteInventoryGroup(params.id);
    return res.json({ message: "Grupo eliminado correctamente", id: deleted.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    if (handleKnownInventoryError(error, res)) {
      return;
    }

    return next(error);
  }
});

inventoryRouter.post("/items", requireAdminRole, async (req, res, next) => {
  try {
    const parsed = itemBodySchema.parse(req.body);
    const created = await createInventoryItem({
      groupId: parsed.groupId,
      name: parsed.name,
      code: parsed.code,
      room: parsed.room,
      status: parsed.status,
      defective: parsed.defective,
      motivo: parsed.motivo ?? null,
      ...(parsed.order !== undefined ? { order: parsed.order } : {}),
    });

    return res.status(201).json({ message: "Elemento creado correctamente", id: created.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    if (handleKnownInventoryError(error, res)) {
      return;
    }

    return next(error);
  }
});

inventoryRouter.put("/items/:id", requireAdminRole, async (req, res, next) => {
  try {
    const params = idParamsSchema.parse(req.params);
    const parsed = itemBodySchema.parse(req.body);
    const updated = await updateInventoryItem(params.id, {
      groupId: parsed.groupId,
      name: parsed.name,
      code: parsed.code,
      room: parsed.room,
      status: parsed.status,
      defective: parsed.defective,
      motivo: parsed.motivo ?? null,
      ...(parsed.order !== undefined ? { order: parsed.order } : {}),
    });

    return res.json({ message: "Elemento actualizado correctamente", id: updated.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    if (handleKnownInventoryError(error, res)) {
      return;
    }

    return next(error);
  }
});

inventoryRouter.delete("/items/:id", requireAdminRole, async (req, res, next) => {
  try {
    const params = idParamsSchema.parse(req.params);
    const deleted = await deleteInventoryItem(params.id);
    return res.json({ message: "Elemento eliminado correctamente", id: deleted.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    if (handleKnownInventoryError(error, res)) {
      return;
    }

    return next(error);
  }
});