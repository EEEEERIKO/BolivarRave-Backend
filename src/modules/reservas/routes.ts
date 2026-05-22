import { Router } from "express";
import { z } from "zod";
import { requireAdminOrMonitorRole, requireAuthToken, type AuthenticatedRequest } from "../../lib/auth";
import {
  createReservationRequest,
  ensureReservationsSchemaReady,
  getReservationRequestById,
  listReservationRequests,
  markTelevisionDisplaced,
  returnReservationRequest,
  confirmReservationRequest,
  cancelReservationRequest,
  closeReservationRequest,
  reportReservationRequest,
  listReservationRequestsByCreator,
} from "./service";
import { prisma } from "../../lib/prisma";

export const reservasRouter = Router();

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const timeRegex = /^\d{2}:\d{2}$/;

const reservationBodySchema = z
  .object({
    resourceType: z.enum(["rooms", "equipment", "televisor"]),
    resourceId: z.string().trim().min(1),
    bookingDate: z.string().regex(dateRegex, "Fecha invalida (YYYY-MM-DD)"),
    startTime: z.string().regex(timeRegex, "Hora inicio invalida (HH:mm)"),
    endTime: z.string().regex(timeRegex, "Hora fin invalida (HH:mm)"),
    purpose: z.string().trim().min(3).max(4000),
    requesterName: z.string().trim().min(3).max(150),
    requesterDocument: z.string().trim().min(3).max(80),
    requesterEmail: z.string().trim().email().nullable().optional(),
    requesterPhone: z.string().trim().min(5).max(30).nullable().optional(),
    termsAccepted: z.boolean().optional().default(false),
    destinationRoomId: z.string().trim().min(1).nullable().optional(),
  })
  .refine((data) => data.endTime > data.startTime, {
    path: ["endTime"],
    message: "La hora de fin debe ser posterior a la hora de inicio.",
  });

const handleKnownReservationError = (error: unknown, res: import("express").Response) => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  if (message.includes("no se encontro el salon seleccionado")) {
    res.status(404).json({ error: "No encontramos el salón seleccionado." });
    return true;
  }

  if (message.includes("no se encontro el elemento de inventario seleccionado")) {
    res.status(404).json({ error: "No encontramos el elemento de inventario seleccionado." });
    return true;
  }

  if (message.includes("no se encontro la solicitud de reserva")) {
    res.status(404).json({ error: "No encontramos la solicitud de reserva." });
    return true;
  }

  if (message.includes("no esta disponible")) {
    res.status(409).json({ error: "El elemento seleccionado no está disponible." });
    return true;
  }

  if (message.includes("solo los elementos de inventario pueden devolverse")) {
    res.status(400).json({ error: "Solo los elementos de inventario pueden devolverse." });
    return true;
  }

  if (message.includes("ya fue devuelta")) {
    res.status(409).json({ error: "Esta solicitud ya fue devuelta." });
    return true;
  }

  if (message.includes("no se pudo recuperar la ubicacion original")) {
    res.status(409).json({ error: "No se pudo recuperar la ubicación original del elemento." });
    return true;
  }

  if (message.includes("debes seleccionar el salon de destino")) {
    res.status(400).json({ error: "Debes seleccionar el salón de destino para equipos." });
    return true;
  }

  if (message.includes("token de confirmacion invalido")) {
    res.status(401).json({ error: "El enlace de confirmación es inválido o ha expirado." });
    return true;
  }

  if (message.includes("ya fue confirmada")) {
    res.status(409).json({ error: "Esta solicitud ya fue confirmada." });
    return true;
  }

  return false;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getFrontendBaseUrl = () => {
  const configured = (process.env.FRONTEND_URL ?? "").trim().replace(/\/+$/, "");
  return configured || "http://localhost:3000";
};

reservasRouter.use(async (_req, _res, next) => {
  try {
    await ensureReservationsSchemaReady();
    return next();
  } catch (error) {
    return next(error);
  }
});

reservasRouter.get("/", requireAdminOrMonitorRole, async (_req, res, next) => {
  try {
    const reservas = await listReservationRequests();
    return res.json({ reservas });
  } catch (error) {
    return next(error);
  }
});

