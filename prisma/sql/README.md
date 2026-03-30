# SQL migration map (simple and portable)

This folder has historical SQL plus hardening patches. For a new PostgreSQL server, use the consolidated migration file only.

## Recommended for clean migration

Run only:

- [007_portable_full_migration.sql](007_portable_full_migration.sql)
- [008_auditorio_reservas_schema.sql](008_auditorio_reservas_schema.sql)

This single file creates:

- Extensions and extension schema placement (`btree_gist` in `extensions`)
- Core tables (`facultades`, `salones`, `tipos_reserva`, `eventos`, `horarios_evento`)
- Indexes
- Validation functions and triggers
- Supabase linter hardening (`search_path` and extension schema)
- RLS hardening (role-aware; safe outside Supabase)
- Base seed data (facultades + official salones catalog)

And [008_auditorio_reservas_schema.sql](008_auditorio_reservas_schema.sql) creates:

- `reservas_auditorio`
- `horarios_intercalados_auditorio`
- enum `auditorio_estado_enum`
- validation/overlap triggers for auditorio bookings

## What each existing SQL file is for

- [001_schedule_safety_constraints.sql](001_schedule_safety_constraints.sql): Legacy safety constraints for old Prisma schedule tables (`ClassSlot`). Not needed for current reservas schema.
- [001b_cleanup_legacy_schedule_tables.sql](001b_cleanup_legacy_schedule_tables.sql): Drops old Prisma schedule tables. Use only if you are cleaning that old model.
- [002_reservas_schema_supabase.sql](002_reservas_schema_supabase.sql): Main reservas schema + triggers + base catalogs.
- [002b_seed_salones.sql](002b_seed_salones.sql): Early room seed list (contains legacy names; superseded by curated seed).
- [003_seed_curado_facultades_salones.sql](003_seed_curado_facultades_salones.sql): Curated faculties/rooms seed, but includes destructive truncates.
- [004_merge_duplicate_rooms.sql](004_merge_duplicate_rooms.sql): One-time data repair script to merge duplicate room names.
- [005_enable_rls_public_tables.sql](005_enable_rls_public_tables.sql): RLS hardening patch for Supabase exposure.
- [006_harden_function_search_path_and_extension_schema.sql](006_harden_function_search_path_and_extension_schema.sql): Supabase linter patch (`function_search_path_mutable`, `extension_in_public`).

## Practical execution paths

1. Clean new server (recommended):
   - Execute [007_portable_full_migration.sql](007_portable_full_migration.sql)
   - Execute [008_auditorio_reservas_schema.sql](008_auditorio_reservas_schema.sql)

2. Existing Supabase DB with data already loaded:
   - Keep historical files for audit only.
   - Apply only patch files when needed (`005`, `006`) or run `007` carefully in a maintenance window after backup.

## Notes

- [007_portable_full_migration.sql](007_portable_full_migration.sql) is idempotent for structure and seeds.
- It does not import your operational events/schedules data from Supabase. For full production clone, export and import data after schema setup.
