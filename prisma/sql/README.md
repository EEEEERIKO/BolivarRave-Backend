# SQL migration map (simple and portable)

This folder has historical SQL plus hardening patches. For a new PostgreSQL server, use the consolidated migration file only.

## Recommended for clean migration

Run only:

- [007_portable_full_migration.sql](007_portable_full_migration.sql)
- [008_auditorio_reservas_schema.sql](008_auditorio_reservas_schema.sql)
- [009_staff_schema.sql](009_staff_schema.sql)
- [010_staff_role_id.sql](010_staff_role_id.sql)
- [011_tareas_schema.sql](011_tareas_schema.sql)
- [012_staff_horario_laboral_schema.sql](012_staff_horario_laboral_schema.sql)
- [013_auditorio_requerimientos_extra.sql](013_auditorio_requerimientos_extra.sql)
- [014_enable_rls_for_staff_tasks_auditorio.sql](014_enable_rls_for_staff_tasks_auditorio.sql)
- [015_schedule_requests_schema.sql](015_schedule_requests_schema.sql)
- [016_auditorio_event_staff_assignments.sql](016_auditorio_event_staff_assignments.sql)

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

And [009_staff_schema.sql](009_staff_schema.sql) creates:

- `staff`
- `staff_bloqueos_clase`
- enum `staff_estado_enum`
- constraints/indexes for contract plans, status, and class-unavailability blocks

And [010_staff_role_id.sql](010_staff_role_id.sql) adds:

- `staff_roles` catalog table (`Admin`, `Monitor`, `Colaborador`)
- `staff.role_id` as FK to `staff_roles`
- backfill/default compatibility for existing rows

And [011_tareas_schema.sql](011_tareas_schema.sql) creates:

- `habilidades` (catalog dependency for task skill FKs)
- `staff_habilidades`
- `tareas_catalogo`
- `tareas_instancias`
- `tareas_asignaciones`
- enums and indexes for task workflow (`tipo`, `prioridad`, `estado`)
- review traceability fields in assignments (`monitor_id`, `fecha_revision`, `observaciones_revision`)
- review/rework states in `tarea_estado_enum` (`En Revision`, `Rechazada`, `Corregir`)

And [015_schedule_requests_schema.sql](015_schedule_requests_schema.sql) creates:

- `solicitudes_salon`
- estados de solicitud para reservas de horario (`pendiente`, `aprobada`, `rechazada`)

And [016_auditorio_event_staff_assignments.sql](016_auditorio_event_staff_assignments.sql) creates:

- `auditorio_reserva_encargados`
- asignacion de uno o varios trabajadores encargados por reserva de auditorio

And [012_staff_horario_laboral_schema.sql](012_staff_horario_laboral_schema.sql) creates:

- `staff_jornada_semanal` (weekly working skeleton by day and entry/exit times)
- `staff_pausas_programadas` (programmed breaks by day and pause type)
- `staff_resumen_contrato` (weekly contract target and hour balance)
- enum `staff_tipo_pausa_enum` (`Comida`, `Descanso`)
- constraints and indexes for day/time consistency and staff relations

And [013_auditorio_requerimientos_extra.sql](013_auditorio_requerimientos_extra.sql) adds:

- `reservas_auditorio.requiere_monitor`
- `reservas_auditorio.requiere_proyector`
- `reservas_auditorio.requiere_filtro_agua`

And [014_enable_rls_for_staff_tasks_auditorio.sql](014_enable_rls_for_staff_tasks_auditorio.sql) applies:

- RLS enablement for auditorio/staff/tareas tables created after base migration
- direct privilege revocation for `anon` and `authenticated`
- `service_role_all_access` policy creation for `service_role`

## What each existing SQL file is for

- [001_schedule_safety_constraints.sql](001_schedule_safety_constraints.sql): Legacy safety constraints for old Prisma schedule tables (`ClassSlot`). Not needed for current reservas schema.
- [001b_cleanup_legacy_schedule_tables.sql](001b_cleanup_legacy_schedule_tables.sql): Drops old Prisma schedule tables. Use only if you are cleaning that old model.
- [002_reservas_schema_supabase.sql](002_reservas_schema_supabase.sql): Main reservas schema + triggers + base catalogs.
- [002b_seed_salones.sql](002b_seed_salones.sql): Early room seed list (contains legacy names; superseded by curated seed).
- [003_seed_curado_facultades_salones.sql](003_seed_curado_facultades_salones.sql): Curated faculties/rooms seed, but includes destructive truncates.
- [004_merge_duplicate_rooms.sql](004_merge_duplicate_rooms.sql): One-time data repair script to merge duplicate room names.
- [005_enable_rls_public_tables.sql](005_enable_rls_public_tables.sql): RLS hardening patch for Supabase exposure.
- [006_harden_function_search_path_and_extension_schema.sql](006_harden_function_search_path_and_extension_schema.sql): Supabase linter patch (`function_search_path_mutable`, `extension_in_public`).
- [014_enable_rls_for_staff_tasks_auditorio.sql](014_enable_rls_for_staff_tasks_auditorio.sql): RLS patch for auditorio/staff/tareas and related public tables.

## Practical execution paths

1. Clean new server (recommended):
   - Execute [007_portable_full_migration.sql](007_portable_full_migration.sql)
   - Execute [008_auditorio_reservas_schema.sql](008_auditorio_reservas_schema.sql)
   - Execute [009_staff_schema.sql](009_staff_schema.sql)
   - Execute [010_staff_role_id.sql](010_staff_role_id.sql)
   - Execute [011_tareas_schema.sql](011_tareas_schema.sql)
   - Execute [012_staff_horario_laboral_schema.sql](012_staff_horario_laboral_schema.sql)
   - Execute [013_auditorio_requerimientos_extra.sql](013_auditorio_requerimientos_extra.sql)
   - Execute [014_enable_rls_for_staff_tasks_auditorio.sql](014_enable_rls_for_staff_tasks_auditorio.sql)

2. Existing Supabase DB with data already loaded:
   - Keep historical files for audit only.
   - Apply patch files when needed (`005`, `006`, `014`) or run `007` carefully in a maintenance window after backup.

## Notes

- [007_portable_full_migration.sql](007_portable_full_migration.sql) is idempotent for structure and seeds.
- It does not import your operational events/schedules data from Supabase. For full production clone, export and import data after schema setup.
