import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { prisma } from "./src/lib/prisma";

const scryptAsync = promisify(scryptCallback);

const hashPassword = async (password: string) => {
  const salt = randomBytes(16);
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt$N=16384,r=8,p=1$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
};

const main = async () => {
  await prisma.$executeRaw`
    INSERT INTO public.staff_roles (id, nombre)
    VALUES (2, 'Monitor')
    ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre
  `;

  const existing = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id
    FROM public.staff
    WHERE cedula = 'Monitor'
    LIMIT 1
  `;

  let staffId = existing[0]?.id;

  if (!staffId) {
    const next = await prisma.$queryRaw<Array<{ numero_staff: number }>>`
      SELECT COALESCE(MAX(numero_staff), 0) + 1 AS numero_staff
      FROM public.staff
    `;

    const numeroStaff = next[0]?.numero_staff ?? 1;

    const created = await prisma.$queryRaw<Array<{ id: string }>>`
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
      ) VALUES (
        ${numeroStaff},
        2,
        'Monitor',
        'Monitor',
        'Registro',
        'Monitor',
        '0000000',
        '1990-01-01'::date,
        'Registro',
        'Plan Monitoria',
        false,
        'Active'::public.staff_estado_enum,
        0
      )
      RETURNING id::text AS id
    `;

    staffId = created[0]?.id;
  } else {
    await prisma.$executeRaw`
      UPDATE public.staff
      SET role_id = 2,
          rol = 'Monitor',
          estado = 'Active'::public.staff_estado_enum
      WHERE id = ${staffId}::uuid
    `;
  }

  if (!staffId) {
    throw new Error("No se pudo resolver el staffId para Monitor");
  }

  const passwordHash = await hashPassword("Monitor123");

  await prisma.$executeRaw`
    INSERT INTO public.staff_credentials (staff_id, password_hash, password_algo)
    VALUES (${staffId}::uuid, ${passwordHash}, 'scrypt')
    ON CONFLICT (staff_id)
    DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      password_algo = EXCLUDED.password_algo,
      password_updated_at = now()
  `;

  const verify = await prisma.$queryRaw<Array<{ cedula: string; role_id: number; rol: string; estado: string }>>`
    SELECT cedula, role_id, rol, estado::text AS estado
    FROM public.staff
    WHERE id = ${staffId}::uuid
  `;

  console.log(JSON.stringify({ ok: true, staffId, user: verify[0] ?? null }, null, 2));
};

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
