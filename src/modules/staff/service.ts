import { prisma } from "../../lib/prisma";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

export type StaffEstado = "Active" | "Inactive";

export type StaffBloqueoClaseInput = {
  diaSemana: string;
  horaInicio: string;
  horaFin: string;
};

export type StaffJornadaInput = {
  diaSemana: string;
  horaEntrada: string;
  horaSalida: string;
  totalHorasDia: number;
};

export type StaffPausaInput = {
  diaSemana: string;
  tipoPausa: "Comida" | "Descanso";
  horaInicio: string;
  horaFin: string;
};

export type StaffResumenContratoInput = {
  horasSemanalesContrato: number;
  balanceHoras: number;
};

export type CreateStaffInput = {
  numeroStaff?: number;
  roleId: number;
  rol: string;
  nombres: string;
  apellidos: string;
  cedula: string;
  telefono: string;
  fechaNacimiento: Date;
  carrera: string;
  tipoContrato: string;
  conocimientoSonido: boolean;
  estado: StaffEstado;
  balanceHoras: number;
  password?: string;
  habilidadIds: string[];
  bloqueosClase: StaffBloqueoClaseInput[];
};

export type UpdateStaffInput = CreateStaffInput & {
  numeroStaff: number;
  id: string;
};

type StaffRawRow = {
  id: string;
  numero_staff: number;
  role_id: number;
  rol: string;
  nombres: string;
  apellidos: string;
  cedula: string;
  telefono: string;
  fecha_nacimiento: string;
  carrera: string;
  tipo_contrato: string;
  conocimiento_sonido: boolean;
  estado: StaffEstado;
  balance_horas: number;
  fecha_creacion: string;
  bloqueo_id: string | null;
  bloqueo_dia_semana: string | null;
  bloqueo_hora_inicio: string | null;
  bloqueo_hora_fin: string | null;
  habilidad_id: string | null;
  habilidad_nombre: string | null;
  tiene_credencial: boolean;
};

type StaffSkillRawRow = {
  id: string;
  nombre: string;
};

type StaffJornadaRawRow = {
  id: string;
  staff_id: string;
  dia_semana: string;
  hora_entrada: string;
  hora_salida: string;
  total_horas_dia: number;
};

type StaffPausaRawRow = {
  id: string;
  staff_id: string;
  dia_semana: string;
  tipo_pausa: "Comida" | "Descanso";
  hora_inicio: string;
  hora_fin: string;
};

type StaffResumenContratoRawRow = {
  staff_id: string;
  horas_semanales_contrato: number;
  balance_horas: number;
};

type StaffBalanceMovimientoRawRow = {
  id: string;
  staff_id: string;
  horas_delta: number;
  motivo: string | null;
  creado_por_staff_id: string | null;
  created_at: string;
};

export type StaffBalanceMovimientoInput = {
  horasDelta: number;
  motivo?: string;
  creadoPorStaffId?: string;
};

type StaffLoginRawRow = {
  id: string;
  role_id: number;
  rol: string;
  nombres: string;
  apellidos: string;
  cedula: string;
  estado: StaffEstado;
  password_hash: string | null;
};

export type StaffLoginPortal = "admin-monitor" | "colaborador";

export type StaffLoginResult = {
  staffId: string;
  cedula: string;
  role: "admin" | "monitor" | "colaborador" | "registro";
  roleLabel: string;
  name: string;
};

type StaffRefreshTokenRow = {
  id: string;
  staff_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
};

const REFRESH_TOKEN_TTL_DAYS = Math.max(7, Number.parseInt(process.env.AUTH_REFRESH_TOKEN_TTL_DAYS ?? "3650", 10) || 3650);

export class StaffAuthError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "StaffAuthError";
    this.status = status;
  }
}

let ensureStaffHorarioLaboralSchemaPromise: Promise<void> | null = null;
let ensureStaffSecuritySchemaPromise: Promise<void> | null = null;
let ensureStaffSessionSchemaPromise: Promise<void> | null = null;
const scryptAsync = promisify(scryptCallback);
// role ids: 1 = admin, 2 = monitor, 3 = colaborador, 4 = registro
const CREDENTIAL_REQUIRED_ROLE_IDS = new Set([1, 2, 4]);

const ensureStaffHorarioLaboralSchema = async () => {
  // These tables should be created by migrations
  // Attempting to create them at runtime on Supabase causes timeouts
  // This function is a no-op - tables must exist from initial migration
  console.log("[staff-schema] Skipping dynamic schema creation (should use migrations)");
};

const ensureStaffSecuritySchema = async () => {
  // These tables should be created by migrations
  // Attempting to create them at runtime on Supabase causes timeouts
  // This function is a no-op - tables must exist from initial migration
  console.log("[staff-schema] Skipping dynamic schema creation (should use migrations)");
};

const ensureStaffSessionSchema = async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS public.staff_refresh_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      replaced_by_token_hash text,
      created_from_ip text,
      user_agent text
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_staff_refresh_tokens_staff_id
    ON public.staff_refresh_tokens (staff_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_staff_refresh_tokens_expires_at
    ON public.staff_refresh_tokens (expires_at)
  `);
};

const ensureStaffHorarioLaboralSchemaReady = async () => {
  if (!ensureStaffHorarioLaboralSchemaPromise) {
    ensureStaffHorarioLaboralSchemaPromise = ensureStaffHorarioLaboralSchema().catch((error) => {
      ensureStaffHorarioLaboralSchemaPromise = null;
      throw error;
    });
  }

  await ensureStaffHorarioLaboralSchemaPromise;
};

const ensureStaffSecuritySchemaReady = async () => {
  if (!ensureStaffSecuritySchemaPromise) {
    ensureStaffSecuritySchemaPromise = ensureStaffSecuritySchema().catch((error) => {
      ensureStaffSecuritySchemaPromise = null;
      throw error;
    });
  }

  await ensureStaffSecuritySchemaPromise;
};

const ensureStaffSessionSchemaReady = async () => {
  if (!ensureStaffSessionSchemaPromise) {
    ensureStaffSessionSchemaPromise = ensureStaffSessionSchema().catch((error) => {
      ensureStaffSessionSchemaPromise = null;
      throw error;
    });
  }

  await ensureStaffSessionSchemaPromise;
};

const hashRefreshToken = (token: string) => createHash("sha256").update(token).digest("hex");

const getRefreshTokenExpiryDate = () => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);
  return expiresAt;
};

const toStaffSession = (staff: StaffLoginRawRow): StaffLoginResult => ({
  staffId: staff.id,
  cedula: staff.cedula,
  role: mapRoleFromRoleId(staff.role_id),
  roleLabel: staff.rol,
  name: `${staff.nombres} ${staff.apellidos}`.trim(),
});

const getStaffSessionById = async (staffId: string): Promise<StaffLoginResult | null> => {
  const rows = await prisma.$queryRaw<StaffLoginRawRow[]>`
    SELECT
      s.id::text AS id,
      s.role_id,
      s.rol,
      s.nombres,
      s.apellidos,
      s.cedula,
      s.estado,
      c.password_hash
    FROM public.staff s
    LEFT JOIN public.staff_credentials c ON c.staff_id = s.id
    WHERE s.id = ${staffId}::uuid
    LIMIT 1
  `;

  const staff = rows[0];
  if (!staff || staff.estado !== "Active") {
    return null;
  }

  return toStaffSession(staff);
};

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);

const hashPassword = async (password: string) => {
  const salt = randomBytes(16);
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;

  return `scrypt$N=16384,r=8,p=1$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
};

