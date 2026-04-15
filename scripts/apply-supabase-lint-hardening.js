const { prisma } = require('../dist/lib/prisma');

async function main() {
  try {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA extensions`);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (!message.includes("already exists")) {
      throw error;
    }
  }

  const extInPublic = await prisma.$queryRawUnsafe(`
    SELECT 1
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'btree_gist'
      AND n.nspname = 'public'
    LIMIT 1
  `);

  if (extInPublic.length > 0) {
    await prisma.$executeRawUnsafe(`ALTER EXTENSION btree_gist SET SCHEMA extensions`);
  }

  const functionAlters = [
    `ALTER FUNCTION public.validar_evento_por_tipo() SET search_path = public, pg_temp`,
    `ALTER FUNCTION public.verificar_solape_horario(uuid, uuid, public.dia_semana_enum, time without time zone, time without time zone, uuid) SET search_path = public, pg_temp`,
    `ALTER FUNCTION public.verificar_solape_horario(uuid, uuid, public.dia_semana_enum, time without time zone, time without time zone, uuid, date) SET search_path = public, pg_temp`,
    `ALTER FUNCTION public.trg_horarios_evento_no_solape() SET search_path = public, pg_temp`,
    `ALTER FUNCTION public.trg_eventos_revalidar_solape_por_fecha() SET search_path = public, pg_temp`,
  ];

  for (const sql of functionAlters) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (!message.includes("does not exist")) {
        throw error;
      }
    }
  }

  const functionChecks = await prisma.$queryRawUnsafe(`
    SELECT
      n.nspname AS schema,
      p.proname AS function_name,
      pg_get_function_arguments(p.oid) AS args,
      p.proconfig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(ARRAY[
        'validar_evento_por_tipo',
        'verificar_solape_horario',
        'trg_horarios_evento_no_solape',
        'trg_eventos_revalidar_solape_por_fecha'
      ]::text[])
    ORDER BY p.proname, pg_get_function_arguments(p.oid)
  `);

  const extensionCheck = await prisma.$queryRawUnsafe(`
    SELECT
      e.extname,
      n.nspname AS schema
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'btree_gist'
  `);

  console.log(
    JSON.stringify(
      {
        ok: true,
        functionChecks,
        extensionCheck,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
