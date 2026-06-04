import { Router } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../../lib/auth";
import {
  createLostFoundItem,
  getLostFoundStats,
  listLostFoundItems,
  updateLostFoundItemStatus,
  type LostFoundStatus,
} from "./service";

export const lostFoundRouter = Router();

lostFoundRouter.use(async (_req, _res, next) => {
  try {
    const authUser = (_req as AuthenticatedRequest).authUser;
    if (!authUser) {
      return _res.status(401).json({ error: "No autorizado" });
    }

    if (authUser.role === "monitor") {
      return _res.status(403).json({ error: "El perfil Monitor no tiene acceso a Objetos Perdidos." });
    }

    return next();
  } catch (error) {
    return next(error);
  }
});

const createSchema = z.object({
  objeto: z.string().trim().min(2).max(180),
  lugar: z.string().trim().min(2).max(180),
  quienLoTrajo: z.string().trim().min(2).max(180),
});

const statusSchema = z.object({
  status: z.enum(["dueno_no_encontrado", "dado_de_baja", "objeto_devuelto"]),
});

const querySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(["dueno_no_encontrado", "dado_de_baja", "objeto_devuelto"]).optional(),
});

const idParamsSchema = z.object({
  id: z.string().uuid(),
});

lostFoundRouter.get("/items", async (req, res, next) => {
  try {
    const parsedQuery = querySchema.parse({
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      status: typeof req.query.status === "string" ? req.query.status : undefined,
    });

    const items = await listLostFoundItems({
      ...(parsedQuery.search !== undefined ? { search: parsedQuery.search } : {}),
      ...(parsedQuery.status !== undefined ? { status: parsedQuery.status } : {}),
    });
    const stats = await getLostFoundStats();

    return res.json({ items, stats });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    return next(error);
  }
});

lostFoundRouter.post("/items", async (req, res, next) => {
  try {
    const parsed = createSchema.parse(req.body);
    const item = await createLostFoundItem(parsed);

    return res.status(201).json({
      message: "Objeto perdido registrado correctamente",
      item,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    return next(error);
  }
});

lostFoundRouter.patch("/items/:id/status", async (req, res, next) => {
  try {
    const { id } = idParamsSchema.parse(req.params);
    const { status } = statusSchema.parse(req.body);

    const item = await updateLostFoundItemStatus(id, status as LostFoundStatus);

    return res.json({
      message: "Estado actualizado correctamente",
      item,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Payload invalido: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    if (error instanceof Error && error.message.toLowerCase().includes("no se encontro el objeto perdido")) {
      return res.status(404).json({ error: "No se encontro el objeto perdido" });
    }

    return next(error);
  }
});