const verifyPasswordHash = async (plainPassword: string, storedHash: string) => {
  const parts = storedHash.split("$");
  if (parts.length !== 4) {
    return false;
  }

  const [algo, _params, saltHex, keyHex] = parts;
  if (algo !== "scrypt" || !saltHex || !keyHex) {
    return false;
  }

  const salt = Buffer.from(saltHex, "hex");
  const expectedKey = Buffer.from(keyHex, "hex");
  if (expectedKey.length === 0) {
    return false;
  }

  const derivedKey = (await scryptAsync(plainPassword, salt, expectedKey.length)) as Buffer;
  if (derivedKey.length !== expectedKey.length) {
    return false;
  }

  return timingSafeEqual(derivedKey, expectedKey);
};

const mapRoleFromRoleId = (roleId: number): StaffLoginResult["role"] => {
  if (roleId === 1) return "admin";
  if (roleId === 2) return "monitor";
  if (roleId === 4) return "registro";
  return "colaborador";
};

const getNextStaffNumberTx = async (tx: Pick<typeof prisma, "$queryRaw">) => {
  const rows = await tx.$queryRaw<Array<{ numero_staff: number }>>`
    WITH ordered AS (
      SELECT
        numero_staff,
        LEAD(numero_staff) OVER (ORDER BY numero_staff) AS next_num
      FROM public.staff
    )
    SELECT COALESCE(
      (
        SELECT 1
        WHERE NOT EXISTS (
          SELECT 1 FROM public.staff WHERE numero_staff = 1
        )
      ),
      (
        SELECT numero_staff + 1
        FROM ordered
        WHERE next_num IS NOT NULL
          AND next_num > numero_staff + 1
        ORDER BY numero_staff
        LIMIT 1
      ),
      (
        SELECT COALESCE(MAX(numero_staff), 0) + 1 FROM public.staff
      )
    )::int AS numero_staff
  `;

  return rows[0]?.numero_staff ?? 1;
};

const syncStaffSkills = async (
  tx: Pick<typeof prisma, "$executeRaw">,
  staffId: string,
  habilidadIds: string[],
) => {
  await tx.$executeRaw`
    DELETE FROM public.staff_habilidades
    WHERE staff_id = ${staffId}::uuid
  `;

  const uniqueIds = Array.from(new Set(habilidadIds));
  for (const habilidadId of uniqueIds) {
    await tx.$executeRaw`
      INSERT INTO public.staff_habilidades (staff_id, habilidad_id)
      VALUES (${staffId}::uuid, ${habilidadId}::uuid)
    `;
  }
};

const upsertStaffCredential = async (
  tx: Pick<typeof prisma, "$executeRaw">,
  staffId: string,
  password: string,
) => {
  const passwordHash = await hashPassword(password);

  await tx.$executeRaw`
    INSERT INTO public.staff_credentials (staff_id, password_hash, password_algo)
    VALUES (${staffId}::uuid, ${passwordHash}, 'scrypt')
    ON CONFLICT (staff_id)
    DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      password_algo = EXCLUDED.password_algo,
      password_updated_at = now()
  `;
};

const deleteStaffCredential = async (
  tx: Pick<typeof prisma, "$executeRaw">,
  staffId: string,
) => {
  await tx.$executeRaw`
    DELETE FROM public.staff_credentials
    WHERE staff_id = ${staffId}::uuid
  `;
};

