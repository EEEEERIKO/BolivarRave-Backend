import cors from "cors";
import express from "express";
import helmet from "helmet";
import { createServer } from "http";
import rateLimit from "express-rate-limit";
import { schedulesRouter } from "./modules/schedules/routes";
import { auditorioRouter } from "./modules/auditorio/routes";
import { reservasRouter } from "./modules/reservas/routes";
import { inventoryRouter } from "./modules/inventory/routes";
import { staffRouter } from "./modules/staff/routes";
import { registroRouter } from "./modules/registro/routes";
import { tasksRouter } from "./modules/tasks/routes";
import { operationsRouter } from "./modules/operations/routes";
import { lostFoundRouter } from "./modules/lost-found/routes";
import { initializeWebSocket, getWebSocketServer } from "./lib/websocket";
import { requireAdminOrMonitorRole, requireAuthToken } from "./lib/auth";

const app = express();
const httpServer = createServer(app);
const PORT = Number(process.env.PORT ?? 4000);
const NODE_ENV = process.env.NODE_ENV ?? "development";
const isProduction = NODE_ENV === "production";
const ADMIN_API_KEY = (process.env.ADMIN_API_KEY ?? "").trim();
const corsOriginsRaw = process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN;
const normalizeOrigin = (origin: string) => origin.trim().replace(/\/+$/, "");
const alwaysAllowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "https://administracion-bolivar-rave.vercel.app",
];
const configuredOrigins = (corsOriginsRaw ?? "")
  .split(",")
  .map((origin) => normalizeOrigin(origin))
  .filter(Boolean);
const allowedOrigins = Array.from(new Set([...alwaysAllowedOrigins, ...configuredOrigins].map((origin) => normalizeOrigin(origin))));
const localOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$/i;
const isOriginAllowed = (origin?: string) => {
  if (!origin) return true;
  if (localOriginPattern.test(origin.trim())) return true;
  return allowedOrigins.includes(normalizeOrigin(origin));
};

if (isProduction && !ADMIN_API_KEY) {
  throw new Error("ADMIN_API_KEY es obligatoria en produccion");
}

// Initialize WebSocket
const io = initializeWebSocket(httpServer, isOriginAllowed);
console.log("✅ WebSocket inicializado");

app.disable("x-powered-by");
app.set("trust proxy", isProduction ? 1 : false);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("CORS origin no permitido"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-admin-key"],
  })
);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isProduction ? 600 : 5000,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "unac-bolivar-horarios-backend" });
});

app.get("/api/ws-status", (_req, res) => {
  if (isProduction) {
    res.status(404).json({ error: "No encontrado" });
    return;
  }

  const wsServer = getWebSocketServer();
  res.json({
    wsInitialized: !!wsServer,
    wsConnected: wsServer?.engine?.clientsCount ?? 0,
    timestamp: new Date().toISOString(),
  });
});

const PUBLIC_API_PATHS = new Set([
  "/health",
  "/ws-status",
  "/staff/login",
  "/staff/refresh",
  "/staff/logout",
  "/schedules/state",
  "/auditorio/public/reservas",
]);

app.use("/api", (req, res, next) => {
  if (req.method === "OPTIONS") {
    return next();
  }

  // Endpoint auxiliar únicamente para desarrollo local. Se deja fuera del
  // middleware global para poder crear el usuario inicial sin token.
  if (!isProduction && req.method === "POST" && req.path === "/staff/dev/create-monitor") {
    return next();
  }

  // Public confirmation link from email: no authenticated session required.
  const isPublicReservationConfirmation = req.method === "GET" && /^\/reservas\/[^/]+\/confirm$/.test(req.path);
  if (isPublicReservationConfirmation) {
    return next();
  }

  if (PUBLIC_API_PATHS.has(req.path)) {
    return next();
  }

  return requireAuthToken(req, res, next);
});

app.use("/api/schedules", schedulesRouter);
app.use("/api/auditorio", auditorioRouter);
app.use("/api/reservas", reservasRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/staff", staffRouter);
app.use("/api/registro", registroRouter);
app.use("/api/tasks", requireAdminOrMonitorRole, tasksRouter);
app.use("/api/operaciones", operationsRouter);
app.use("/api/objetos-perdidos", lostFoundRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Error interno del servidor";
  const statusFromError =
    typeof error === "object" && error !== null && "status" in error && typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : null;
  const typeFromError =
    typeof error === "object" && error !== null && "type" in error && typeof (error as { type?: unknown }).type === "string"
      ? (error as { type: string }).type
      : null;

  if (message.toLowerCase().includes("cors")) {
    res.status(403).json({ error: "Solicitud bloqueada por politica de seguridad CORS" });
    return;
  }

  if (statusFromError === 413 || typeFromError === "entity.too.large") {
    res.status(413).json({ error: "El archivo es demasiado grande para procesarlo. Reduce la cantidad de filas e intenta nuevamente." });
    return;
  }

  if (!isProduction) {
    console.error("[backend-error]", error);
    res.status(500).json({ error: message });
    return;
  }

  res.status(500).json({ error: "Error interno del servidor" });
});

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend corriendo en http://localhost:${PORT}`);
});
