import { getResendClient } from "../../lib/resend";

export type AuditorioReservaEmailHorario = {
  fechaEspecifica: string;
  horaInicio: string;
  horaFin: string;
};

export type AuditorioReservaEmailData = {
  reservaId: string;
  requesterName: string;
  requesterEmail: string;
  eventName: string;
  requesterPhone: string | null;
  periodStart: string;
  periodEnd: string;
  attendees: number;
  resources: string[];
  notes: string | null;
  horarios: AuditorioReservaEmailHorario[];
};

type EmailKind = "registered" | "confirmed" | "rejected";

const resend = getResendClient();

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatDateLabel = (value: string) => {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "long",
    timeZone: "America/Bogota",
  }).format(parsed);
};

const formatTimeLabel = (value: string) => {
  if (!value) return value;

  const [hoursText, minutesText] = value.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return value;
  }

  const suffix = hours >= 12 ? "PM" : "AM";
  const normalizedHour = ((hours + 11) % 12) + 1;
  return `${normalizedHour}:${String(minutes).padStart(2, "0")} ${suffix}`;
};

const formatResourceList = (resources: string[]) => {
  const filtered = resources.map((item) => item.trim()).filter(Boolean);
  if (filtered.length === 0) return "Sin recursos adicionales";
  if (filtered.length === 1) return filtered[0] ?? "Sin recursos adicionales";
  if (filtered.length === 2) return `${filtered[0] ?? ""} y ${filtered[1] ?? ""}`.trim();
  return `${filtered.slice(0, -1).join(", ")} y ${filtered[filtered.length - 1] ?? ""}`;
};

const formatScheduleList = (horarios: AuditorioReservaEmailHorario[]) =>
  horarios
    .map((horario) => {
      const date = escapeHtml(formatDateLabel(horario.fechaEspecifica));
      const start = escapeHtml(formatTimeLabel(horario.horaInicio));
      const end = escapeHtml(formatTimeLabel(horario.horaFin));
      return `<li><strong>${date}</strong><br />${start} - ${end}</li>`;
    })
    .join("");

const buildMessage = (kind: EmailKind, data: AuditorioReservaEmailData) => {
  const titleByKind: Record<EmailKind, string> = {
    registered: "Solicitud registrada",
    confirmed: "Reserva confirmada",
    rejected: "Reserva rechazada",
  };

  const eyebrowByKind: Record<EmailKind, string> = {
    registered: "Su solicitud fue recibida",
    confirmed: "La administración aprobó su reserva",
    rejected: "La administración no pudo aprobar su reserva",
  };

  const bodyByKind: Record<EmailKind, string> = {
    registered:
      "Su solicitud de reserva fue registrada correctamente. La administración la revisará y próximamente recibirá una respuesta con la decisión final.",
    confirmed:
      "Su reserva fue confirmada por la administración. A continuación encontrará el resumen con los datos aprobados para su evento.",
    rejected:
      "Después de revisar su solicitud, la administración decidió no aprobar la reserva. A continuación le compartimos el resumen registrado para su referencia.",
  };

  const requesterName = escapeHtml(data.requesterName);
  const requesterEmail = escapeHtml(data.requesterEmail);
  const requesterPhone = escapeHtml(data.requesterPhone ?? "No registrado");
  const eventName = escapeHtml(data.eventName);
  const periodStart = escapeHtml(formatDateLabel(data.periodStart));
  const periodEnd = escapeHtml(formatDateLabel(data.periodEnd));
  const resources = escapeHtml(formatResourceList(data.resources));
  const notes = escapeHtml(data.notes?.trim() || "Ninguna observación");
  const scheduleItems = formatScheduleList(data.horarios);
  const subject = {
    registered: `Solicitud registrada: ${data.eventName}`,
    confirmed: `Reserva confirmada: ${data.eventName}`,
    rejected: `Reserva rechazada: ${data.eventName}`,
  }[kind];

  const statusColor = {
    registered: "#1e40af",
    confirmed: "#166534",
    rejected: "#b91c1c",
  }[kind];

  return {
    subject,
    html: `
<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        background: #f3f7fb;
        font-family: Arial, Helvetica, sans-serif;
        color: #0f172a;
      }
      .wrapper {
        max-width: 680px;
        margin: 0 auto;
        background: #ffffff;
      }
      .header {
        background: linear-gradient(135deg, ${statusColor} 0%, #0f172a 100%);
        color: #ffffff;
        padding: 32px;
      }
      .header h1 {
        margin: 0 0 8px;
        font-size: 28px;
        line-height: 1.2;
      }
      .header p {
        margin: 0;
        opacity: 0.9;
      }
      .content {
        padding: 32px;
      }
      .eyebrow {
        color: ${statusColor};
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 12px;
        margin-bottom: 8px;
      }
      .lead {
        font-size: 16px;
        line-height: 1.7;
        color: #334155;
        margin: 0 0 24px;
      }
      .panel {
        border: 1px solid #dbe4ee;
        border-radius: 16px;
        background: #f8fafc;
        padding: 20px;
        margin: 24px 0;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
      }
      .field {
        padding: 12px 0;
        border-bottom: 1px solid #e2e8f0;
      }
      .field:last-child {
        border-bottom: 0;
      }
      .label {
        display: block;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #64748b;
        margin-bottom: 4px;
      }
      .value {
        font-size: 15px;
        line-height: 1.5;
        font-weight: 600;
        color: #0f172a;
      }
      .full {
        grid-column: 1 / -1;
      }
      ul {
        margin: 0;
        padding-left: 18px;
      }
      li {
        margin: 0 0 8px;
      }
      .note {
        margin-top: 24px;
        padding: 16px 18px;
        border-left: 4px solid ${statusColor};
        background: #f8fafc;
        color: #334155;
      }
      .footer {
        padding: 24px 32px 32px;
        color: #64748b;
        font-size: 12px;
      }
      .footer strong {
        color: #0f172a;
      }
      @media (max-width: 640px) {
        .header, .content, .footer {
          padding-left: 20px;
          padding-right: 20px;
        }
        .grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="header">
        <h1>${escapeHtml(titleByKind[kind])}</h1>
        <p>Auditorio - Corporación Universitaria Adventista de Colombia</p>
      </div>
      <div class="content">
        <div class="eyebrow">${escapeHtml(eyebrowByKind[kind])}</div>
        <p class="lead">${escapeHtml(bodyByKind[kind])}</p>

        <div class="panel">
          <div class="grid">
            <div class="field">
              <span class="label">Evento</span>
              <span class="value">${eventName}</span>
            </div>
            <div class="field">
              <span class="label">Solicitante</span>
              <span class="value">${requesterName}</span>
            </div>
            <div class="field">
              <span class="label">Correo</span>
              <span class="value">${requesterEmail}</span>
            </div>
            <div class="field">
              <span class="label">Teléfono</span>
              <span class="value">${requesterPhone}</span>
            </div>
            <div class="field">
              <span class="label">Periodo</span>
              <span class="value">${periodStart} - ${periodEnd}</span>
            </div>
            <div class="field">
              <span class="label">Asistentes</span>
              <span class="value">${data.attendees}</span>
            </div>
            <div class="field full">
              <span class="label">Recursos</span>
              <span class="value">${resources}</span>
            </div>
            <div class="field full">
              <span class="label">Horarios</span>
              <div class="value">
                <ul>${scheduleItems}</ul>
              </div>
            </div>
            <div class="field full">
              <span class="label">Observaciones</span>
              <span class="value">${notes}</span>
            </div>
          </div>
        </div>

        <div class="note">
          <strong>Referencia de solicitud:</strong> ${escapeHtml(data.reservaId)}
        </div>
      </div>
      <div class="footer">
        <p><strong>Administración del auditorio</strong></p>
        <p>Este es un correo automático. Por favor, no responda a este mensaje.</p>
      </div>
    </div>
  </body>
</html>
    `.trim(),
  };
};

