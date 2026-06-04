import "dotenv/config";
import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";

export type AuthTokenPayload = {
  staffId: string;
  cedula: string;
  role: "admin" | "monitor" | "colaborador" | "registro";
  roleLabel: string;
  name: string;
};

const NODE_ENV = process.env.NODE_ENV ?? "development";
const isProduction = NODE_ENV === "production";
const AUTH_JWT_SECRET = (process.env.AUTH_JWT_SECRET ?? "").trim();
const FALLBACK_DEV_SECRET = "unac-dev-jwt-secret-change-me";
const JWT_SECRET = AUTH_JWT_SECRET || (!isProduction ? FALLBACK_DEV_SECRET : "");
const JWT_ISSUER = "unac-bolivar-horarios";
const JWT_AUDIENCE = "unac-frontend";
export const ACCESS_TOKEN_EXPIRES_IN =
  (process.env.AUTH_ACCESS_TOKEN_EXPIRES_IN?.trim() || "15m") as NonNullable<jwt.SignOptions["expiresIn"]>;

if (isProduction && !AUTH_JWT_SECRET) {
  throw new Error("AUTH_JWT_SECRET es obligatoria en produccion");
}

export const signAuthToken = (payload: AuthTokenPayload) => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
};

const verifyAuthToken = (token: string): AuthTokenPayload => {
  const decoded = jwt.verify(token, JWT_SECRET, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });

  if (!decoded || typeof decoded !== "object") {
    throw new Error("Token invalido");
  }

  const payload = decoded as Partial<AuthTokenPayload>;

  if (!payload.staffId || !payload.cedula || !payload.role || !payload.roleLabel || !payload.name) {
    throw new Error("Token sin payload requerido");
  }

  return {
    staffId: payload.staffId,
    cedula: payload.cedula,
    role: payload.role,
    roleLabel: payload.roleLabel,
    name: payload.name,
  };
};

export type AuthenticatedRequest = import("express").Request & {
  authUser?: AuthTokenPayload;
};

const isMonitorRegistroSupervisor = (authUser: AuthTokenPayload) => {
  if (authUser.role !== "registro" && authUser.role !== "monitor") {
    return false;
  }

  const normalizedLabel = authUser.roleLabel.trim().toLowerCase();
  const normalizedName = authUser.name.trim().toLowerCase();
  const normalizedCedula = authUser.cedula.trim().toLowerCase();

  return (
    (normalizedLabel.includes("monitor") && normalizedLabel.includes("registro"))
    || normalizedName.includes("monitor registro")
    || normalizedCedula === "monitor"
  );
};

export const requireAuthToken: RequestHandler = (req, res, next) => {
  const authHeader = (req.header("authorization") ?? "").trim();
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return res.status(401).json({ error: "No autorizado" });
  }

  try {
    const payload = verifyAuthToken(token);
    (req as AuthenticatedRequest).authUser = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "Sesion invalida o expirada" });
  }
};

export const requireAdminRole: RequestHandler = (req, res, next) => {
  const authUser = (req as AuthenticatedRequest).authUser;

  if (!authUser) {
    return res.status(401).json({ error: "No autorizado" });
  }

  if (authUser.role !== "admin") {
    return res.status(403).json({ error: "Solo el perfil Administrador puede realizar esta acción." });
  }

  return next();
};

export const requireAdminOrMonitorRole: RequestHandler = (req, res, next) => {
  const authUser = (req as AuthenticatedRequest).authUser;

  if (!authUser) {
    return res.status(401).json({ error: "No autorizado" });
  }

  if (authUser.role !== "admin" && authUser.role !== "monitor" && !isMonitorRegistroSupervisor(authUser)) {
    return res.status(403).json({ error: "Solo los perfiles Administrador y Monitor pueden realizar esta acción." });
  }

  return next();
};

export const requireAdminOrRegistroRole: RequestHandler = (req, res, next) => {
  const authUser = (req as AuthenticatedRequest).authUser;

  if (!authUser) {
    return res.status(401).json({ error: "No autorizado" });
  }

  if (authUser.role !== "admin" && authUser.role !== "registro" && !isMonitorRegistroSupervisor(authUser)) {
    return res.status(403).json({ error: "Solo los perfiles Administrador y Registro pueden realizar esta acción." });
  }

  return next();
};

export const requireAdminOrMonitorOrRegistroRole: RequestHandler = (req, res, next) => {
  const authUser = (req as AuthenticatedRequest).authUser;

  if (!authUser) {
    return res.status(401).json({ error: "No autorizado" });
  }

  if (authUser.role !== "admin" && authUser.role !== "monitor" && authUser.role !== "registro") {
    return res.status(403).json({ error: "Solo los perfiles Administrador, Monitor y Registro pueden realizar esta acción." });
  }

  return next();
};
