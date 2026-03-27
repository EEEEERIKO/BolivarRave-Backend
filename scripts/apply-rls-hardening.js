const { prisma } = require('../dist/lib/prisma');

const RLS_SQL = `
DO $$
DECLARE
  tbl text;
  policy_name text := 'service_role_all_access';
  target_tables text[] := ARRAY[
    'schedule_import_history',
    'tipos_reserva',
    'horarios_evento',
    'eventos',
    'salones',
    'facultades'
  ];
BEGIN
  FOREACH tbl IN ARRAY target_tables LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = tbl
        AND c.relkind = 'r'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', tbl);

      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = tbl
            AND policyname = policy_name
        ) THEN
          EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
            policy_name,
            tbl
          );
        END IF;
      END IF;
    END IF;
  END LOOP;
END
$$;
`;

async function main() {
  await prisma.$executeRawUnsafe(RLS_SQL);

  const checks = await prisma.$queryRawUnsafe(`
    SELECT
      c.relname AS table_name,
      c.relrowsecurity AS rls_enabled,
      EXISTS (
        SELECT 1
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = c.relname
          AND p.policyname = 'service_role_all_access'
      ) AS service_role_policy
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY(ARRAY[
        'schedule_import_history',
        'tipos_reserva',
        'horarios_evento',
        'eventos',
        'salones',
        'facultades'
      ]::text[])
    ORDER BY c.relname
  `);

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