const sendAuditorioEmail = async (kind: EmailKind, data: AuditorioReservaEmailData): Promise<{ success: boolean; error?: string }> => {
  // Resolve the client at send time so dotenv-loaded configuration is used
  // even when this module was imported before the environment was initialized.
  const client = resend ?? getResendClient();
  if (!client || !process.env.RESEND_API_KEY) {
    console.warn(`[auditorio] RESEND_API_KEY no configurada; correo omitido (${kind}) para reserva ${data.reservaId}`);
    return { success: false, error: "RESEND_API_KEY no configurada" };
  }

  if (!data.requesterEmail || !data.requesterEmail.includes("@")) {
    console.warn(`[auditorio] no se envio correo ${kind} para ${data.reservaId} porque el destinatario no es valido`);
    return { success: false, error: "No email provided" };
  }

  try {
    const message = buildMessage(kind, data);
    let lastError = "Error desconocido de Resend";

    // A transient provider/network failure should not silently lose the
    // important registration notification. Retry once before reporting it.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await client.emails.send({
        from: process.env.AUDITORIO_RESEND_FROM ?? "bolivar-rave-reservas@unac.edu.co",
        to: data.requesterEmail,
        subject: message.subject,
        html: message.html,
      });

      if (!response.error) {
        console.log(`[auditorio] correo ${kind} enviado para ${data.reservaId} a ${data.requesterEmail} (id: ${response.data?.id ?? "sin-id"})`);
        return { success: true };
      }

      lastError = response.error.message;
      console.error(`[auditorio] intento ${attempt}/2 fallido para correo ${kind} de ${data.reservaId}:`, response.error);
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    return { success: false, error: lastError };
  } catch (error) {
    console.error(`[auditorio] error enviando correo ${kind} para ${data.reservaId}:`, error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
};

export const sendAuditorioSolicitudRegistradaEmail = async (data: AuditorioReservaEmailData) =>
  sendAuditorioEmail("registered", data);

export const sendAuditorioReservaConfirmadaEmail = async (data: AuditorioReservaEmailData) =>
  sendAuditorioEmail("confirmed", data);

export const sendAuditorioReservaRechazadaEmail = async (data: AuditorioReservaEmailData) =>
  sendAuditorioEmail("rejected", data);
