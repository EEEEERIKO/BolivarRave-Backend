const { prisma } = require('./dist/lib/prisma');

async function main() {
  const fnRows = await prisma.$queryRawUnsafe(`
    SELECT pg_get_functiondef('public.verificar_solape_horario(uuid,uuid,public.dia_semana_enum,time,time,uuid,date)'::regprocedure) AS def
  `);

  const trgRows = await prisma.$queryRawUnsafe(`
    SELECT t.tgname, p.proname
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'horarios_evento'
      AND NOT t.tgisinternal
  `);

  console.log('--- FUNCTION ---');
  console.log(fnRows[0]?.def ?? 'NO_DEF');
  console.log('--- TRIGGERS ---');
  console.log(JSON.stringify(trgRows, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
