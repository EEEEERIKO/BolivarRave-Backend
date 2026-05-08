import { Resend } from "resend";
import fs from "fs";
import path from "path";

const resend = new Resend(process.env.RESEND_API_KEY);

export interface ReservationEmailData {
  id: string;
  requesterName: string;
  requesterEmail: string;
  resourceLabel: string;
  resourceType: "rooms" | "equipment";
  bookingDate: string;
  startTime: string;
  endTime: string;
  purpose: string;
  destinationRoom?: string;
  confirmationToken: string;
}

const getConfirmationUrl = (reservationId: string, token: string): string => {
  const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  return `${baseUrl}/reservas/confirm?reservationId=${reservationId}&token=${token}`;
};

const getFrontendBaseUrl = (): string => {
  const baseUrl = (process.env.FRONTEND_URL ?? "http://localhost:3000").trim();
  return baseUrl.replace(/\/+$/, "");
};

const tryReadLogoDataUri = (): string | null => {
  try {
    // Resolve logo path relative to the backend working directory into the frontend public folder
    const candidate = path.resolve(process.cwd(), "../frontend/public/logo.png");
    if (fs.existsSync(candidate)) {
      const buf = fs.readFileSync(candidate);
      const b64 = buf.toString("base64");
      return `data:image/png;base64,${b64}`;
    }
  } catch (err) {
    // ignore and fallback to remote URL
  }

  return null;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatReservationType = (resourceType: string): string => {
  return resourceType === "rooms" ? "Salón/Aula" : "Equipo";
};

const buildEmailHtml = (data: ReservationEmailData): string => {
  const confirmUrl = getConfirmationUrl(data.id, data.confirmationToken);
  const frontendBaseUrl = getFrontendBaseUrl();
  const inlineLogo = tryReadLogoDataUri();
  const logoUrl = inlineLogo || `${frontendBaseUrl}/logo.png`;
  const resourceType = formatReservationType(data.resourceType);
  const resourceLabel = escapeHtml(data.resourceLabel);
  const requesterName = escapeHtml(data.requesterName);
  const bookingDate = escapeHtml(data.bookingDate);
  const startTime = escapeHtml(data.startTime);
  const endTime = escapeHtml(data.endTime);
  const purpose = escapeHtml(data.purpose);
  const destinationRoom = data.destinationRoom ? escapeHtml(data.destinationRoom) : null;
  const returnWarning = data.resourceType === "equipment"
    ? `Debes devolver el equipo a más tardar a las ${endTime}. Si se daña, falta algún componente o se incumple el horario, puede aplicar una penalización.`
    : `Debes dejar el salón en buen estado y respetar el horario confirmado. El incumplimiento o cualquier daño reportado puede generar una penalización.`;

  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
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
      }

      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        margin: 0;
        padding: 24px;
        line-height: 1.6;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(41, 87, 134, 0.14), transparent 34%),
          radial-gradient(circle at top right, rgba(159, 64, 61, 0.12), transparent 28%),
          linear-gradient(180deg, #f6f9fc 0%, var(--bg) 100%);
      }

      .container {
        max-width: 760px;
        margin: 0 auto;
        overflow: hidden;
        border: 1px solid rgba(41, 87, 134, 0.14);
        border-radius: 28px;
        background: var(--card);
        box-shadow: 0 24px 60px rgba(24, 39, 75, 0.15);
      }

      .header {
        padding: 28px;
        border-bottom: 1px solid var(--line);
        background: linear-gradient(135deg, rgba(41, 87, 134, 0.08), rgba(159, 64, 61, 0.06));
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

      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        width: fit-content;
        border-radius: 999px;
        padding: 10px 14px;
        font-size: 13px;
        font-weight: 700;
        background: rgba(24, 134, 75, 0.1);
        color: var(--success);
      }

      .content {
        padding: 28px;
      }

      .headline {
        margin: 16px 0 8px;
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

      .detail-row {
        border: 1px solid var(--line);
        border-radius: 20px;
        background: #fbfdff;
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
        color: var(--text);
        font-size: 15px;
        font-weight: 700;
      }

      .warning {
        margin-top: 20px;
        padding: 18px;
        border: 1px solid rgba(159, 64, 61, 0.25);
        border-radius: 20px;
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

      .button-container {
        text-align: center;
        margin: 24px 0 0;
      }

      .confirm-button {
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
        text-align: center;
        color: var(--muted);
        font-size: 12px;
        margin-top: 0;
        border-top: 1px solid var(--line);
        padding: 18px 28px 26px;
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
        margin-bottom: 6px;
      }

      .muted-note {
        margin-top: 14px;
        color: var(--muted);
        font-size: 13px;
      }

      .copy-link {
        margin-top: 14px;
        color: var(--muted);
        font-size: 12px;
        text-align: center;
      }

      .copy-link code {
        word-break: break-all;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div class="brand">
          <img src="${logoUrl}" alt="UNAC Bolivar Logo">
          <div class="brand-copy">
            <small>UNAC</small>
            <h1>Administración del Edificio Bolivar Rave</h1>
          </div>
        </div>
        <span class="pill">Reserva confirmada</span>
      </div>
      
      <div class="content">
        <div class="success-icon">✓</div>
        <h1 class="headline">¡Reserva Confirmada!</h1>
        <p class="lead">${requesterName}, tu solicitud ya quedó confirmada en el sistema.</p>
        
        <div class="details">
          <div class="detail-row">
            <span class="detail-label">Tipo de Recurso</span>
            <span class="detail-value">${resourceType}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Recurso</span>
            <span class="detail-value">${resourceLabel}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Fecha de Reserva</span>
            <span class="detail-value">${bookingDate}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Hora Inicio</span>
            <span class="detail-value">${startTime}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Hora Fin / Devolución</span>
            <span class="detail-value">${endTime}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Propósito</span>
            <span class="detail-value">${purpose}</span>
          </div>
          ${
            destinationRoom
              ? `<div class="detail-row">
            <span class="detail-label">Ubicación de Entrega</span>
            <span class="detail-value">${destinationRoom}</span>
          </div>`
              : ""
          }
        </div>
        
        <div class="warning">
          <h2>Importante</h2>
          <p>${returnWarning}</p>
          <p class="muted-note">El incumplimiento del horario o la entrega en mal estado puede conllevar observaciones administrativas o penalizaciones internas.</p>
        </div>
        
        <div class="button-container">
          <a href="${confirmUrl}" class="confirm-button">Revisar confirmación</a>
        </div>
        
        <p class="copy-link">
          Si el botón anterior no funciona, copia y pega este enlace en tu navegador:<br>
          <code>${confirmUrl}</code>
        </p>
      </div>
      
      <div class="footer">
        <p><strong>UNAC</strong> · Administración del Edificio Bolivar Rave</p>
        <p>Este es un correo automático de la plataforma de reservas. Por favor no respondas a este correo.</p>
        <p>&copy; 2026 UNAC Bolívar. Todos los derechos reservados.</p>
      </div>
    </div>
  </body>
</html>
  `;
};

export const sendReservationConfirmationEmail = async (data: ReservationEmailData): Promise<{ success: boolean; error?: string }> => {
  try {
    if (!data.requesterEmail) {
      console.warn(`No email provided for reservation ${data.id}`);
      return { success: false, error: "No email provided" };
    }

    const html = buildEmailHtml(data);

    const response = await resend.emails.send({
      from: "onboarding@resend.dev",
      to: data.requesterEmail,
      subject: `Confirmación de Reserva - ${data.resourceLabel}`,
      html,
    });

    if (response.error) {
      console.error(`Failed to send email for reservation ${data.id}:`, response.error);
      return { success: false, error: response.error.message };
    }

    console.log(`Email sent successfully for reservation ${data.id}`);
    return { success: true };
  } catch (error) {
    console.error(`Error sending email for reservation ${data.id}:`, error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
};