const hasStaffCredentialTx = async (tx: Pick<typeof prisma, "$queryRaw">, staffId: string) => {
  const rows = await tx.$queryRaw<Array<{ has_credential: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM public.staff_credentials c
      WHERE c.staff_id = ${staffId}::uuid
    ) AS has_credential
  `;

  return Boolean(rows[0]?.has_credential);
};

const mapStaffRows = (rows: StaffRawRow[]) => {
  const byId = new Map<
    string,
    {
      id: string;
      numeroStaff: number;
      roleId: number;
      rol: string;
      nombres: string;
      apellidos: string;
      cedula: string;
      telefono: string;
      fechaNacimiento: string;
      carrera: string;
      tipoContrato: string;
      conocimientoSonido: boolean;
      estado: StaffEstado;
      balanceHoras: number;
      fechaCreacion: string;
      tieneCredencial: boolean;
      habilidades: Array<{
        id: string;
        nombre: string;
      }>;
      bloqueosClase: Array<{
        id: string;
        diaSemana: string;
        horaInicio: string;
        horaFin: string;
      }>;
      _bloqueoIds: Set<string>;
      _habilidadIds: Set<string>;
    }
  >();

  for (const row of rows) {
    const current = byId.get(row.id);

    if (!current) {
      byId.set(row.id, {
        id: row.id,
        numeroStaff: row.numero_staff,
        roleId: row.role_id,
        rol: row.rol,
        nombres: row.nombres,
        apellidos: row.apellidos,
        cedula: row.cedula,
        telefono: row.telefono,
        fechaNacimiento: row.fecha_nacimiento,
        carrera: row.carrera,
        tipoContrato: row.tipo_contrato,
        conocimientoSonido: row.conocimiento_sonido,
        estado: row.estado,
        balanceHoras: row.balance_horas,
        fechaCreacion: row.fecha_creacion,
        tieneCredencial: row.tiene_credencial,
        habilidades:
          row.habilidad_id && row.habilidad_nombre
            ? [{ id: row.habilidad_id, nombre: row.habilidad_nombre }]
            : [],
        bloqueosClase:
          row.bloqueo_id && row.bloqueo_dia_semana && row.bloqueo_hora_inicio && row.bloqueo_hora_fin
            ? [
                {
                  id: row.bloqueo_id,
                  diaSemana: row.bloqueo_dia_semana,
                  horaInicio: row.bloqueo_hora_inicio,
                  horaFin: row.bloqueo_hora_fin,
                },
              ]
            : [],
        _bloqueoIds: row.bloqueo_id ? new Set([row.bloqueo_id]) : new Set<string>(),
        _habilidadIds: row.habilidad_id ? new Set([row.habilidad_id]) : new Set<string>(),
      });
      continue;
    }

    if (
      row.bloqueo_id &&
      row.bloqueo_dia_semana &&
      row.bloqueo_hora_inicio &&
      row.bloqueo_hora_fin &&
      !current._bloqueoIds.has(row.bloqueo_id)
    ) {
      current._bloqueoIds.add(row.bloqueo_id);
      current.bloqueosClase.push({
        id: row.bloqueo_id,
        diaSemana: row.bloqueo_dia_semana,
        horaInicio: row.bloqueo_hora_inicio,
        horaFin: row.bloqueo_hora_fin,
      });
    }

    if (row.habilidad_id && row.habilidad_nombre && !current._habilidadIds.has(row.habilidad_id)) {
      current._habilidadIds.add(row.habilidad_id);
      current.habilidades.push({
        id: row.habilidad_id,
        nombre: row.habilidad_nombre,
      });
    }
  }

  return Array.from(byId.values()).map((item) => {
    const { _bloqueoIds: _ignoreBloqueos, _habilidadIds: _ignoreHabilidades, ...staff } = item;
    return staff;
  });
};

export const listStaffSkills = async () => {
  await ensureStaffSecuritySchemaReady();

  const rows = await prisma.$queryRaw<StaffSkillRawRow[]>`
    SELECT
      h.id::text AS id,
      h.nombre
    FROM public.habilidades h
    ORDER BY h.nombre ASC
  `;

  return rows;
};

export const getNextStaffNumber = async () => {
  await ensureStaffSecuritySchemaReady();
  return getNextStaffNumberTx(prisma);
};

export const authenticateStaffLogin = async (payload: {
  cedula: string;
  portal: StaffLoginPortal;
  password?: string;
}): Promise<StaffLoginResult> => {
  await ensureStaffSecuritySchemaReady();

  console.log("Intentando login:", payload.cedula);

  const testConnection = await prisma.$queryRaw`
    SELECT NOW();
  `;

  console.log("DB responde:", testConnection);

  const rows = await prisma.$queryRaw<StaffLoginRawRow[]>`
    SELECT
      s.id::text AS id,
      s.role_id,
      s.rol,
      s.nombres,
      s.apellidos,
      s.cedula,
      s.estado,
      c.password_hash
    FROM public.staff s
    LEFT JOIN public.staff_credentials c ON c.staff_id = s.id
    WHERE s.cedula = ${payload.cedula}
    LIMIT 1
  `;

  const staff = rows[0];
  if (!staff) {
    throw new StaffAuthError("Credenciales inválidas. Verifica la información ingresada.", 401);
  }

  if (staff.estado !== "Active") {
    throw new StaffAuthError("La cuenta se encuentra inactiva. Contacta al administrador.", 403);
  }

  const requiresPassword = CREDENTIAL_REQUIRED_ROLE_IDS.has(staff.role_id);

  if (payload.portal === "admin-monitor") {
    if (!requiresPassword) {
      throw new StaffAuthError("Este usuario no tiene acceso al portal de admin/monitor.", 403);
    }

    if (!payload.password) {
      throw new StaffAuthError("La contraseña es obligatoria para este acceso.", 400);
    }

    if (!staff.password_hash) {
      throw new StaffAuthError("No hay credenciales registradas para este usuario.", 403);
    }

    const isPasswordValid = await verifyPasswordHash(payload.password, staff.password_hash);
    if (!isPasswordValid) {
      throw new StaffAuthError("Credenciales inválidas. Verifica la información ingresada.", 401);
    }
  }

  if (payload.portal === "colaborador" && requiresPassword) {
    throw new StaffAuthError("Este usuario debe ingresar por el portal de admin/monitor.", 403);
  }

  return toStaffSession(staff);
};

export const createStaffRefreshToken = async (payload: {
  staffId: string;
  ip?: string | null;
  userAgent?: string | null;
}) => {
  await ensureStaffSessionSchemaReady();

  const token = randomBytes(48).toString("base64url");
  const tokenHash = hashRefreshToken(token);
  const expiresAt = getRefreshTokenExpiryDate();

  await prisma.$executeRaw`
    INSERT INTO public.staff_refresh_tokens (
      staff_id,
      token_hash,
      expires_at,
      created_from_ip,
      user_agent
    )
    VALUES (
      ${payload.staffId}::uuid,
      ${tokenHash},
      ${expiresAt.toISOString()}::timestamptz,
      ${payload.ip?.trim() || null},
      ${payload.userAgent?.trim() || null}
    )
  `;

  return {
    token,
    expiresAt,
  };
};

export const revokeStaffRefreshToken = async (rawToken: string) => {
  await ensureStaffSessionSchemaReady();

  const tokenHash = hashRefreshToken(rawToken);
  await prisma.$executeRaw`
    UPDATE public.staff_refresh_tokens
    SET revoked_at = now(),
        updated_at = now()
    WHERE token_hash = ${tokenHash}
      AND revoked_at IS NULL
  `;
};

export const rotateStaffRefreshToken = async (payload: {
  refreshToken: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ session: StaffLoginResult; refreshToken: string; refreshTokenExpiresAt: Date }> => {
  await ensureStaffSessionSchemaReady();

  const currentHash = hashRefreshToken(payload.refreshToken);
  const now = new Date();

  const currentRows = await prisma.$queryRaw<StaffRefreshTokenRow[]>`
    SELECT
      id::text AS id,
      staff_id::text AS staff_id,
      token_hash,
      expires_at::text AS expires_at,
      revoked_at::text AS revoked_at
    FROM public.staff_refresh_tokens
    WHERE token_hash = ${currentHash}
    LIMIT 1
  `;

  const current = currentRows[0];
  if (!current || current.revoked_at || new Date(current.expires_at).getTime() <= now.getTime()) {
    throw new StaffAuthError("Sesion invalida o expirada", 401);
  }

  const session = await getStaffSessionById(current.staff_id);
  if (!session) {
    throw new StaffAuthError("Sesion invalida o expirada", 401);
  }

  const nextToken = randomBytes(48).toString("base64url");
  const nextHash = hashRefreshToken(nextToken);
  const nextExpiry = getRefreshTokenExpiryDate();

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE public.staff_refresh_tokens
      SET revoked_at = now(),
          replaced_by_token_hash = ${nextHash},
          updated_at = now()
      WHERE token_hash = ${currentHash}
        AND revoked_at IS NULL
    `;

    await tx.$executeRaw`
      INSERT INTO public.staff_refresh_tokens (
        staff_id,
        token_hash,
        expires_at,
        created_from_ip,
        user_agent
      )
      VALUES (
        ${session.staffId}::uuid,
        ${nextHash},
        ${nextExpiry.toISOString()}::timestamptz,
        ${payload.ip?.trim() || null},
        ${payload.userAgent?.trim() || null}
      )
    `;
  }, { timeout: 20000, maxWait: 10000 });

  return {
    session,
    refreshToken: nextToken,
    refreshTokenExpiresAt: nextExpiry,
  };
};

