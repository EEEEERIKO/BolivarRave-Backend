import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";

export type AuthTokenPayload = {
  staffId: string;
  cedula: string;
  role: "admin" | "monitor" | "colaborador";
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
const JWT_EXPIRES_IN = "8h";

if (isProduction && !AUTH_JWT_SECRET) {
  throw new Error("AUTH_JWT_SECRET es obligatoria en produccion");
}

export const signAuthToken = (payload: AuthTokenPayload) => {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
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
