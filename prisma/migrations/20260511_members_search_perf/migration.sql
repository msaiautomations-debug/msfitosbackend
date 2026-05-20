CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS members_gym_id_phone_idx
  ON public.members (gym_id, phone);

CREATE INDEX IF NOT EXISTS members_name_trgm_idx
  ON public.members
  USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS members_email_trgm_idx
  ON public.members
  USING GIN (LOWER(email) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS members_phone_trgm_idx
  ON public.members
  USING GIN (phone gin_trgm_ops);
