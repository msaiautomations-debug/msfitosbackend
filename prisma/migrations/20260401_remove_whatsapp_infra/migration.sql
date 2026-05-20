ALTER TABLE "gyms"
DROP COLUMN "whatsapp_token";

ALTER TABLE "members"
DROP COLUMN "reminder_2_sent",
DROP COLUMN "reminder_today_sent";

ALTER TABLE "reminder_settings"
DROP COLUMN "reminder_2_days_before",
DROP COLUMN "reminder_today_days_before",
DROP COLUMN "enable_2_day_reminder",
DROP COLUMN "enable_expiry_reminder",
DROP COLUMN "message_inactive_member",
DROP COLUMN "tips_broadcast_day",
DROP COLUMN "message_7_day",
DROP COLUMN "message_2_day",
DROP COLUMN "message_expiry";