// List reservations for the authenticated user
reservasRouter.get("/mine", requireAuthToken, async (req, res, next) => {
  try {
    const authUser = (req as AuthenticatedRequest).authUser;
    if (!authUser?.staffId) return res.status(401).json({ error: "No autorizado" });

    const reservas = await listReservationRequestsByCreator(authUser.staffId);
    return res.json({ reservas });
  } catch (error) {
    return next(error);
  }
});

reservasRouter.post("/", requireAuthToken, async (req, res, next) => {
  try {
    const authUser = (req as AuthenticatedRequest).authUser;
    const parsed = reservationBodySchema.parse(req.body);

    if (!authUser?.staffId) {
      return res.status(401).json({ error: "No autorizado" });
    }

    const created = await createReservationRequest({
      resourceType: parsed.resourceType,
      resourceId: parsed.resourceId,
      bookingDate: new Date(`${parsed.bookingDate}T00:00:00`),
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      purpose: parsed.purpose,
      requesterName: parsed.requesterName,
      requesterDocument: parsed.requesterDocument,
      requesterEmail: parsed.requesterEmail ?? null,
      requesterPhone: parsed.requesterPhone ?? null,
      termsAccepted: parsed.termsAccepted,
      destinationRoomId: parsed.destinationRoomId ?? null,
      createdByStaffId: authUser.staffId,
    });

    return res.status(201).json({
      message: "Reserva registrada correctamente.",
      reservationId: created.id,
      assignmentLabel: created.assignmentLabel ?? null,
      returnNote: created.returnNote ?? null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues.map((iss) => ({ path: iss.path.map(String).join('.') || 'body', message: iss.message }));
      return res.status(400).json({ error: 'Payload invalido', details });
    }

    if (handleKnownReservationError(error, res)) {
      return;
    }

    return next(error);
  }
});

reservasRouter.patch("/:reservationId/return", requireAdminOrMonitorRole, async (req, res, next) => {
  try {
    const reservationId = z.string().uuid().parse(req.params.reservationId);
    const returned = await returnReservationRequest(reservationId);

    return res.json({
      message: "Elemento devuelto correctamente.",
      reservationId: returned.id,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues.map((iss) => ({ path: iss.path.map(String).join('.') || 'params', message: iss.message }));
      return res.status(400).json({ error: 'Parametros invalidos', details });
    }

    if (handleKnownReservationError(error, res)) {
      return;
    }

    return next(error);
  }
});

reservasRouter.patch("/:reservationId/televisor-displaced", requireAuthToken, async (req, res, next) => {
  try {
    const reservationId = z.string().uuid().parse(req.params.reservationId);
    const authUser = (req as AuthenticatedRequest).authUser;

    if (!authUser?.staffId) return res.status(401).json({ error: "No autorizado" });

    const isAdminOrMonitor = authUser.role === "admin" || authUser.role === "monitor";
    const reservation = await getReservationRequestById(reservationId);

    if (!reservation) {
      return res.status(404).json({ error: "No encontramos la solicitud de reserva." });
    }

    if (!isAdminOrMonitor && reservation.createdByStaffId !== authUser.staffId) {
      return res.status(403).json({ error: "No autorizado para modificar esta solicitud." });
    }

    const displaced = await markTelevisionDisplaced(reservationId);
    return res.json({ message: "Televisor marcado como desplazado.", reservationId: displaced.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues.map((iss) => ({ path: iss.path.map(String).join('.') || 'params', message: iss.message }));
      return res.status(400).json({ error: 'Parametros invalidos', details });
    }

    if (handleKnownReservationError(error, res)) {
      return;
    }

    return next(error);
  }
});

// Cancel a reservation (creator or admins/monitors)
reservasRouter.patch("/:reservationId/cancel", requireAuthToken, async (req, res, next) => {
  try {
    const reservationId = z.string().uuid().parse(req.params.reservationId);
    const authUser = (req as AuthenticatedRequest).authUser;

    if (!authUser?.staffId) return res.status(401).json({ error: "No autorizado" });

    const isAdminOrMonitor = authUser.role === "admin" || authUser.role === "monitor";
    const cancelled = await cancelReservationRequest(reservationId, authUser.staffId, isAdminOrMonitor);

    return res.json({ message: "Solicitud cancelada correctamente.", reservationId: cancelled.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues.map((iss) => ({ path: iss.path.map(String).join('.') || 'params', message: iss.message }));
      return res.status(400).json({ error: 'Parametros invalidos', details });
    }

    if (handleKnownReservationError(error, res)) {
      return;
    }

    return next(error);
  }
});

// Close / report closure of a reservation (creator or admins/monitors)
reservasRouter.patch("/:reservationId/close", requireAuthToken, async (req, res, next) => {
  try {
    const reservationId = z.string().uuid().parse(req.params.reservationId);
    const authUser = (req as AuthenticatedRequest).authUser;

    if (!authUser?.staffId) return res.status(401).json({ error: "No autorizado" });

    const isAdminOrMonitor = authUser.role === "admin" || authUser.role === "monitor";
    const closed = await closeReservationRequest(reservationId, authUser.staffId, isAdminOrMonitor);

    return res.json({ message: "Solicitud marcada como cerrada.", reservationId: closed.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues.map((iss) => ({ path: iss.path.map(String).join('.') || 'params', message: iss.message }));
      return res.status(400).json({ error: 'Parametros invalidos', details });
    }

    if (handleKnownReservationError(error, res)) {
      return;
    }

    return next(error);
  }
});

// Report a reservation (creator or admins/monitors) — marks as reportado
reservasRouter.patch("/:reservationId/report", requireAuthToken, async (req, res, next) => {
  try {
    const reservationId = z.string().uuid().parse(req.params.reservationId);
    const reportReason = z.string().trim().min(5).max(1000).optional().nullable().parse(req.body?.reportReason ?? null);
    const authUser = (req as AuthenticatedRequest).authUser;

    if (!authUser?.staffId) return res.status(401).json({ error: "No autorizado" });

    const isAdminOrMonitor = authUser.role === "admin" || authUser.role === "monitor";
    const reported = await reportReservationRequest(reservationId, authUser.staffId, isAdminOrMonitor, reportReason ?? null);

    if (reportReason) {
      console.warn(`[Reservas] Reporte de reserva ${reservationId}: ${reportReason}`);
    }

    return res.json({ message: "Solicitud marcada como reportada.", reservationId: reported.id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const details = error.issues.map((iss) => ({ path: iss.path.map(String).join('.') || 'params', message: iss.message }));
      return res.status(400).json({ error: 'Parametros invalidos', details });
    }

    if (handleKnownReservationError(error, res)) {
      return;
    }

    return next(error);
  }
});

reservasRouter.get("/:reservationId/confirm", async (req, res, next) => {
  try {
    const reservationId = z.string().uuid().parse(req.params.reservationId);
    const token = z.string().min(1).parse(req.query.token);

    // Debug mode: return raw DB fields for diagnosis when ?debug=1
    const debugMode = String(req.query.debug || "").toLowerCase() === "1" || String(req.query.debug || "").toLowerCase() === "true";
    if (debugMode) {
      const rows = await prisma.$queryRaw`
        SELECT confirmation_token, confirmation_token_expires_at, created_at
        FROM public.reservas_solicitudes
        WHERE id::text = ${reservationId}
      `;
      const row: any = (rows as any[])[0] ?? null;
      return res.json({ debug: true, reservationId, token: token as string, db: row });
    }

    const confirmationResult = await confirmReservationRequest(reservationId, token as string);
    const reservation = await getReservationRequestById(reservationId);

    if (!reservation) {
      return res.status(404).json({ error: "No encontramos la solicitud de reserva." });
    }

    const wantsJson = Boolean(
      String(req.query.format || "").toLowerCase() === "json" ||
        String(req.headers.accept || "").toLowerCase().includes("application/json")
    );

    if (wantsJson) {
      return res.json({
        message: confirmationResult.alreadyConfirmed ? "Esta solicitud ya estaba confirmada." : "Reserva confirmada",
        alreadyConfirmed: confirmationResult.alreadyConfirmed,
        reservation: {
          id: reservation.id,
          resourceLabel: reservation.resourceLabel,
          resourceType: reservation.resourceType,
          bookingDate: reservation.bookingDate,
          startTime: reservation.startTime,
          endTime: reservation.endTime,
          purpose: reservation.purpose,
          destinationRoomLabel: reservation.destinationRoomLabel ?? null,
          requesterName: reservation.requesterName,
          status: reservation.status,
        },
      });
    }

    const frontendBaseUrl = getFrontendBaseUrl();
    const logoUrl = `${frontendBaseUrl}/logo.png`;
    const resourceLabel = escapeHtml(reservation.resourceLabel);
    const requesterName = escapeHtml(reservation.requesterName);
    const bookingDate = escapeHtml(reservation.bookingDate);
    const startTime = escapeHtml(reservation.startTime);
    const endTime = escapeHtml(reservation.endTime);
    const purpose = escapeHtml(reservation.purpose);
    const resourceType = escapeHtml(reservation.resourceType === "rooms" ? "Salón / Aula" : "Equipo");
    const destinationRoom = reservation.destinationRoomLabel ? escapeHtml(reservation.destinationRoomLabel) : null;
    const noteText = reservation.resourceType === "equipment"
      ? `Debe devolver el equipo a más tardar a las ${endTime}. Si presenta daños, faltantes o incumplimiento del horario, podrá aplicar una penalización administrativa.`
      : `Debe dejar el salón en buen estado y cumplir el horario confirmado. El incumplimiento o cualquier daño reportado podrá generar penalizaciones administrativas.`;

    // Return HTML confirmation page
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Reserva Confirmada</title>
          <meta name="theme-color" content="#295786">
          <style>
            :root {
              color-scheme: light;
              --bg: #eef4fb;
              --card: #ffffff;
              --primary: #295786;
              --primary-strong: #1f4a74;
              --accent: #9f403d;
              --text: #1f2937;
              --muted: #5b6775;
              --line: #d9e3ef;
              --success: #18864b;
              --shadow: 0 24px 60px rgba(24, 39, 75, 0.15);
            }

            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background:
                radial-gradient(circle at top left, rgba(41, 87, 134, 0.14), transparent 34%),
                radial-gradient(circle at top right, rgba(159, 64, 61, 0.12), transparent 28%),
                linear-gradient(180deg, #f6f9fc 0%, var(--bg) 100%);
              color: var(--text);
              padding: 24px;
            }

            .container {
              width: min(760px, 100%);
              background: var(--card);
              border: 1px solid rgba(41, 87, 134, 0.14);
              border-radius: 28px;
              box-shadow: var(--shadow);
              overflow: hidden;
            }

            .hero {
              padding: 28px 28px 20px;
              background: linear-gradient(135deg, rgba(41, 87, 134, 0.08), rgba(159, 64, 61, 0.06));
              border-bottom: 1px solid var(--line);
            }

            .brand {
              display: flex;
              align-items: center;
              gap: 14px;
              margin-bottom: 18px;
            }

            .brand img {
              width: 56px;
              height: 56px;
              object-fit: contain;
              border-radius: 14px;
              background: white;
              border: 1px solid var(--line);
              padding: 6px;
            }

            .brand-copy small {
              display: block;
              color: var(--muted);
              font-size: 12px;
              font-weight: 700;
              letter-spacing: 0.16em;
              text-transform: uppercase;
            }

            .brand-copy h1 {
              margin: 4px 0 0;
              font-size: 22px;
              line-height: 1.1;
              color: var(--primary);
            }

            .hero-grid {
              display: grid;
              gap: 12px;
              grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
              margin-top: 14px;
            }

            .pill {
              display: inline-flex;
              align-items: center;
              gap: 8px;
              width: fit-content;
              border-radius: 999px;
              padding: 10px 14px;
              font-size: 13px;
              font-weight: 700;
            }

            .pill.success {
              background: rgba(24, 134, 75, 0.1);
              color: var(--success);
            }

            .content {
              padding: 28px;
            }

            .headline {
              margin: 0 0 8px;
              font-size: clamp(28px, 4vw, 40px);
              line-height: 1.05;
              color: var(--text);
            }

            .lead {
              margin: 0;
              font-size: 16px;
              color: var(--muted);
            }

            .details {
              margin-top: 22px;
              display: grid;
              gap: 14px;
              grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            }

            .detail-card,
            .warning {
              border: 1px solid var(--line);
              border-radius: 20px;
              background: #fbfdff;
            }

            .detail-card {
              padding: 18px;
            }

            .detail-label {
              display: block;
              font-size: 11px;
              letter-spacing: 0.14em;
              text-transform: uppercase;
              color: var(--muted);
              margin-bottom: 8px;
              font-weight: 800;
            }

            .detail-value {
              font-size: 15px;
              color: var(--text);
              font-weight: 700;
            }

            .warning {
              margin-top: 20px;
              padding: 18px;
              background: linear-gradient(135deg, rgba(159, 64, 61, 0.08), rgba(41, 87, 134, 0.04));
            }

            .warning h2 {
              margin: 0 0 8px;
              color: var(--accent);
              font-size: 18px;
            }

            .warning p {
              margin: 0;
              color: var(--text);
            }

            .actions {
              margin-top: 24px;
              display: flex;
              justify-content: center;
            }

            .button {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              background: linear-gradient(135deg, var(--primary), var(--primary-strong));
              color: white;
              padding: 14px 28px;
              text-decoration: none;
              border-radius: 999px;
              font-weight: 800;
              box-shadow: 0 12px 24px rgba(41, 87, 134, 0.25);
            }

            .footer {
              padding: 18px 28px 26px;
              border-top: 1px solid var(--line);
              color: var(--muted);
              font-size: 12px;
              text-align: center;
            }

            .footer strong {
              color: var(--text);
            }

            .success-icon {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              width: 72px;
              height: 72px;
              border-radius: 999px;
              background: rgba(24, 134, 75, 0.12);
              color: var(--success);
              font-size: 34px;
              font-weight: 900;
              margin-bottom: 16px;
            }

            .muted-note {
              margin-top: 14px;
              color: var(--muted);
              font-size: 13px;
              line-height: 1.6;
            }

            @media (max-width: 640px) {
              body {
                padding: 14px;
              }

              .hero,
              .content,
              .footer {
                padding-left: 18px;
                padding-right: 18px;
              }

              .brand-copy h1 {
                font-size: 18px;
              }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="hero">
              <div class="brand">
                <img src="${logoUrl}" alt="UNAC Bolivar Logo" />
                <div class="brand-copy">
                  <small>UNAC</small>
                  <h1>Administración del Edificio Bolivar Rave</h1>
                </div>
              </div>
              <span class="pill success">Reserva confirmada</span>
              <div class="hero-grid">
                <div class="detail-card">
                  <span class="detail-label">Solicitante</span>
                  <div class="detail-value">${requesterName}</div>
                </div>
                <div class="detail-card">
                  <span class="detail-label">Recurso</span>
                  <div class="detail-value">${resourceType}</div>
                </div>
                <div class="detail-card">
                  <span class="detail-label">Fecha</span>
                  <div class="detail-value">${bookingDate}</div>
                </div>
                <div class="detail-card">
                  <span class="detail-label">Horario</span>
                  <div class="detail-value">${startTime} - ${endTime}</div>
                </div>
              </div>
            </div>

            <div class="content">
              <div class="success-icon">✓</div>
              <h1 class="headline">¡Reserva Confirmada!</h1>
              <p class="lead">Tu solicitud ya quedó registrada y aprobada en el sistema.</p>

              <div class="details">
                <div class="detail-card">
                  <span class="detail-label">Espacio / Equipo</span>
                  <div class="detail-value">${resourceLabel}</div>
                </div>
                <div class="detail-card">
                  <span class="detail-label">Motivo</span>
                  <div class="detail-value">${purpose}</div>
                </div>
                ${destinationRoom ? `<div class="detail-card"><span class="detail-label">Lugar de entrega / destino</span><div class="detail-value">${destinationRoom}</div></div>` : ""}
                <div class="detail-card">
                  <span class="detail-label">Hora límite de devolución</span>
                  <div class="detail-value">${endTime}</div>
                </div>
              </div>

              <div class="warning">
                <h2>Importante</h2>
                <p>${noteText}</p>
                <p class="muted-note">Te recomendamos revisar el horario confirmado y entregar el salón o el elemento a tiempo y en buen estado para evitar observaciones o sanciones.</p>
              </div>

              <div class="actions">
                <a href="/" class="button">Volver al Inicio</a>
              </div>
            </div>

            <div class="footer">
              <div><strong>UNAC</strong> · Administración del Edificio Bolivar Rave</div>
              <div>Confirmación automática generada por la plataforma de reservas.</div>
            </div>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: `Parametros invalidos: ${error.issues[0]?.message ?? "error de validacion"}` });
    }

    if (handleKnownReservationError(error, res)) {
      return;
    }

    return next(error);
  }
});