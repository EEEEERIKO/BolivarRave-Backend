import { Router } from "express";
import { requireAdminOrMonitorRole } from "../../lib/auth";
import { getOperationsDashboard } from "./service";

export const operationsRouter = Router();

operationsRouter.get("/dashboard", requireAdminOrMonitorRole, async (_req, res, next) => {
  try {
    const dashboard = await getOperationsDashboard();
    return res.json(dashboard);
  } catch (error) {
    return next(error);
  }
});