-- Add owner_email column to support multiple gyms per owner
-- This allows an owner (identified by email) to manage multiple gyms

-- Step 1: Add the column as nullable first
ALTER TABLE public.gyms ADD COLUMN owner_email VARCHAR(255) DEFAULT NULL;

-- Step 2: Populate owner_email with existing email values for backward compatibility
UPDATE public.gyms SET owner_email = email WHERE owner_email IS NULL;

-- Step 3: Make owner_email NOT NULL after backfilling all rows
ALTER TABLE public.gyms ALTER COLUMN owner_email SET NOT NULL;

-- Step 4: Add default value constraint for future inserts
ALTER TABLE public.gyms ALTER COLUMN owner_email DROP DEFAULT;

-- Step 5: Create index for faster lookups by owner_email
CREATE INDEX idx_gyms_owner_email ON public.gyms(owner_email);

-- Keep the existing email unique constraint for login purposes
-- (each gym still needs a unique contact/login email, but multiple gyms can share owner_email)
