import "dotenv/config";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scryptCallback);

const baseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!baseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no configurada");
}

const restBase = `${baseUrl}/rest/v1`;

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json",
};

async function rest(path, options = {}) {
  const response = await fetch(`${restBase}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`REST ${options.method ?? "GET"} ${path} fallo: ${response.status} ${text}`);
  }

  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = (await scryptAsync(password, salt, 64));
  return `scrypt$N=16384,r=8,p=1$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

async function ensureRoleRegistro() {
  await rest("/staff_roles?on_conflict=id", {
    method: "POST",
    body: JSON.stringify({ id: 2, nombre: "Monitor" }),
    headers: {
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
  });
}

async function getNextNumeroStaff() {
  const rows = await rest("/staff?select=numero_staff&order=numero_staff.desc&limit=1");
  const max = Number(rows?.[0]?.numero_staff ?? 0);
  return max + 1;
}

async function upsertStaffMonitor() {
  const existing = await rest("/staff?select=id,cedula,numero_staff&cedula=eq.Monitor&limit=1");

  if (existing.length > 0) {
    const staffId = existing[0].id;
    await rest("/staff?cedula=eq.Monitor", {
      method: "PATCH",
      body: JSON.stringify({
        role_id: 2,
        rol: "Monitor",
        estado: "Active",
      }),
      headers: { Prefer: "return=minimal" },
    });
    return { staffId, created: false };
  }

  const numeroStaff = await getNextNumeroStaff();
  const inserted = await rest("/staff", {
    method: "POST",
    body: JSON.stringify({
      numero_staff: numeroStaff,
      role_id: 2,
      rol: "Monitor",
      nombres: "Monitor",
      apellidos: "",
      cedula: "Monitor",
      telefono: "0000000",
      fecha_nacimiento: "1990-01-01",
      carrera: "Monitor",
      tipo_contrato: "Plan Monitoria",
      conocimiento_sonido: false,
      estado: "Active",
      balance_horas: 0,
    }),
    headers: { Prefer: "return=representation" },
  });

  const staffId = inserted?.[0]?.id;
  if (!staffId) {
    throw new Error("No se pudo obtener id del staff insertado");
  }

  return { staffId, created: true };
}

async function upsertCredential(staffId) {
  const passwordHash = await hashPassword("Monitor123");

  const existing = await rest(`/staff_credentials?select=staff_id&staff_id=eq.${staffId}&limit=1`);

  if (existing.length > 0) {
    await rest(`/staff_credentials?staff_id=eq.${staffId}`, {
      method: "PATCH",
      body: JSON.stringify({
        password_hash: passwordHash,
        password_algo: "scrypt",
      }),
      headers: { Prefer: "return=minimal" },
    });
    return;
  }

  await rest("/staff_credentials", {
    method: "POST",
    body: JSON.stringify({
      staff_id: staffId,
      password_hash: passwordHash,
      password_algo: "scrypt",
    }),
    headers: { Prefer: "return=minimal" },
  });
}

async function verify(staffId) {
  const row = await rest(`/staff?select=id,cedula,role_id,rol,estado&id=eq.${staffId}&limit=1`);
  const credential = await rest(`/staff_credentials?select=staff_id,password_algo&staff_id=eq.${staffId}&limit=1`);

  return {
    staff: row?.[0] ?? null,
    credential: credential?.[0] ?? null,
  };
}

async function main() {
  await ensureRoleRegistro();
  const { staffId, created } = await upsertStaffMonitor();
  await upsertCredential(staffId);
  const details = await verify(staffId);

  console.log(JSON.stringify({
    ok: true,
    created,
    staffId,
    staff: details.staff,
    credential: details.credential,
    login: {
      cedula: "Monitor",
      password: "Monitor123",
      roleExpected: "monitor",
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