export const changeStaffPassword = async (payload: {
  cedula: string;
  currentPassword: string;
  newPassword: string;
}) => {
  await ensureStaffSecuritySchemaReady();

  const rows = await prisma.$queryRaw<StaffLoginRawRow[]>`
    SELECT
      s.id::text AS id,
      s.role_id,
      s.rol,
      s.nombres,
      s.apellidos,
      s.cedula,
      s.estado,
      c.password_hash
    FROM public.staff s
    LEFT JOIN public.staff_credentials c ON c.staff_id = s.id
    WHERE s.cedula = ${payload.cedula}
    LIMIT 1
  `;

  const staff = rows[0];
  if (!staff) {
    throw new StaffAuthError("Usuario no encontrado para actualizar contraseña.", 404);
  }

  if (staff.estado !== "Active") {
    throw new StaffAuthError("La cuenta se encuentra inactiva. Contacta al administrador.", 403);
  }

  if (!CREDENTIAL_REQUIRED_ROLE_IDS.has(staff.role_id)) {
    throw new StaffAuthError("Este usuario no usa contraseña para iniciar sesión en este portal.", 400);
  }

  if (!staff.password_hash) {
    throw new StaffAuthError("No hay credenciales registradas para este usuario.", 403);
  }

  const isCurrentPasswordValid = await verifyPasswordHash(payload.currentPassword, staff.password_hash);
  if (!isCurrentPasswordValid) {
    throw new StaffAuthError("La contraseña actual no es correcta.", 401);
  }

  if (payload.currentPassword === payload.newPassword) {
    throw new StaffAuthError("La nueva contraseña debe ser diferente a la actual.", 400);
  }

  await prisma.$transaction(async (tx) => {
    await upsertStaffCredential(tx, staff.id, payload.newPassword);
  }, { timeout: 20000, maxWait: 10000 });

  return { staffId: staff.id };
};

export const listStaff = async () => {
  await ensureStaffSecuritySchemaReady();

  const rows = await prisma.$queryRaw<StaffRawRow[]>`
    SELECT
      s.id::text AS id,
      s.numero_staff,
      s.role_id,
      s.rol,
      s.nombres,
      s.apellidos,
      s.cedula,
      s.telefono,
      TO_CHAR(s.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
      s.carrera,
      s.tipo_contrato,
      s.conocimiento_sonido,
      s.estado,
      s.balance_horas,
      TO_CHAR(s.fecha_creacion, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fecha_creacion,
      b.id::text AS bloqueo_id,
      b.dia_semana AS bloqueo_dia_semana,
      CASE
        WHEN b.hora_inicio IS NULL THEN NULL
        ELSE TO_CHAR(b.hora_inicio, 'HH24:MI')
      END AS bloqueo_hora_inicio,
      CASE
        WHEN b.hora_fin IS NULL THEN NULL
        ELSE TO_CHAR(b.hora_fin, 'HH24:MI')
      END AS bloqueo_hora_fin
      , h.id::text AS habilidad_id
      , h.nombre AS habilidad_nombre
      , (c.staff_id IS NOT NULL) AS tiene_credencial
    FROM public.staff s
    LEFT JOIN public.staff_bloqueos_clase b ON b.staff_id = s.id
    LEFT JOIN public.staff_habilidades sh ON sh.staff_id = s.id
    LEFT JOIN public.habilidades h ON h.id = sh.habilidad_id
    LEFT JOIN public.staff_credentials c ON c.staff_id = s.id
    ORDER BY s.fecha_creacion DESC, b.dia_semana ASC NULLS LAST, b.hora_inicio ASC NULLS LAST
  `;

  return mapStaffRows(rows);
};

export const getStaffById = async (id: string) => {
  await ensureStaffSecuritySchemaReady();

  const rows = await prisma.$queryRaw<StaffRawRow[]>`
    SELECT
      s.id::text AS id, 
      s.numero_staff,
      s.role_id,
      s.rol,
      s.nombres,
      s.apellidos,
      s.cedula,
      s.telefono,
      TO_CHAR(s.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
      s.carrera,
      s.tipo_contrato,
      s.conocimiento_sonido,
      s.estado,
      s.balance_horas,
      TO_CHAR(s.fecha_creacion, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fecha_creacion,
      b.id::text AS bloqueo_id,
      b.dia_semana AS bloqueo_dia_semana,
      CASE
        WHEN b.hora_inicio IS NULL THEN NULL
        ELSE TO_CHAR(b.hora_inicio, 'HH24:MI')
      END AS bloqueo_hora_inicio,
      CASE
        WHEN b.hora_fin IS NULL THEN NULL
        ELSE TO_CHAR(b.hora_fin, 'HH24:MI')
      END AS bloqueo_hora_fin
      , h.id::text AS habilidad_id
      , h.nombre AS habilidad_nombre
      , (c.staff_id IS NOT NULL) AS tiene_credencial
    FROM public.staff s
    LEFT JOIN public.staff_bloqueos_clase b ON b.staff_id = s.id
    LEFT JOIN public.staff_habilidades sh ON sh.staff_id = s.id
    LEFT JOIN public.habilidades h ON h.id = sh.habilidad_id
    LEFT JOIN public.staff_credentials c ON c.staff_id = s.id
    WHERE s.id = ${id}::uuid
    ORDER BY b.dia_semana ASC NULLS LAST, b.hora_inicio ASC NULLS LAST
  `;

  const mapped = mapStaffRows(rows);
  return mapped[0] ?? null;
};

export const getStaffByCedula = async (cedula: string) => {
  await ensureStaffSecuritySchemaReady();

  const rows = await prisma.$queryRaw<StaffRawRow[]>`
    SELECT
      s.id::text AS id,
      s.numero_staff,
      s.role_id,
      s.rol,
      s.nombres,
      s.apellidos,
      s.cedula,
      s.telefono,
      TO_CHAR(s.fecha_nacimiento, 'YYYY-MM-DD') AS fecha_nacimiento,
      s.carrera,
      s.tipo_contrato,
      s.conocimiento_sonido,
      s.estado,
      s.balance_horas,
      TO_CHAR(s.fecha_creacion, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS fecha_creacion,
      b.id::text AS bloqueo_id,
      b.dia_semana AS bloqueo_dia_semana,
      CASE
        WHEN b.hora_inicio IS NULL THEN NULL
        ELSE TO_CHAR(b.hora_inicio, 'HH24:MI')
      END AS bloqueo_hora_inicio,
      CASE
        WHEN b.hora_fin IS NULL THEN NULL
        ELSE TO_CHAR(b.hora_fin, 'HH24:MI')
      END AS bloqueo_hora_fin
      , h.id::text AS habilidad_id
      , h.nombre AS habilidad_nombre
      , (c.staff_id IS NOT NULL) AS tiene_credencial
    FROM public.staff s
    LEFT JOIN public.staff_bloqueos_clase b ON b.staff_id = s.id
    LEFT JOIN public.staff_habilidades sh ON sh.staff_id = s.id
    LEFT JOIN public.habilidades h ON h.id = sh.habilidad_id
    LEFT JOIN public.staff_credentials c ON c.staff_id = s.id
    WHERE s.cedula = ${cedula}
    ORDER BY b.dia_semana ASC NULLS LAST, b.hora_inicio ASC NULLS LAST
  `;

  const mapped = mapStaffRows(rows);
  return mapped[0] ?? null;
};

