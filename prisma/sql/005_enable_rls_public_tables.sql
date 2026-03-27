-- Security hardening for Supabase/PostgREST exposure
-- Enables RLS on public tables and keeps access restricted to service_role.

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

      -- Explicitly revoke direct table privileges from anon/authenticated roles.
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
