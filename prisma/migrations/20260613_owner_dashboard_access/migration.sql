CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "owners" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "phone" TEXT,
  "password_hash" TEXT,
  "whatsapp_number" VARCHAR(15),
  "whatsapp_verified" BOOLEAN NOT NULL DEFAULT false,
  "expiring_soon_days" INTEGER NOT NULL DEFAULT 7,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE "gyms"
ADD COLUMN IF NOT EXISTS "owner_id" TEXT;

INSERT INTO "owners" ("name", "email", "phone", "password_hash", "created_at")
SELECT DISTINCT ON (LOWER(COALESCE(NULLIF("owner_email", ''), "email")))
  COALESCE(NULLIF("owner_name", ''), 'Owner') AS "name",
  LOWER(COALESCE(NULLIF("owner_email", ''), "email")) AS "email",
  "phone",
  "password_hash",
  COALESCE("created_at", NOW()) AS "created_at"
FROM "gyms"
WHERE COALESCE(NULLIF("owner_email", ''), "email") IS NOT NULL
ORDER BY LOWER(COALESCE(NULLIF("owner_email", ''), "email")), "created_at" ASC;

UPDATE "gyms" AS g
SET "owner_id" = o."id"
FROM "owners" AS o
WHERE g."owner_id" IS NULL
  AND LOWER(COALESCE(NULLIF(g."owner_email", ''), g."email")) = o."email";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gyms_owner_id_fkey'
  ) THEN
    ALTER TABLE "gyms"
    ADD CONSTRAINT "gyms_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "owners"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_gyms_owner_id" ON "gyms"("owner_id");

CREATE TABLE IF NOT EXISTS "admin_gym_access" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "owner_id" TEXT NOT NULL REFERENCES "owners"("id") ON DELETE CASCADE,
  "gym_id" TEXT NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
  "granted_by_admin" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "admin_gym_access_owner_id_gym_id_key" UNIQUE ("owner_id", "gym_id")
);

CREATE INDEX IF NOT EXISTS "idx_admin_gym_access_owner_id" ON "admin_gym_access"("owner_id");
CREATE INDEX IF NOT EXISTS "idx_admin_gym_access_gym_id" ON "admin_gym_access"("gym_id");

INSERT INTO "admin_gym_access" ("owner_id", "gym_id")
SELECT "owner_id", "id"
FROM "gyms"
WHERE "owner_id" IS NOT NULL
ON CONFLICT ("owner_id", "gym_id") DO NOTHING;
