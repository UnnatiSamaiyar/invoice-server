-- Repaired migration for local development history.
-- Original generated migration attempted to drop Google auth columns/index out of order,
-- which breaks Prisma shadow database replay with P3006/P3018.
-- Keep this migration as a safe no-op. Google auth fields are created/preserved by later repair migrations.

DO $$
BEGIN
  -- no-op intentionally
  NULL;
END $$;
