-- Run this once on Supabase AFTER creating Prisma tables (db push/migrate).
-- This script is idempotent and enforces overlap safety at DB level.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'btree_gist'
      AND n.nspname = 'public'
  ) THEN
    ALTER EXTENSION btree_gist SET SCHEMA extensions;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public."ClassSlot"') IS NULL THEN
    RAISE EXCEPTION 'Table public."ClassSlot" does not exist. Run Prisma schema first (npm run db:push) and retry.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ClassSlot_day_of_week_chk'
  ) THEN
    ALTER TABLE public."ClassSlot"
      ADD CONSTRAINT "ClassSlot_day_of_week_chk"
      CHECK ("dayOfWeek" BETWEEN 1 AND 7);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ClassSlot_time_bounds_chk'
  ) THEN
    ALTER TABLE public."ClassSlot"
      ADD CONSTRAINT "ClassSlot_time_bounds_chk"
      CHECK (
        "startMinute" >= 0
        AND "endMinute" <= 1440
        AND "startMinute" < "endMinute"
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ClassSlot_active_dates_chk'
  ) THEN
    ALTER TABLE public."ClassSlot"
      ADD CONSTRAINT "ClassSlot_active_dates_chk"
      CHECK (DATE("activeFrom") <= DATE("activeTo"));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ClassSlot_no_overlap'
  ) THEN
    ALTER TABLE public."ClassSlot"
      ADD CONSTRAINT "ClassSlot_no_overlap"
      EXCLUDE USING gist (
        "roomKey" WITH =,
        "dayOfWeek" WITH =,
        daterange(DATE("activeFrom"), DATE("activeTo"), '[]') WITH &&,
        int4range("startMinute", "endMinute", '[)') WITH &&
      );
  END IF;
END $$;
