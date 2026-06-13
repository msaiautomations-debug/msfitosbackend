ALTER TABLE "reminder_settings"
ADD COLUMN "enable_renewal_email" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "enable_renewal_whatsapp" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "email_subject_renewal" TEXT NOT NULL DEFAULT 'Your membership at {gym_name} has been renewed',
ADD COLUMN "email_body_renewal" TEXT NOT NULL DEFAULT E'Hi {member_name},\n\nYour membership at {gym_name} has been renewed successfully.\n\nNew expiry: {expiry_date}\nAmount paid: {amount_due}\n\nThanks,\n{gym_name}',
ADD COLUMN "whatsapp_body_renewal" TEXT NOT NULL DEFAULT 'Hi {member_name}, your membership at {gym_name} has been renewed successfully. New expiry: {expiry_date}. Amount paid: {amount_due}. Thank you.';