export const createStaff = async (payload: CreateStaffInput) => {
  await ensureStaffSecuritySchemaReady();

  return prisma.$transaction(async (tx) => {
    const numeroStaff = payload.numeroStaff ?? (await getNextStaffNumberTx(tx));

    if (CREDENTIAL_REQUIRED_ROLE_IDS.has(payload.roleId) && !payload.password) {
      throw new Error("Se requiere una contraseña para Administrador o Monitor");
    }

    const created = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.staff (
        numero_staff,
        role_id,
        rol,
        nombres,
        apellidos,
        cedula,
        telefono,
        fecha_nacimiento,
        carrera,
        tipo_contrato,
        conocimiento_sonido,
        estado,
        balance_horas
      )
      VALUES (
        ${numeroStaff},
        ${payload.roleId},
        ${payload.rol},
        ${payload.nombres},
        ${payload.apellidos},
        ${payload.cedula},
        ${payload.telefono},
        ${toIsoDate(payload.fechaNacimiento)}::date,
        ${payload.carrera},
        ${payload.tipoContrato},
        ${payload.conocimientoSonido},
        ${payload.estado}::public.staff_estado_enum,
        ${payload.balanceHoras}
      )
      RETURNING id::text AS id
    `;

    const staffId = created[0]?.id;
    if (!staffId) {
      throw new Error("No se pudo crear el staff");
    }

    for (const bloqueo of payload.bloqueosClase) {
      await tx.$executeRaw`
        INSERT INTO public.staff_bloqueos_clase (
          staff_id,
          dia_semana,
          hora_inicio,
          hora_fin
        )
        VALUES (
          ${staffId}::uuid,
          ${bloqueo.diaSemana},
          ${bloqueo.horaInicio}::time,
          ${bloqueo.horaFin}::time
        )
      `;
    }

    await syncStaffSkills(tx, staffId, payload.habilidadIds);

    if (payload.password) {
      await upsertStaffCredential(tx, staffId, payload.password);
    }

    return { staffId };
  }, { timeout: 20000, maxWait: 10000 });
};

export const updateStaff = async (payload: UpdateStaffInput) => {
  await ensureStaffSecuritySchemaReady();

  return prisma.$transaction(async (tx) => {
    if (CREDENTIAL_REQUIRED_ROLE_IDS.has(payload.roleId) && !payload.password) {
      const hasCredential = await hasStaffCredentialTx(tx, payload.id);
      if (!hasCredential) {
        throw new Error("Se requiere una contraseña para Administrador o Monitor");
      }
    }

    const updated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE public.staff
      SET
        numero_staff = ${payload.numeroStaff},
        role_id = ${payload.roleId},
        rol = ${payload.rol},
        nombres = ${payload.nombres},
        apellidos = ${payload.apellidos},
        cedula = ${payload.cedula},
        telefono = ${payload.telefono},
        fecha_nacimiento = ${toIsoDate(payload.fechaNacimiento)}::date,
        carrera = ${payload.carrera},
        tipo_contrato = ${payload.tipoContrato},
        conocimiento_sonido = ${payload.conocimientoSonido},
        estado = ${payload.estado}::public.staff_estado_enum,
        balance_horas = ${payload.balanceHoras}
      WHERE id = ${payload.id}::uuid
      RETURNING id::text AS id
    `;

    if (!updated[0]?.id) {
      throw new Error("No se encontro el staff a modificar");
    }

    await tx.$executeRaw`
      DELETE FROM public.staff_bloqueos_clase
      WHERE staff_id = ${payload.id}::uuid
    `;

    for (const bloqueo of payload.bloqueosClase) {
      await tx.$executeRaw`
        INSERT INTO public.staff_bloqueos_clase (
          staff_id,
          dia_semana,
          hora_inicio,
          hora_fin
        )
        VALUES (
          ${payload.id}::uuid,
          ${bloqueo.diaSemana},
          ${bloqueo.horaInicio}::time,
          ${bloqueo.horaFin}::time
        )
      `;
    }

    await syncStaffSkills(tx, payload.id, payload.habilidadIds);

    if (CREDENTIAL_REQUIRED_ROLE_IDS.has(payload.roleId) && payload.password) {
      await upsertStaffCredential(tx, payload.id, payload.password);
    }

    if (!CREDENTIAL_REQUIRED_ROLE_IDS.has(payload.roleId)) {
      await deleteStaffCredential(tx, payload.id);
    }

    return { staffId: payload.id };
  }, { timeout: 20000, maxWait: 10000 });
};

export const updateStaffEstado = async (id: string, estado: StaffEstado) => {
  const updated = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE public.staff
    SET estado = ${estado}::public.staff_estado_enum
    WHERE id = ${id}::uuid
    RETURNING id::text AS id
  `;

  if (!updated[0]?.id) {
    throw new Error("No se encontro el staff a modificar");
  }

  return { staffId: id };
};

export const deleteStaff = async (id: string) => {
  const deleted = await prisma.$queryRaw<Array<{ id: string }>>`
    DELETE FROM public.staff
    WHERE id = ${id}::uuid
    RETURNING id::text AS id
  `;

  if (!deleted[0]?.id) {
    throw new Error("No se encontro el staff a eliminar");
  }

  return { staffId: id };
};

const syncStaffBalanceFromMovimientosTx = async (
  tx: Pick<typeof prisma, "$queryRaw" | "$executeRaw">,
  staffId: string,
) => {
  const rows = await tx.$queryRaw<Array<{ balance_horas: number | null }>>`
    SELECT COALESCE(SUM(m.horas_delta), 0)::float8 AS balance_horas
    FROM public.staff_balance_movimientos m
    WHERE m.staff_id = ${staffId}::uuid
  `;

  const resolvedBalance = rows[0]?.balance_horas ?? 0;

  await tx.$executeRaw`
    UPDATE public.staff
    SET balance_horas = ${resolvedBalance}
    WHERE id = ${staffId}::uuid
  `;

  await tx.$executeRaw`
    UPDATE public.staff_resumen_contrato
    SET balance_horas = ${resolvedBalance}
    WHERE staff_id = ${staffId}::uuid
  `;

  return resolvedBalance;
};

const toMinutes = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
};

const validatePausaInsideJornada = (
  pausa: StaffPausaInput,
  jornadas: StaffJornadaRawRow[],
) => {
  const jornadaDelDia = jornadas.filter((item) => item.dia_semana === pausa.diaSemana);
  if (jornadaDelDia.length === 0) {
    throw new Error(`No existe jornada para ${pausa.diaSemana}`);
  }

  const pausaStart = toMinutes(pausa.horaInicio);
  const pausaEnd = toMinutes(pausa.horaFin);

  const fitsInSomeJornada = jornadaDelDia.some((jornada) => {
    const jornadaStart = toMinutes(jornada.hora_entrada);
    const jornadaEnd = toMinutes(jornada.hora_salida);
    return pausaStart >= jornadaStart && pausaEnd <= jornadaEnd;
  });

  if (!fitsInSomeJornada) {
    throw new Error(`La pausa de ${pausa.diaSemana} debe estar dentro de la jornada laboral`);
  }
};

const assertStaffExists = async (staffId: string) => {
  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id
    FROM public.staff
    WHERE id = ${staffId}::uuid
    LIMIT 1
  `;

  if (!existing[0]?.id) {
    throw new Error("No se encontro el staff solicitado");
  }
};

