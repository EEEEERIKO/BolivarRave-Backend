import { Router } from "express";
import { requireAdminOrMonitorOrRegistroRole } from "../../lib/auth";
import { getOperationsDashboard } from "./service";

export const operationsRouter = Router();

operationsRouter.get("/dashboard", requireAdminOrMonitorOrRegistroRole, async (_req, res, next) => {
  try {
    const dashboard = await getOperationsDashboard();
    return res.json(dashboard);
  } catch (error) {
    return next(error);
  }
});