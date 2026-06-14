ALTER TABLE "reminder_settings"
ALTER COLUMN "enable_inactive_reminder" SET DEFAULT true,
ALTER COLUMN "enable_inactive_email" SET DEFAULT true,
ALTER COLUMN "enable_inactive_whatsapp" SET DEFAULT true;

UPDATE "reminder_settings"
SET
  "enable_expiry_email" = true,
  "enable_expiry_whatsapp" = true,
  "enable_owner_daily_summary_email" = true,
  "enable_owner_daily_summary_whatsapp" = true,
  "enable_expiry_reminder" = true,
  "enable_expiry_reminder_email" = true,
  "enable_expiry_reminder_whatsapp" = true,
  "enable_birthday_message" = true,
  "enable_birthday_email" = true,
  "enable_birthday_whatsapp" = true,
  "enable_inactive_reminder" = true,
  "enable_inactive_email" = true,
  "enable_inactive_whatsapp" = true,
  "enable_renewal_email" = true,
  "enable_renewal_whatsapp" = true;