export const listStaffJornadaSemanal = async (staffId: string) => {
  await ensureStaffHorarioLaboralSchemaReady();
  await assertStaffExists(staffId);

  const rows = await prisma.$queryRaw<StaffJornadaRawRow[]>`
    SELECT
      j.id::text AS id,
      j.staff_id::text AS staff_id,
      j.dia_semana::text AS dia_semana,
      TO_CHAR(j.hora_entrada, 'HH24:MI') AS hora_entrada,
      TO_CHAR(j.hora_salida, 'HH24:MI') AS hora_salida,
      j.total_horas_dia::float8 AS total_horas_dia
    FROM public.staff_jornada_semanal j
    WHERE j.staff_id = ${staffId}::uuid
    ORDER BY
      CASE j.dia_semana::text
        WHEN 'Lunes' THEN 1
        WHEN 'Martes' THEN 2
        WHEN 'Miercoles' THEN 3
        WHEN 'Jueves' THEN 4
        WHEN 'Viernes' THEN 5
        WHEN 'Sabado' THEN 6
        WHEN 'Domingo' THEN 7
        ELSE 99
      END ASC,
      j.hora_entrada ASC,
      j.id ASC
  `;

  return rows.map((row) => ({
    id: row.id,
    staffId: row.staff_id,
    diaSemana: row.dia_semana,
    horaEntrada: row.hora_entrada,
    horaSalida: row.hora_salida,
    totalHorasDia: row.total_horas_dia,
  }));
};

export const listAllStaffJornadasSemanales = async () => {
  await ensureStaffHorarioLaboralSchemaReady();

  const rows = await prisma.$queryRaw<StaffJornadaRawRow[]>`
    SELECT
      j.id::text AS id,
      j.staff_id::text AS staff_id,
      j.dia_semana::text AS dia_semana,
      TO_CHAR(j.hora_entrada, 'HH24:MI') AS hora_entrada,
      TO_CHAR(j.hora_salida, 'HH24:MI') AS hora_salida,
      j.total_horas_dia::float8 AS total_horas_dia
    FROM public.staff_jornada_semanal j
    ORDER BY
      CASE j.dia_semana::text
        WHEN 'Lunes' THEN 1
        WHEN 'Martes' THEN 2
        WHEN 'Miercoles' THEN 3
        WHEN 'Jueves' THEN 4
        WHEN 'Viernes' THEN 5
        WHEN 'Sabado' THEN 6
        WHEN 'Domingo' THEN 7
        ELSE 99
      END ASC,
      j.hora_entrada ASC,
      j.id ASC
  `;

  const grouped: Record<string, Array<{
    id: string;
    staffId: string;
    diaSemana: string;
    horaEntrada: string;
    horaSalida: string;
    totalHorasDia: number;
  }>> = {};

  for (const row of rows) {
    if (!grouped[row.staff_id]) {
      grouped[row.staff_id] = [];
    }

    const target = grouped[row.staff_id];
    if (!target) continue;

    target.push({
      id: row.id,
      staffId: row.staff_id,
      diaSemana: row.dia_semana,
      horaEntrada: row.hora_entrada,
      horaSalida: row.hora_salida,
      totalHorasDia: row.total_horas_dia,
    });
  }

  return grouped;
};

export const listAllStaffPausasProgramadas = async () => {
  await ensureStaffHorarioLaboralSchemaReady();

  const rows = await prisma.$queryRaw<StaffPausaRawRow[]>`
    SELECT
      p.id::text AS id,
      p.staff_id::text AS staff_id,
      p.dia_semana::text AS dia_semana,
      p.tipo_pausa::text AS tipo_pausa,
      TO_CHAR(p.hora_inicio, 'HH24:MI') AS hora_inicio,
      TO_CHAR(p.hora_fin, 'HH24:MI') AS hora_fin
    FROM public.staff_pausas_programadas p
    ORDER BY
      CASE p.dia_semana::text
        WHEN 'Lunes' THEN 1
        WHEN 'Martes' THEN 2
        WHEN 'Miercoles' THEN 3
        WHEN 'Jueves' THEN 4
        WHEN 'Viernes' THEN 5
        WHEN 'Sabado' THEN 6
        WHEN 'Domingo' THEN 7
        ELSE 99
      END ASC,
      p.hora_inicio ASC,
      p.id ASC
  `;

  const grouped: Record<string, Array<{
    id: string;
    staffId: string;
    diaSemana: string;
    tipoPausa: string;
    horaInicio: string;
    horaFin: string;
  }>> = {};

  for (const row of rows) {
    if (!grouped[row.staff_id]) {
      grouped[row.staff_id] = [];
    }

    const target = grouped[row.staff_id];
    if (!target) continue;

    target.push({
      id: row.id,
      staffId: row.staff_id,
      diaSemana: row.dia_semana,
      tipoPausa: row.tipo_pausa,
      horaInicio: row.hora_inicio,
      horaFin: row.hora_fin,
    });
  }

  return grouped;
};

