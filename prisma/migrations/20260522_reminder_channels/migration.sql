ALTER TABLE "reminder_settings"
ADD COLUMN "enable_expiry_whatsapp" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "enable_owner_daily_summary_whatsapp" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "enable_7_day_reminder_email" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "enable_7_day_reminder_whatsapp" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "enable_birthday_email" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "enable_birthday_whatsapp" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "enable_inactive_email" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "enable_inactive_whatsapp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "whatsapp_body_expiring" TEXT NOT NULL DEFAULT 'Hi {member_name}, your membership at {gym_name} will expire on {expiry_date}. Amount due: {amount_due}. Please renew before expiry.',
ADD COLUMN "whatsapp_body_expired" TEXT NOT NULL DEFAULT 'Hi {member_name}, your membership at {gym_name} expired on {expiry_date}. Amount due: {amount_due}. Please renew to reactivate your access.',
ADD COLUMN "whatsapp_body_birthday" TEXT NOT NULL DEFAULT 'Happy Birthday {member_name}! Everyone at {gym_name} wishes you a strong, healthy, and successful year ahead.',
ADD COLUMN "whatsapp_body_inactive" TEXT NOT NULL DEFAULT 'Hi {member_name}, we haven''t seen you at {gym_name} recently. Come back this week and keep your progress going.';