export const replaceStaffJornadaSemanal = async (staffId: string, jornadas: StaffJornadaInput[]) => {
  await ensureStaffHorarioLaboralSchemaReady();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id
      FROM public.staff
      WHERE id = ${staffId}::uuid
      LIMIT 1
    `;

    if (!existing[0]?.id) {
      throw new Error("No se encontro el staff solicitado");
    }

    const currentJornadas = await tx.$queryRaw<Array<{ id: string; dia_semana: string }>>`
      SELECT id::text AS id, dia_semana::text AS dia_semana
      FROM public.staff_jornada_semanal
      WHERE staff_id = ${staffId}::uuid
    `;

    const submittedDays = new Set(jornadas.map((jornada) => jornada.diaSemana));

    for (const jornada of jornadas) {
      const updated = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE public.staff_jornada_semanal
        SET
          hora_entrada = ${jornada.horaEntrada}::time,
          hora_salida = ${jornada.horaSalida}::time,
          total_horas_dia = ${jornada.totalHorasDia}
        WHERE staff_id = ${staffId}::uuid
          AND dia_semana = ${jornada.diaSemana}::public.dia_semana_enum
        RETURNING id::text AS id
      `;

      if (!updated[0]?.id) {
        await tx.$executeRaw`
          INSERT INTO public.staff_jornada_semanal (
            staff_id,
            dia_semana,
            hora_entrada,
            hora_salida,
            total_horas_dia
          )
          VALUES (
            ${staffId}::uuid,
            ${jornada.diaSemana}::public.dia_semana_enum,
            ${jornada.horaEntrada}::time,
            ${jornada.horaSalida}::time,
            ${jornada.totalHorasDia}
          )
        `;
      }
    }

    // Preserve jornadas referenced by attendance history. Only remove obsolete
    // rows that have never been used by an attendance record.
    for (const jornada of currentJornadas) {
      if (submittedDays.has(jornada.dia_semana)) continue;

      const attendance = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id
        FROM public.staff_registros_asistencia
        WHERE jornada_id = ${jornada.id}::uuid
        LIMIT 1
      `;

      if (attendance[0]?.id) continue;

      await tx.$executeRaw`
        DELETE FROM public.staff_jornada_semanal
        WHERE id = ${jornada.id}::uuid
      `;
    }

    return { staffId };
  }, { timeout: 30000, maxWait: 30000 });
};

export const listStaffPausasProgramadas = async (staffId: string) => {
  await ensureStaffHorarioLaboralSchemaReady();
  await assertStaffExists(staffId);

  const rows = await prisma.$queryRaw<StaffPausaRawRow[]>`
    SELECT
      p.id::text AS id,
      p.staff_id::text AS staff_id,
      p.dia_semana::text AS dia_semana,
      p.tipo_pausa::text AS tipo_pausa,
      TO_CHAR(p.hora_inicio, 'HH24:MI') AS hora_inicio,
      TO_CHAR(p.hora_fin, 'HH24:MI') AS hora_fin
    FROM public.staff_pausas_programadas p
    WHERE p.staff_id = ${staffId}::uuid
    ORDER BY p.dia_semana::text ASC, p.hora_inicio ASC
  `;

  return rows.map((row) => ({
    id: row.id,
    staffId: row.staff_id,
    diaSemana: row.dia_semana,
    tipoPausa: row.tipo_pausa,
    horaInicio: row.hora_inicio,
    horaFin: row.hora_fin,
  }));
};

export const createStaffPausaProgramada = async (staffId: string, payload: StaffPausaInput) => {
  await ensureStaffHorarioLaboralSchemaReady();

  return prisma.$transaction(async (tx) => {

    const existing = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id
      FROM public.staff
      WHERE id = ${staffId}::uuid
      LIMIT 1
    `;

    if (!existing[0]?.id) {
      throw new Error("No se encontro el staff solicitado");
    }

    const jornadas = await tx.$queryRaw<StaffJornadaRawRow[]>`
      SELECT
        id::text AS id,
        staff_id::text AS staff_id,
        dia_semana::text AS dia_semana,
        TO_CHAR(hora_entrada, 'HH24:MI') AS hora_entrada,
        TO_CHAR(hora_salida, 'HH24:MI') AS hora_salida,
        total_horas_dia::float8 AS total_horas_dia
      FROM public.staff_jornada_semanal
      WHERE staff_id = ${staffId}::uuid
    `;

    validatePausaInsideJornada(payload, jornadas);

    const created = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO public.staff_pausas_programadas (
        staff_id,
        tipo_pausa,
        dia_semana,
        hora_inicio,
        hora_fin
      )
      VALUES (
        ${staffId}::uuid,
        ${payload.tipoPausa}::public.staff_tipo_pausa_enum,
        ${payload.diaSemana}::public.dia_semana_enum,
        ${payload.horaInicio}::time,
        ${payload.horaFin}::time
      )
      RETURNING id::text AS id
    `;

    const id = created[0]?.id;
    if (!id) {
      throw new Error("No se pudo crear la pausa programada");
    }

    return { id };
  }, { timeout: 20000, maxWait: 10000 });
};

export const updateStaffPausaProgramada = async (staffId: string, pausaId: string, payload: StaffPausaInput) => {
  await ensureStaffHorarioLaboralSchemaReady();

  return prisma.$transaction(async (tx) => {

    const existing = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id
      FROM public.staff
      WHERE id = ${staffId}::uuid
      LIMIT 1
    `;

    if (!existing[0]?.id) {
      throw new Error("No se encontro el staff solicitado");
    }

    const jornadas = await tx.$queryRaw<StaffJornadaRawRow[]>`
      SELECT
        id::text AS id,
        staff_id::text AS staff_id,
        dia_semana::text AS dia_semana,
        TO_CHAR(hora_entrada, 'HH24:MI') AS hora_entrada,
        TO_CHAR(hora_salida, 'HH24:MI') AS hora_salida,
        total_horas_dia::float8 AS total_horas_dia
      FROM public.staff_jornada_semanal
      WHERE staff_id = ${staffId}::uuid
    `;

    validatePausaInsideJornada(payload, jornadas);

    const updated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE public.staff_pausas_programadas
      SET
        tipo_pausa = ${payload.tipoPausa}::public.staff_tipo_pausa_enum,
        dia_semana = ${payload.diaSemana}::public.dia_semana_enum,
        hora_inicio = ${payload.horaInicio}::time,
        hora_fin = ${payload.horaFin}::time
      WHERE id = ${pausaId}::uuid
        AND staff_id = ${staffId}::uuid
      RETURNING id::text AS id
    `;

    if (!updated[0]?.id) {
      throw new Error("No se encontro la pausa programada");
    }

    return { id: updated[0].id };
  }, { timeout: 20000, maxWait: 10000 });
};

export const deleteStaffPausaProgramada = async (staffId: string, pausaId: string) => {
  await ensureStaffHorarioLaboralSchemaReady();

  const deleted = await prisma.$queryRaw<Array<{ id: string }>>`
    DELETE FROM public.staff_pausas_programadas
    WHERE id = ${pausaId}::uuid
      AND staff_id = ${staffId}::uuid
    RETURNING id::text AS id
  `;

  if (!deleted[0]?.id) {
    throw new Error("No se encontro la pausa programada");
  }

  return { id: deleted[0].id };
};

export const getStaffResumenContrato = async (staffId: string) => {
  await ensureStaffHorarioLaboralSchemaReady();
  await assertStaffExists(staffId);

  const rows = await prisma.$queryRaw<StaffResumenContratoRawRow[]>`
    SELECT
      staff_id::text AS staff_id,
      horas_semanales_contrato,
      balance_horas::float8 AS balance_horas
    FROM public.staff_resumen_contrato
    WHERE staff_id = ${staffId}::uuid
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    staffId: row.staff_id,
    horasSemanalesContrato: row.horas_semanales_contrato,
    balanceHoras: row.balance_horas,
  };
};

export const upsertStaffResumenContrato = async (staffId: string, payload: StaffResumenContratoInput) => {
  await ensureStaffHorarioLaboralSchemaReady();

  const updated = await prisma.$queryRaw<Array<{ staff_id: string }>>`
    INSERT INTO public.staff_resumen_contrato (
      staff_id,
      horas_semanales_contrato,
      balance_horas
    )
    VALUES (
      ${staffId}::uuid,
      ${payload.horasSemanalesContrato},
      ${payload.balanceHoras}
    )
    ON CONFLICT (staff_id)
    DO UPDATE SET
      horas_semanales_contrato = EXCLUDED.horas_semanales_contrato,
      balance_horas = EXCLUDED.balance_horas
    RETURNING staff_id::text AS staff_id
  `;

  if (!updated[0]?.staff_id) {
    throw new Error("No se pudo guardar el resumen de contrato");
  }

  return { staffId: updated[0].staff_id };
};

export const listStaffBalanceMovimientos = async (staffId: string, limit = 50) => {
  await ensureStaffHorarioLaboralSchemaReady();
  await assertStaffExists(staffId);

  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 200) : 50;

  const rows = await prisma.$queryRaw<StaffBalanceMovimientoRawRow[]>`
    SELECT
      m.id::text AS id,
      m.staff_id::text AS staff_id,
      m.horas_delta::float8 AS horas_delta,
      m.motivo,
      m.creado_por_staff_id::text AS creado_por_staff_id,
      TO_CHAR(m.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
    FROM public.staff_balance_movimientos m
    WHERE m.staff_id = ${staffId}::uuid
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT ${safeLimit}
  `;

  return rows.map((row) => ({
    id: row.id,
    staffId: row.staff_id,
    horasDelta: row.horas_delta,
    motivo: row.motivo,
    creadoPorStaffId: row.creado_por_staff_id,
    createdAt: row.created_at,
  }));
};

export type StaffRecentActivity = {
  id: string;
  tipo: "entrada" | "salida" | "limpieza";
  titulo: string;
  detalle: string;
  fecha: string;
};

export const listStaffRecentActivities = async (
  staffId: string,
  options: { fromDate?: string | null; toDate?: string | null; type?: StaffRecentActivity["tipo"] | null; limit?: number } = {},
): Promise<StaffRecentActivity[]> => {
  await ensureStaffSecuritySchemaReady();

  const safeLimit = Number.isFinite(options.limit) ? Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 200) : 20;
  const fromDate = options.fromDate ?? null;
  const toDate = options.toDate ?? null;
  const type = options.type ?? null;

  const rows = await prisma.$queryRaw<Array<{
    id: string;
    tipo: "entrada" | "salida" | "limpieza";
    titulo: string;
    detalle: string;
    momento: string;
  }>>`
    SELECT activity.id, activity.tipo, activity.titulo, activity.detalle, activity.momento
    FROM (
      SELECT
        CONCAT(r.id::text, '-entrada') AS id,
        'entrada'::text AS tipo,
        'Entrada registrada'::text AS titulo,
        CASE
          WHEN r.minutos_tarde > 0 THEN CONCAT('Llegó tarde por ', r.minutos_tarde::text, ' minuto(s).')
          ELSE 'Entrada registrada a tiempo.'
        END AS detalle,
        r.hora_entrada AS momento
      FROM public.staff_registros_asistencia r
      WHERE r.staff_id = ${staffId}::uuid
        AND r.hora_entrada IS NOT NULL

      UNION ALL

      SELECT
        CONCAT(r.id::text, '-salida') AS id,
        'salida'::text AS tipo,
        'Salida registrada'::text AS titulo,
        CASE
          WHEN r.minutos_salida_anticipada > 0 THEN CONCAT('Salió ', r.minutos_salida_anticipada::text, ' minuto(s) antes de la jornada.')
          ELSE 'Salida registrada correctamente.'
        END AS detalle,
        r.hora_salida AS momento
      FROM public.staff_registros_asistencia r
      WHERE r.staff_id = ${staffId}::uuid
        AND r.hora_salida IS NOT NULL

      UNION ALL

      SELECT
        CONCAT(h.id::text, '-limpieza') AS id,
        'limpieza'::text AS tipo,
        CONCAT(h.room_name, ' marcado como limpio') AS titulo,
        CONCAT('Registro de limpieza realizado por ', COALESCE(NULLIF(h.created_by_name, ''), 'personal autorizado'), '.') AS detalle,
        h.created_at AS momento
      FROM public.schedule_room_action_history h
      WHERE h.created_by_staff_id = ${staffId}::uuid
        AND h.action_type = 'salon_limpio'
    ) AS activity
    WHERE (${fromDate}::date IS NULL OR (activity.momento AT TIME ZONE 'America/Bogota')::date >= ${fromDate}::date)
      AND (${toDate}::date IS NULL OR (activity.momento AT TIME ZONE 'America/Bogota')::date <= ${toDate}::date)
      AND (${type}::text IS NULL OR activity.tipo = ${type}::text)
    ORDER BY activity.momento DESC
    LIMIT ${safeLimit}
  `;

  return rows.map((row) => ({
    id: row.id,
    tipo: row.tipo,
    titulo: row.titulo,
    detalle: row.detalle,
    fecha: row.momento,
  }));
};

export const createStaffBalanceMovimiento = async (staffId: string, payload: StaffBalanceMovimientoInput) => {
  await ensureStaffHorarioLaboralSchemaReady();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id
      FROM public.staff
      WHERE id = ${staffId}::uuid
      LIMIT 1
    `;

    if (!existing[0]?.id) {
      throw new Error("No se encontro el staff solicitado");
    }

    const insertedRows = await tx.$queryRaw<StaffBalanceMovimientoRawRow[]>`
      INSERT INTO public.staff_balance_movimientos (
        staff_id,
        horas_delta,
        motivo,
        creado_por_staff_id
      )
      VALUES (
        ${staffId}::uuid,
        ${payload.horasDelta},
        ${payload.motivo?.trim() ? payload.motivo.trim() : null},
        ${payload.creadoPorStaffId ?? null}::uuid
      )
      RETURNING
        id::text AS id,
        staff_id::text AS staff_id,
        horas_delta::float8 AS horas_delta,
        motivo,
        creado_por_staff_id::text AS creado_por_staff_id,
        TO_CHAR(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
    `;

    const movement = insertedRows[0];
    if (!movement) {
      throw new Error("No se pudo crear el movimiento de horas");
    }

    const balanceHoras = await syncStaffBalanceFromMovimientosTx(tx, staffId);

    return {
      movement: {
        id: movement.id,
        staffId: movement.staff_id,
        horasDelta: movement.horas_delta,
        motivo: movement.motivo,
        creadoPorStaffId: movement.creado_por_staff_id,
        createdAt: movement.created_at,
      },
      balanceHoras,
    };
  }, { timeout: 20000, maxWait: 10000 });
};

export const getStaffHorarioLaboral = async (staffId: string) => {
  const [jornada, pausas, resumen] = await Promise.all([
    listStaffJornadaSemanal(staffId),
    listStaffPausasProgramadas(staffId),
    getStaffResumenContrato(staffId),
  ]);

  return {
    staffId,
    jornadaSemanal: jornada,
    pausasProgramadas: pausas,
    resumenContrato: resumen,
  };
};
